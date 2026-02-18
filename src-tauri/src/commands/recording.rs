use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct NativeRecordingResult {
    pub audio_data: Vec<u8>,
    pub mime_type: String,
    pub duration_seconds: Option<f64>,
}

#[tauri::command]
pub async fn start_native_recording() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return macos::start().map(|_| true);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native recording is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub async fn stop_native_recording() -> Result<NativeRecordingResult, String> {
    #[cfg(target_os = "macos")]
    {
        return macos::stop();
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native recording is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub async fn cancel_native_recording() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return macos::cancel().map(|_| true);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native recording is only supported on macOS".to_string())
    }
}

/// Check if the macOS native recorder is currently active.
pub fn is_native_recording_active() -> bool {
    #[cfg(target_os = "macos")]
    {
        return macos::is_active();
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::NativeRecordingResult;
    use objc2::exception;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{AnyThread, ClassType};
    use objc2_avf_audio::{
        AVAudioRecorder, AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsBigEndianKey,
        AVLinearPCMIsFloatKey, AVNumberOfChannelsKey, AVSampleRateKey,
    };
    use objc2_foundation::{NSDictionary, NSError, NSMutableDictionary, NSNumber, NSString, NSURL};
    use std::ffi::CString;
    use std::panic::AssertUnwindSafe;
    use std::path::PathBuf;
    use std::ptr::NonNull;
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use std::time::Instant;

    const K_AUDIO_FORMAT_LINEAR_PCM: u32 = 0x6C70_636D; // 'lpcm'

    struct RecorderState {
        recorder: Retained<AVAudioRecorder>,
        path: PathBuf,
        started_at: Instant,
    }

    static RECORDER_STATE: OnceLock<Mutex<Option<RecorderState>>> = OnceLock::new();

    fn state() -> &'static Mutex<Option<RecorderState>> {
        RECORDER_STATE.get_or_init(|| Mutex::new(None))
    }

    fn nsstring_from_str(s: &str) -> Result<Retained<NSString>, String> {
        let cstr = CString::new(s)
            .map_err(|_| "Failed to create NSString (string contains null byte)".to_string())?;
        let ptr = NonNull::new(cstr.as_ptr() as *mut i8)
            .ok_or_else(|| "Failed to create NSString (null pointer)".to_string())?;
        unsafe { NSString::stringWithUTF8String(ptr.cast()) }
            .ok_or_else(|| "Failed to create NSString from UTF-8".to_string())
    }

    fn ns_error_to_string(error: &NSError) -> String {
        // `NSString` implements Display in objc2-foundation.
        let desc = error.localizedDescription();
        desc.to_string()
    }

    fn any_object(value: &NSNumber) -> &AnyObject {
        // NSNumber -> NSValue -> NSObject -> AnyObject
        value.as_super().as_super().as_super()
    }

    fn unique_recording_path() -> PathBuf {
        let pid = std::process::id();
        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("typefree-native-recording-{pid}-{now_ns}.wav"))
    }

    fn is_wav_header(bytes: &[u8]) -> bool {
        bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
    }

    fn bytes_prefix_hex(bytes: &[u8], max_len: usize) -> String {
        let prefix = &bytes[..bytes.len().min(max_len)];
        let mut out = String::new();
        for (idx, b) in prefix.iter().enumerate() {
            if idx > 0 {
                out.push(' ');
            }
            out.push_str(&format!("{:02x}", b));
        }
        out
    }

    fn read_wav_with_retry(path: &PathBuf) -> Result<Vec<u8>, String> {
        let mut last_len = 0usize;
        let mut last_prefix = String::new();

        // `AVAudioRecorder.stop()` should finalize synchronously, but in practice the file can
        // briefly appear empty/partial. Retrying avoids uploading truncated WAVs.
        for _ in 0..25 {
            match std::fs::read(path) {
                Ok(bytes) => {
                    last_len = bytes.len();
                    last_prefix = bytes_prefix_hex(&bytes, 16);
                    if is_wav_header(&bytes) && bytes.len() >= 44 {
                        return Ok(bytes);
                    }
                }
                Err(_) => {
                    // Still being created; keep waiting.
                }
            }

            std::thread::sleep(Duration::from_millis(20));
        }

        Err(format!(
            "Native recording did not produce a valid WAV (len={last_len}, prefix={last_prefix}). File kept at: {}",
            path.to_string_lossy()
        ))
    }

    pub fn is_active() -> bool {
        match state().lock() {
            Ok(guard) => guard.as_ref().is_some(),
            Err(_) => false,
        }
    }

    pub fn start() -> Result<(), String> {
        let mut guard = state()
            .lock()
            .map_err(|_| "Native recorder state poisoned".to_string())?;

        if guard.as_ref().is_some() {
            return Err("Recording already in progress".to_string());
        }

        let path = unique_recording_path();
        let path_str = path.to_string_lossy();
        let ns_path = nsstring_from_str(&path_str)?;
        let url = NSURL::fileURLWithPath(&ns_path);

        let settings = NSMutableDictionary::<NSString, AnyObject>::initWithCapacity(
            NSMutableDictionary::alloc(),
            8,
        );

        let format_key =
            unsafe { AVFormatIDKey }.ok_or_else(|| "AVFormatIDKey unavailable".to_string())?;
        let sample_rate_key =
            unsafe { AVSampleRateKey }.ok_or_else(|| "AVSampleRateKey unavailable".to_string())?;
        let channels_key = unsafe { AVNumberOfChannelsKey }
            .ok_or_else(|| "AVNumberOfChannelsKey unavailable".to_string())?;
        let bit_depth_key = unsafe { AVLinearPCMBitDepthKey }
            .ok_or_else(|| "AVLinearPCMBitDepthKey unavailable".to_string())?;
        let big_endian_key = unsafe { AVLinearPCMIsBigEndianKey }
            .ok_or_else(|| "AVLinearPCMIsBigEndianKey unavailable".to_string())?;
        let float_key = unsafe { AVLinearPCMIsFloatKey }
            .ok_or_else(|| "AVLinearPCMIsFloatKey unavailable".to_string())?;

        let format_id = NSNumber::initWithUnsignedInt(NSNumber::alloc(), K_AUDIO_FORMAT_LINEAR_PCM);
        let sample_rate = NSNumber::initWithDouble(NSNumber::alloc(), 16_000.0);
        let channels = NSNumber::initWithUnsignedInt(NSNumber::alloc(), 1);
        let bit_depth = NSNumber::initWithUnsignedInt(NSNumber::alloc(), 16);
        let is_big_endian = NSNumber::initWithBool(NSNumber::alloc(), false);
        let is_float = NSNumber::initWithBool(NSNumber::alloc(), false);

        unsafe {
            settings.setObject_forKey(any_object(&format_id), ProtocolObject::from_ref(format_key));
            settings.setObject_forKey(
                any_object(&sample_rate),
                ProtocolObject::from_ref(sample_rate_key),
            );
            settings.setObject_forKey(
                any_object(&channels),
                ProtocolObject::from_ref(channels_key),
            );
            settings.setObject_forKey(
                any_object(&bit_depth),
                ProtocolObject::from_ref(bit_depth_key),
            );
            settings.setObject_forKey(
                any_object(&is_big_endian),
                ProtocolObject::from_ref(big_endian_key),
            );
            settings.setObject_forKey(any_object(&is_float), ProtocolObject::from_ref(float_key));
        }

        let settings_dict: &NSDictionary<NSString, AnyObject> = settings.as_super();

        let recorder = match exception::catch(AssertUnwindSafe(|| unsafe {
            AVAudioRecorder::initWithURL_settings_error(
                AVAudioRecorder::alloc(),
                &url,
                settings_dict,
            )
        })) {
            Ok(Ok(recorder)) => recorder,
            Ok(Err(err)) => return Err(ns_error_to_string(&err)),
            Err(exc) => {
                return Err(format!(
                    "Objective-C exception while creating recorder: {:?}",
                    exc
                ));
            }
        };

        let prepared =
            match exception::catch(AssertUnwindSafe(|| unsafe { recorder.prepareToRecord() })) {
                Ok(prepared) => prepared,
                Err(exc) => {
                    return Err(format!(
                        "Objective-C exception during prepareToRecord: {:?}",
                        exc
                    ));
                }
            };
        if !prepared {
            return Err("Failed to prepare audio recorder".to_string());
        }

        let started = match exception::catch(AssertUnwindSafe(|| unsafe { recorder.record() })) {
            Ok(started) => started,
            Err(exc) => return Err(format!("Objective-C exception during record: {:?}", exc)),
        };
        if !started {
            return Err("Failed to start recording (microphone permission?)".to_string());
        }

        *guard = Some(RecorderState {
            recorder,
            path,
            started_at: Instant::now(),
        });

        Ok(())
    }

    pub fn stop() -> Result<NativeRecordingResult, String> {
        let state = {
            let mut guard = state()
                .lock()
                .map_err(|_| "Native recorder state poisoned".to_string())?;
            guard
                .take()
                .ok_or_else(|| "Not currently recording".to_string())?
        };

        if let Err(exc) = exception::catch(AssertUnwindSafe(|| unsafe { state.recorder.stop() })) {
            return Err(format!("Objective-C exception during stop: {:?}", exc));
        }

        let duration_seconds = Some(state.started_at.elapsed().as_secs_f64());

        let audio_data = read_wav_with_retry(&state.path)?;
        let _ = std::fs::remove_file(&state.path);

        Ok(NativeRecordingResult {
            audio_data,
            mime_type: "audio/wav".to_string(),
            duration_seconds,
        })
    }

    pub fn cancel() -> Result<(), String> {
        let state = {
            let mut guard = state()
                .lock()
                .map_err(|_| "Native recorder state poisoned".to_string())?;
            guard.take()
        };

        if let Some(state) = state {
            if let Err(exc) =
                exception::catch(AssertUnwindSafe(|| unsafe { state.recorder.stop() }))
            {
                eprintln!("[recording] objc exception during cancel stop: {:?}", exc);
            }
            let _ = std::fs::remove_file(&state.path);
        }

        Ok(())
    }
}
