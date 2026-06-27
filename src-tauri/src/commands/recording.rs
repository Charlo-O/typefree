use serde::Serialize;

use super::command_error::{CommandError, CommandResult};

#[derive(Debug, Serialize, Clone)]
pub struct NativeRecordingResult {
    pub audio_data: Vec<u8>,
    pub mime_type: String,
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeRecordingCapabilities {
    pub supported: bool,
    pub platform: String,
    pub backend: String,
    pub status: String,
    pub reason: Option<String>,
    pub active: bool,
}

fn recording_error(message: impl Into<String>) -> CommandError {
    CommandError::from_message(message.into()).with_source("recording")
}

trait AudioRecorder: Sync {
    fn backend(&self) -> &'static str;
    fn status(&self) -> String;
    fn reason(&self) -> Option<String>;
    fn is_supported(&self) -> bool;
    fn is_active(&self) -> bool;
    fn start(&self) -> Result<(), String>;
    fn stop(&self) -> Result<NativeRecordingResult, String>;
    fn cancel(&self) -> Result<(), String>;

    fn capabilities(&self) -> NativeRecordingCapabilities {
        NativeRecordingCapabilities {
            supported: self.is_supported(),
            platform: platform_name().to_string(),
            backend: self.backend().to_string(),
            status: self.status(),
            reason: self.reason(),
            active: self.is_active(),
        }
    }
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "windows")]
    return "win32";

    #[cfg(target_os = "macos")]
    return "darwin";

    #[cfg(target_os = "linux")]
    return "linux";

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return "unknown";
}

fn selected_recorder() -> &'static dyn AudioRecorder {
    #[cfg(target_os = "macos")]
    {
        return &macos::RECORDER;
    }

    #[cfg(target_os = "windows")]
    {
        return &windows_recorder::RECORDER;
    }

    #[cfg(target_os = "linux")]
    {
        return &linux_recorder::RECORDER;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        return &unsupported_recorder::RECORDER;
    }
}

#[tauri::command]
pub fn get_native_recording_capabilities() -> NativeRecordingCapabilities {
    selected_recorder().capabilities()
}

#[tauri::command]
pub async fn start_native_recording() -> CommandResult<bool> {
    selected_recorder()
        .start()
        .map(|_| true)
        .map_err(recording_error)
}

#[tauri::command]
pub async fn stop_native_recording() -> CommandResult<NativeRecordingResult> {
    selected_recorder().stop().map_err(recording_error)
}

#[tauri::command]
pub async fn cancel_native_recording() -> CommandResult<bool> {
    selected_recorder()
        .cancel()
        .map(|_| true)
        .map_err(recording_error)
}

/// Check if the selected native recorder is currently active.
#[cfg(target_os = "macos")]
pub fn is_native_recording_active() -> bool {
    selected_recorder().is_active()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AudioRecorder, NativeRecordingResult};
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
    pub static RECORDER: MacosAudioRecorder = MacosAudioRecorder;

    pub struct MacosAudioRecorder;

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

    impl AudioRecorder for MacosAudioRecorder {
        fn backend(&self) -> &'static str {
            "macos-avfoundation-coreaudio"
        }

        fn status(&self) -> String {
            "ready".to_string()
        }

        fn reason(&self) -> Option<String> {
            None
        }

        fn is_supported(&self) -> bool {
            true
        }

        fn is_active(&self) -> bool {
            is_active()
        }

        fn start(&self) -> Result<(), String> {
            start()
        }

        fn stop(&self) -> Result<NativeRecordingResult, String> {
            stop()
        }

        fn cancel(&self) -> Result<(), String> {
            cancel()
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_recorder {
    use super::{AudioRecorder, NativeRecordingResult};
    use std::ptr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};
    use windows::core::GUID;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, S_FALSE, S_OK};
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX,
        WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    const OUTPUT_SAMPLE_RATE: u32 = 16_000;
    const OUTPUT_CHANNELS: u16 = 1;
    const MAX_CAPTURE_SECONDS: usize = 600;
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
    const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    pub static RECORDER: WindowsWasapiRecorder = WindowsWasapiRecorder;

    pub struct WindowsWasapiRecorder;

    struct RecorderState {
        worker: JoinHandle<Result<(), String>>,
        stop_requested: Arc<AtomicBool>,
        samples: Arc<Mutex<Vec<f32>>>,
        input_sample_rate: u32,
        started_at: Instant,
    }

    static RECORDER_STATE: OnceLock<Mutex<Option<RecorderState>>> = OnceLock::new();

    fn state() -> &'static Mutex<Option<RecorderState>> {
        RECORDER_STATE.get_or_init(|| Mutex::new(None))
    }

    struct ComGuard {
        should_uninitialize: bool,
    }

    impl ComGuard {
        fn initialize() -> Result<Self, String> {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if hr == S_OK || hr == S_FALSE {
                return Ok(Self {
                    should_uninitialize: true,
                });
            }
            if hr == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    should_uninitialize: false,
                });
            }
            Err(format!(
                "Failed to initialize COM for Windows WASAPI: {hr:?}"
            ))
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninitialize {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    #[derive(Debug, Clone, Copy)]
    enum SampleEncoding {
        Pcm,
        Float,
    }

    #[derive(Debug, Clone, Copy)]
    struct WaveFormatInfo {
        sample_rate: u32,
        channels: u16,
        bits_per_sample: u16,
        block_align: u16,
        encoding: SampleEncoding,
    }

    #[derive(Debug, Clone)]
    struct CaptureInfo {
        sample_rate: u32,
        channels: u16,
        bits_per_sample: u16,
        encoding: SampleEncoding,
    }

    struct MixFormatPtr(*mut WAVEFORMATEX);

    impl MixFormatPtr {
        fn as_ptr(&self) -> *const WAVEFORMATEX {
            self.0 as *const WAVEFORMATEX
        }
    }

    impl Drop for MixFormatPtr {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CoTaskMemFree(Some(self.0.cast()));
                }
            }
        }
    }

    fn default_capture_audio_client() -> Result<IAudioClient, String> {
        let device_enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|error| format!("Failed to create audio device enumerator: {error}"))?;

        let device = unsafe { device_enumerator.GetDefaultAudioEndpoint(eCapture, eConsole) }
            .map_err(|error| format!("Failed to get default Windows input device: {error}"))?;

        unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|error| format!("Failed to activate Windows WASAPI input client: {error}"))
    }

    fn probe_default_capture() -> Result<(), String> {
        let _com = ComGuard::initialize()?;
        let audio_client = default_capture_audio_client()?;
        let mix_format = MixFormatPtr(
            unsafe { audio_client.GetMixFormat() }
                .map_err(|error| format!("Failed to read Windows input mix format: {error}"))?,
        );
        let _ = unsafe { read_wave_format_info(mix_format.as_ptr())? };
        Ok(())
    }

    unsafe fn read_wave_format_info(
        format_ptr: *const WAVEFORMATEX,
    ) -> Result<WaveFormatInfo, String> {
        if format_ptr.is_null() {
            return Err("Windows input mix format was null.".to_string());
        }

        let format_tag = unsafe { ptr::addr_of!((*format_ptr).wFormatTag).read_unaligned() };
        let channels = unsafe { ptr::addr_of!((*format_ptr).nChannels).read_unaligned() };
        let sample_rate = unsafe { ptr::addr_of!((*format_ptr).nSamplesPerSec).read_unaligned() };
        let block_align = unsafe { ptr::addr_of!((*format_ptr).nBlockAlign).read_unaligned() };
        let bits_per_sample =
            unsafe { ptr::addr_of!((*format_ptr).wBitsPerSample).read_unaligned() };
        let cb_size = unsafe { ptr::addr_of!((*format_ptr).cbSize).read_unaligned() };

        if channels == 0 || sample_rate == 0 || block_align == 0 {
            return Err(format!(
                "Invalid Windows input mix format: channels={channels}, sample_rate={sample_rate}, block_align={block_align}"
            ));
        }

        let (encoding, bits_per_sample) = if format_tag == WAVE_FORMAT_EXTENSIBLE && cb_size >= 22 {
            let extensible = format_ptr as *const WAVEFORMATEXTENSIBLE;
            let sub_format = unsafe { ptr::addr_of!((*extensible).SubFormat).read_unaligned() };
            let valid_bits = unsafe {
                ptr::addr_of!((*extensible).Samples.wValidBitsPerSample).read_unaligned()
            };
            let effective_bits = if valid_bits == 0 {
                bits_per_sample
            } else {
                valid_bits
            };

            if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                (SampleEncoding::Float, effective_bits)
            } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                (SampleEncoding::Pcm, effective_bits)
            } else {
                return Err(format!(
                    "Unsupported Windows WASAPI extensible input sub-format: {sub_format:?}"
                ));
            }
        } else if format_tag == WAVE_FORMAT_IEEE_FLOAT {
            (SampleEncoding::Float, bits_per_sample)
        } else if format_tag == WAVE_FORMAT_PCM as u16 {
            (SampleEncoding::Pcm, bits_per_sample)
        } else {
            return Err(format!(
                "Unsupported Windows WASAPI input format tag: {format_tag}"
            ));
        };

        Ok(WaveFormatInfo {
            sample_rate,
            channels,
            bits_per_sample,
            block_align,
            encoding,
        })
    }

    fn read_pcm_sample(bytes: &[u8], bytes_per_sample: usize) -> f32 {
        match bytes_per_sample {
            1 => (bytes[0] as f32 - 128.0) / 128.0,
            2 => i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32_768.0,
            3 => {
                let value =
                    (bytes[0] as i32) | ((bytes[1] as i32) << 8) | ((bytes[2] as i32) << 16);
                let signed = if value & 0x0080_0000 != 0 {
                    value | !0x00ff_ffff
                } else {
                    value
                };
                signed as f32 / 8_388_608.0
            }
            4 => {
                i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32
                    / 2_147_483_648.0
            }
            _ => 0.0,
        }
    }

    fn read_float_sample(bytes: &[u8], bytes_per_sample: usize) -> f32 {
        match bytes_per_sample {
            4 => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            8 => f64::from_le_bytes([
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ]) as f32,
            _ => 0.0,
        }
    }

    unsafe fn append_capture_buffer(
        data: *const u8,
        frames: u32,
        flags: u32,
        format: &WaveFormatInfo,
        samples: &Arc<Mutex<Vec<f32>>>,
    ) -> Result<(), String> {
        let frame_count = frames as usize;
        if frame_count == 0 {
            return Ok(());
        }

        let max_samples = format.sample_rate as usize * MAX_CAPTURE_SECONDS;
        let channels = usize::from(format.channels);
        let block_align = usize::from(format.block_align);
        let bytes_per_sample = block_align
            .checked_div(channels)
            .filter(|size| *size > 0)
            .ok_or_else(|| "Invalid Windows WASAPI block alignment.".to_string())?;

        let mut guard = samples
            .lock()
            .map_err(|_| "Windows recorder samples poisoned".to_string())?;
        if guard.len() >= max_samples {
            return Ok(());
        }

        let remaining = max_samples - guard.len();
        let frames_to_copy = frame_count.min(remaining);
        guard.reserve(frames_to_copy);

        let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
        if silent {
            guard.extend(std::iter::repeat(0.0).take(frames_to_copy));
            return Ok(());
        }
        if data.is_null() {
            return Err("Windows WASAPI returned a null capture buffer.".to_string());
        }

        let byte_len = frame_count
            .checked_mul(block_align)
            .ok_or_else(|| "Windows WASAPI capture packet is too large.".to_string())?;
        let bytes = unsafe { std::slice::from_raw_parts(data, byte_len) };

        for frame_index in 0..frames_to_copy {
            let frame_start = frame_index * block_align;
            let mut sum = 0.0f32;

            for channel in 0..channels {
                let sample_start = frame_start + channel * bytes_per_sample;
                let sample_end = sample_start + bytes_per_sample;
                if sample_end > bytes.len() {
                    break;
                }
                let sample_bytes = &bytes[sample_start..sample_end];
                let value = match format.encoding {
                    SampleEncoding::Pcm => read_pcm_sample(sample_bytes, bytes_per_sample),
                    SampleEncoding::Float => read_float_sample(sample_bytes, bytes_per_sample),
                };
                sum += value.clamp(-1.0, 1.0);
            }

            guard.push(sum / channels as f32);
        }

        Ok(())
    }

    fn drain_available_packets(
        capture_client: &IAudioCaptureClient,
        format: &WaveFormatInfo,
        samples: &Arc<Mutex<Vec<f32>>>,
    ) -> Result<(), String> {
        loop {
            let packet_size = unsafe { capture_client.GetNextPacketSize() }
                .map_err(|error| format!("Failed to query Windows WASAPI packet size: {error}"))?;
            if packet_size == 0 {
                return Ok(());
            }

            let mut data: *mut u8 = ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            unsafe {
                capture_client
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|error| {
                        format!("Failed to read Windows WASAPI capture buffer: {error}")
                    })?;
            }

            let append_result =
                unsafe { append_capture_buffer(data.cast_const(), frames, flags, format, samples) };
            let release_result = unsafe { capture_client.ReleaseBuffer(frames) }.map_err(|error| {
                format!("Failed to release Windows WASAPI capture buffer: {error}")
            });

            append_result?;
            release_result?;
        }
    }

    fn capture_worker(
        stop_requested: Arc<AtomicBool>,
        samples: Arc<Mutex<Vec<f32>>>,
        ready_tx: mpsc::Sender<Result<CaptureInfo, String>>,
    ) -> Result<(), String> {
        let result = run_capture_worker(stop_requested, samples, ready_tx);
        if let Err(error) = &result {
            eprintln!("[recording] Windows WASAPI worker stopped with error: {error}");
        }
        result
    }

    fn run_capture_worker(
        stop_requested: Arc<AtomicBool>,
        samples: Arc<Mutex<Vec<f32>>>,
        ready_tx: mpsc::Sender<Result<CaptureInfo, String>>,
    ) -> Result<(), String> {
        let _com = ComGuard::initialize()?;
        let audio_client = default_capture_audio_client()?;
        let mix_format = MixFormatPtr(
            unsafe { audio_client.GetMixFormat() }
                .map_err(|error| format!("Failed to read Windows input mix format: {error}"))?,
        );
        let format = unsafe { read_wave_format_info(mix_format.as_ptr())? };

        unsafe {
            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                    0,
                    0,
                    mix_format.as_ptr(),
                    None,
                )
                .map_err(|error| {
                    format!("Failed to initialize Windows WASAPI input client: {error}")
                })?;
        }

        let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
            .map_err(|error| format!("Failed to get Windows WASAPI capture client: {error}"))?;

        unsafe {
            audio_client
                .Start()
                .map_err(|error| format!("Failed to start Windows WASAPI input client: {error}"))?;
        }

        let info = CaptureInfo {
            sample_rate: format.sample_rate,
            channels: format.channels,
            bits_per_sample: format.bits_per_sample,
            encoding: format.encoding,
        };
        let _ = ready_tx.send(Ok(info.clone()));

        while !stop_requested.load(Ordering::SeqCst) {
            drain_available_packets(&capture_client, &format, &samples)?;
            thread::sleep(Duration::from_millis(10));
        }

        for _ in 0..4 {
            drain_available_packets(&capture_client, &format, &samples)?;
            thread::sleep(Duration::from_millis(3));
        }

        unsafe {
            audio_client
                .Stop()
                .map_err(|error| format!("Failed to stop Windows WASAPI input client: {error}"))?;
        }

        Ok(())
    }

    fn resample_linear(samples: &[f32], input_rate: u32, output_rate: u32) -> Vec<f32> {
        if samples.is_empty() || input_rate == 0 {
            return Vec::new();
        }
        if input_rate == output_rate {
            return samples.to_vec();
        }

        let output_len =
            ((samples.len() as f64 * output_rate as f64) / input_rate as f64).round() as usize;
        let output_len = output_len.max(1);
        let ratio = input_rate as f64 / output_rate as f64;
        let mut output = Vec::with_capacity(output_len);

        for index in 0..output_len {
            let source_pos = index as f64 * ratio;
            let source_index = source_pos.floor() as usize;
            let fraction = (source_pos - source_index as f64) as f32;
            let current = samples
                .get(source_index)
                .copied()
                .unwrap_or_else(|| *samples.last().unwrap_or(&0.0));
            let next = samples.get(source_index + 1).copied().unwrap_or(current);
            output.push(current + (next - current) * fraction);
        }

        output
    }

    fn float_to_i16(sample: f32) -> i16 {
        let clamped = sample.clamp(-1.0, 1.0);
        if clamped < 0.0 {
            (clamped * 32_768.0).round() as i16
        } else {
            (clamped * 32_767.0).round() as i16
        }
    }

    fn write_wav_mono_i16(samples: &[i16], sample_rate: u32) -> Result<Vec<u8>, String> {
        let data_len = samples
            .len()
            .checked_mul(2)
            .ok_or_else(|| "WAV data is too large.".to_string())?;
        let data_len_u32 =
            u32::try_from(data_len).map_err(|_| "WAV data exceeds 4 GiB.".to_string())?;
        let riff_len = 36u32
            .checked_add(data_len_u32)
            .ok_or_else(|| "WAV data exceeds RIFF size limits.".to_string())?;
        let byte_rate = sample_rate * u32::from(OUTPUT_CHANNELS) * 2;
        let block_align = OUTPUT_CHANNELS * 2;

        let mut bytes = Vec::with_capacity(44 + data_len);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&riff_len.to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&OUTPUT_CHANNELS.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len_u32.to_le_bytes());

        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        Ok(bytes)
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
            .map_err(|_| "Windows recorder state poisoned".to_string())?;

        if guard.as_ref().is_some() {
            return Err("Recording already in progress".to_string());
        }

        let samples = Arc::new(Mutex::new(Vec::new()));
        let stop_requested = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel();
        let worker_samples = Arc::clone(&samples);
        let worker_stop = Arc::clone(&stop_requested);
        let worker = thread::Builder::new()
            .name("typefree-windows-wasapi-recorder".to_string())
            .spawn(move || capture_worker(worker_stop, worker_samples, ready_tx))
            .map_err(|error| format!("Failed to spawn Windows WASAPI capture thread: {error}"))?;

        let capture_info = match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(info)) => info,
            Ok(Err(error)) => {
                let _ = worker.join();
                return Err(error);
            }
            Err(error) => {
                stop_requested.store(true, Ordering::SeqCst);
                let _ = worker.join();
                return Err(format!(
                    "Windows WASAPI recorder did not become ready: {error}"
                ));
            }
        };

        let initial_capacity = (capture_info.sample_rate as usize * 30).min(
            (capture_info.sample_rate as usize)
                .saturating_mul(MAX_CAPTURE_SECONDS)
                .max(1),
        );
        if let Ok(mut guard) = samples.lock() {
            guard.reserve(initial_capacity);
        }

        eprintln!(
            "[recording] Windows WASAPI recording started: sample_rate={}, channels={}, bits={}, encoding={:?}",
            capture_info.sample_rate,
            capture_info.channels,
            capture_info.bits_per_sample,
            capture_info.encoding
        );

        *guard = Some(RecorderState {
            worker,
            stop_requested,
            samples,
            input_sample_rate: capture_info.sample_rate,
            started_at: Instant::now(),
        });

        Ok(())
    }

    pub fn stop() -> Result<NativeRecordingResult, String> {
        let recorder_state = {
            let mut guard = state()
                .lock()
                .map_err(|_| "Windows recorder state poisoned".to_string())?;
            guard
                .take()
                .ok_or_else(|| "Not currently recording".to_string())?
        };

        let RecorderState {
            worker,
            stop_requested,
            samples,
            input_sample_rate,
            started_at,
        } = recorder_state;
        let duration_seconds = Some(started_at.elapsed().as_secs_f64());

        stop_requested.store(true, Ordering::SeqCst);
        let worker_result = worker
            .join()
            .map_err(|_| "Windows WASAPI capture thread panicked".to_string())?;
        if let Err(error) = worker_result {
            eprintln!("[recording] Windows WASAPI worker returned during stop: {error}");
        }

        let captured = samples
            .lock()
            .map_err(|_| "Windows recorder samples poisoned".to_string())?
            .clone();

        if captured.is_empty() {
            return Err("Native recording produced no audio samples".to_string());
        }

        let resampled = resample_linear(&captured, input_sample_rate, OUTPUT_SAMPLE_RATE);
        let pcm = resampled.into_iter().map(float_to_i16).collect::<Vec<_>>();
        let audio_data = write_wav_mono_i16(&pcm, OUTPUT_SAMPLE_RATE)?;

        Ok(NativeRecordingResult {
            audio_data,
            mime_type: "audio/wav".to_string(),
            duration_seconds,
        })
    }

    pub fn cancel() -> Result<(), String> {
        let recorder_state = {
            let mut guard = state()
                .lock()
                .map_err(|_| "Windows recorder state poisoned".to_string())?;
            guard.take()
        };

        if let Some(recorder_state) = recorder_state {
            recorder_state.stop_requested.store(true, Ordering::SeqCst);
            let _ = recorder_state.worker.join();
            if let Ok(mut samples) = recorder_state.samples.lock() {
                samples.clear();
            }
        }

        Ok(())
    }

    impl AudioRecorder for WindowsWasapiRecorder {
        fn backend(&self) -> &'static str {
            "windows-wasapi"
        }

        fn status(&self) -> String {
            "ready".to_string()
        }

        fn reason(&self) -> Option<String> {
            if is_active() {
                return None;
            }

            probe_default_capture().err()
        }

        fn is_supported(&self) -> bool {
            self.reason().is_none()
        }

        fn is_active(&self) -> bool {
            is_active()
        }

        fn start(&self) -> Result<(), String> {
            start()
        }

        fn stop(&self) -> Result<NativeRecordingResult, String> {
            stop()
        }

        fn cancel(&self) -> Result<(), String> {
            cancel()
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_recorder {
    use super::{AudioRecorder, NativeRecordingResult};
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    pub static RECORDER: LinuxPipewirePulseRecorder = LinuxPipewirePulseRecorder;

    pub struct LinuxPipewirePulseRecorder;

    #[derive(Debug, Clone, Copy)]
    enum LinuxCaptureTool {
        PipeWire,
        PulseAudioRecord,
        PulseAudioCat,
    }

    struct RecorderState {
        child: Child,
        path: PathBuf,
        started_at: Instant,
        tool: LinuxCaptureTool,
    }

    static RECORDER_STATE: OnceLock<Mutex<Option<RecorderState>>> = OnceLock::new();

    fn state() -> &'static Mutex<Option<RecorderState>> {
        RECORDER_STATE.get_or_init(|| Mutex::new(None))
    }

    impl LinuxCaptureTool {
        fn program(self) -> &'static str {
            match self {
                LinuxCaptureTool::PipeWire => "pw-record",
                LinuxCaptureTool::PulseAudioRecord => "parecord",
                LinuxCaptureTool::PulseAudioCat => "parec",
            }
        }

        fn args(self, path: &Path) -> Vec<String> {
            let path = path.to_string_lossy().to_string();
            match self {
                LinuxCaptureTool::PipeWire => vec![
                    "--format".to_string(),
                    "s16".to_string(),
                    "--rate".to_string(),
                    "16000".to_string(),
                    "--channels".to_string(),
                    "1".to_string(),
                    path,
                ],
                LinuxCaptureTool::PulseAudioRecord | LinuxCaptureTool::PulseAudioCat => vec![
                    "--file-format=wav".to_string(),
                    "--format=s16le".to_string(),
                    "--rate=16000".to_string(),
                    "--channels=1".to_string(),
                    path,
                ],
            }
        }
    }

    fn selected_tool() -> Option<LinuxCaptureTool> {
        [
            LinuxCaptureTool::PipeWire,
            LinuxCaptureTool::PulseAudioRecord,
            LinuxCaptureTool::PulseAudioCat,
        ]
        .into_iter()
        .find(|tool| command_exists(tool.program()))
    }

    fn command_exists(program: &str) -> bool {
        let Some(paths) = env::var_os("PATH") else {
            return false;
        };
        env::split_paths(&paths).any(|dir| {
            let candidate = dir.join(program);
            candidate.is_file()
        })
    }

    fn unique_recording_path() -> PathBuf {
        let pid = std::process::id();
        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        env::temp_dir().join(format!("typefree-linux-recording-{pid}-{now_ns}.wav"))
    }

    fn is_wav_header(bytes: &[u8]) -> bool {
        bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
    }

    fn bytes_prefix_hex(bytes: &[u8], max_len: usize) -> String {
        let prefix = &bytes[..bytes.len().min(max_len)];
        let mut out = String::new();
        for (idx, byte) in prefix.iter().enumerate() {
            if idx > 0 {
                out.push(' ');
            }
            out.push_str(&format!("{byte:02x}"));
        }
        out
    }

    fn read_wav_with_retry(path: &Path) -> Result<Vec<u8>, String> {
        let mut last_len = 0usize;
        let mut last_prefix = String::new();

        for _ in 0..25 {
            match fs::read(path) {
                Ok(bytes) => {
                    last_len = bytes.len();
                    last_prefix = bytes_prefix_hex(&bytes, 16);
                    if is_wav_header(&bytes) && bytes.len() >= 44 {
                        return Ok(bytes);
                    }
                }
                Err(_) => {}
            }
            thread::sleep(Duration::from_millis(20));
        }

        Err(format!(
            "Linux native recording did not produce a valid WAV (len={last_len}, prefix={last_prefix})"
        ))
    }

    fn send_interrupt(child: &Child) -> Result<(), String> {
        let status = Command::new("kill")
            .arg("-INT")
            .arg(child.id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("Failed to send SIGINT to Linux recorder: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Failed to send SIGINT to Linux recorder: kill exited with {status}"
            ))
        }
    }

    fn wait_for_exit(child: &mut Child, timeout: Duration) -> Result<(), String> {
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_status)) => return Ok(()),
                Ok(None) if started.elapsed() < timeout => {
                    thread::sleep(Duration::from_millis(25));
                }
                Ok(None) => {
                    child
                        .kill()
                        .map_err(|error| format!("Failed to kill Linux recorder: {error}"))?;
                    let _ = child.wait();
                    return Ok(());
                }
                Err(error) => return Err(format!("Failed to wait for Linux recorder: {error}")),
            }
        }
    }

    pub fn is_active() -> bool {
        let mut guard = match state().lock() {
            Ok(guard) => guard,
            Err(_) => return false,
        };

        let exited = match guard.as_mut() {
            Some(recorder_state) => match recorder_state.child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) | Err(_) => return true,
            },
            None => return false,
        };

        if exited {
            if let Some(stale) = guard.take() {
                let _ = fs::remove_file(stale.path);
            }
        }
        false
    }

    pub fn start() -> Result<(), String> {
        let mut guard = state()
            .lock()
            .map_err(|_| "Linux recorder state poisoned".to_string())?;
        if guard.as_ref().is_some() {
            return Err("Recording already in progress".to_string());
        }

        let tool = selected_tool().ok_or_else(|| {
            "No Linux native recorder found. Install PipeWire pw-record or PulseAudio parecord/parec."
                .to_string()
        })?;
        let path = unique_recording_path();
        let args = tool.args(&path);
        let mut child = Command::new(tool.program())
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to start Linux native recorder '{}': {error}",
                    tool.program()
                )
            })?;

        thread::sleep(Duration::from_millis(120));
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to inspect Linux recorder startup: {error}"))?
        {
            let _ = fs::remove_file(&path);
            return Err(format!(
                "Linux native recorder '{}' exited immediately with {status}",
                tool.program()
            ));
        }

        eprintln!(
            "[recording] Linux native recording started via {}",
            tool.program()
        );

        *guard = Some(RecorderState {
            child,
            path,
            started_at: Instant::now(),
            tool,
        });
        Ok(())
    }

    pub fn stop() -> Result<NativeRecordingResult, String> {
        let mut recorder_state = {
            let mut guard = state()
                .lock()
                .map_err(|_| "Linux recorder state poisoned".to_string())?;
            guard
                .take()
                .ok_or_else(|| "Not currently recording".to_string())?
        };

        let duration_seconds = Some(recorder_state.started_at.elapsed().as_secs_f64());
        if let Err(error) = send_interrupt(&recorder_state.child) {
            eprintln!("[recording] {error}; falling back to kill after grace period");
        }
        wait_for_exit(&mut recorder_state.child, Duration::from_secs(2))?;

        let audio_data = read_wav_with_retry(&recorder_state.path)?;
        let _ = fs::remove_file(&recorder_state.path);
        eprintln!(
            "[recording] Linux native recording stopped via {}: bytes={}, duration={:?}",
            recorder_state.tool.program(),
            audio_data.len(),
            duration_seconds
        );

        Ok(NativeRecordingResult {
            audio_data,
            mime_type: "audio/wav".to_string(),
            duration_seconds,
        })
    }

    pub fn cancel() -> Result<(), String> {
        let recorder_state = {
            let mut guard = state()
                .lock()
                .map_err(|_| "Linux recorder state poisoned".to_string())?;
            guard.take()
        };

        if let Some(mut recorder_state) = recorder_state {
            let _ = send_interrupt(&recorder_state.child);
            let _ = wait_for_exit(&mut recorder_state.child, Duration::from_millis(500));
            let _ = fs::remove_file(recorder_state.path);
        }

        Ok(())
    }

    impl AudioRecorder for LinuxPipewirePulseRecorder {
        fn backend(&self) -> &'static str {
            "linux-pipewire-pulseaudio"
        }

        fn status(&self) -> String {
            if is_active() {
                "active".to_string()
            } else if selected_tool().is_some() {
                "ready".to_string()
            } else {
                "missing-dependency".to_string()
            }
        }

        fn reason(&self) -> Option<String> {
            if selected_tool().is_some() {
                None
            } else {
                Some(
                    "Install PipeWire pw-record or PulseAudio parecord/parec to enable Linux native recording; renderer MediaRecorder remains the fallback.".to_string(),
                )
            }
        }

        fn is_supported(&self) -> bool {
            selected_tool().is_some()
        }

        fn is_active(&self) -> bool {
            is_active()
        }

        fn start(&self) -> Result<(), String> {
            start()
        }

        fn stop(&self) -> Result<NativeRecordingResult, String> {
            stop()
        }

        fn cancel(&self) -> Result<(), String> {
            cancel()
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod unsupported_recorder {
    use super::{AudioRecorder, NativeRecordingResult};

    pub static RECORDER: UnsupportedAudioRecorder = UnsupportedAudioRecorder;

    pub struct UnsupportedAudioRecorder;

    impl AudioRecorder for UnsupportedAudioRecorder {
        fn backend(&self) -> &'static str {
            "unsupported"
        }

        fn status(&self) -> String {
            "unavailable".to_string()
        }

        fn reason(&self) -> Option<String> {
            Some("Native recording is not available on this platform.".to_string())
        }

        fn is_supported(&self) -> bool {
            false
        }

        fn is_active(&self) -> bool {
            false
        }

        fn start(&self) -> Result<(), String> {
            Err(self
                .reason()
                .unwrap_or_else(|| "Native recording is unavailable".to_string()))
        }

        fn stop(&self) -> Result<NativeRecordingResult, String> {
            Err(self
                .reason()
                .unwrap_or_else(|| "Native recording is unavailable".to_string()))
        }

        fn cancel(&self) -> Result<(), String> {
            Ok(())
        }
    }
}
