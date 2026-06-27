#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use tauri::AppHandle;

use super::recording::NativeRecordingResult;

const OUTPUT_SAMPLE_RATE: u32 = 16_000;
const DEFAULT_PRE_ROLL_MS: u32 = 250;
const MAX_PRE_ROLL_MS: u32 = 2000;
const FRAME_SECONDS: f64 = 0.02;
const TRIM_PADDING_SECONDS: f64 = 0.18;
const MIN_OUTPUT_SECONDS: f64 = 0.35;
const SILENCE_FLOOR: f32 = 0.0025;
const BASE_ACTIVITY_THRESHOLD: f32 = 0.0035;
const GATE_FLOOR: f32 = 0.002;

#[derive(Debug, Clone, Copy)]
struct AudioQualitySettings {
    processing_enabled: bool,
    noise_gate_enabled: bool,
    pre_roll_ms: u32,
}

#[derive(Debug, Clone)]
pub struct PreparedNativeRecording {
    pub result: NativeRecordingResult,
    pub processed: bool,
}

#[derive(Debug)]
struct DecodedWav {
    samples: Vec<f32>,
    sample_rate: u32,
}

#[derive(Debug)]
struct VoiceActivity {
    start_sample: usize,
    end_sample: usize,
    threshold: f32,
}

pub fn prepare_native_recording(
    app: &AppHandle,
    result: NativeRecordingResult,
) -> Result<PreparedNativeRecording, String> {
    let settings = read_audio_quality_settings(app);
    if !settings.processing_enabled || result.audio_data.is_empty() {
        return Ok(PreparedNativeRecording {
            result,
            processed: false,
        });
    }

    if !result.mime_type.eq_ignore_ascii_case("audio/wav") {
        eprintln!(
            "[audio-quality] skipped native preprocessing for unsupported mime type: {}",
            result.mime_type
        );
        return Ok(PreparedNativeRecording {
            result,
            processed: false,
        });
    }

    let decoded = match decode_wav_pcm16(&result.audio_data) {
        Ok(decoded) => decoded,
        Err(err) => {
            eprintln!("[audio-quality] skipped native preprocessing: {err}");
            return Ok(PreparedNativeRecording {
                result,
                processed: false,
            });
        }
    };

    let activity =
        analyze_voice_activity(&decoded.samples, decoded.sample_rate, settings.pre_roll_ms)
            .ok_or_else(|| "No audio detected".to_string())?;
    let mut processed_samples =
        decoded.samples[activity.start_sample..activity.end_sample].to_vec();

    if settings.noise_gate_enabled {
        apply_noise_gate(
            &mut processed_samples,
            decoded.sample_rate,
            activity.threshold,
        );
    }

    let output_samples = if decoded.sample_rate == OUTPUT_SAMPLE_RATE {
        processed_samples
    } else {
        resample_linear(&processed_samples, decoded.sample_rate, OUTPUT_SAMPLE_RATE)
    };
    let audio_data = write_wav_mono_i16(&output_samples, OUTPUT_SAMPLE_RATE)?;
    let duration_seconds = if output_samples.is_empty() {
        None
    } else {
        Some(output_samples.len() as f64 / f64::from(OUTPUT_SAMPLE_RATE))
    };

    eprintln!(
        "[audio-quality] native recording processed: input_duration={:?}, output_duration={:?}, input_bytes={}, output_bytes={}, noise_gate={}, pre_roll_ms={}",
        result.duration_seconds,
        duration_seconds,
        result.audio_data.len(),
        audio_data.len(),
        settings.noise_gate_enabled,
        settings.pre_roll_ms
    );

    Ok(PreparedNativeRecording {
        result: NativeRecordingResult {
            audio_data,
            mime_type: "audio/wav".to_string(),
            duration_seconds,
        },
        processed: true,
    })
}

fn read_audio_quality_settings(app: &AppHandle) -> AudioQualitySettings {
    AudioQualitySettings {
        processing_enabled: read_bool_setting(app, "audioQualityProcessingEnabled", true),
        noise_gate_enabled: read_bool_setting(app, "audioQualityNoiseGateEnabled", false),
        pre_roll_ms: read_u32_setting(
            app,
            "audioQualityPreRollMs",
            DEFAULT_PRE_ROLL_MS,
            MAX_PRE_ROLL_MS,
        ),
    }
}

fn read_bool_setting(app: &AppHandle, key: &str, default_value: bool) -> bool {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|text| match text.trim().to_ascii_lowercase().as_str() {
                        "true" | "1" | "yes" | "on" => Some(true),
                        "false" | "0" | "no" | "off" => Some(false),
                        _ => None,
                    })
            })
        })
        .unwrap_or(default_value)
}

fn decode_wav_pcm16(bytes: &[u8]) -> Result<DecodedWav, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Native recording is not a RIFF/WAVE file".to_string());
    }

    let mut offset = 12usize;
    let mut format: Option<(u16, u16, u32, u16, u16)> = None;
    let mut data_range: Option<(usize, usize)> = None;

    while offset + 8 <= bytes.len() {
        let chunk_id = &bytes[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start
            .checked_add(chunk_size)
            .ok_or_else(|| "WAV chunk is too large".to_string())?;
        if chunk_end > bytes.len() {
            break;
        }

        match chunk_id {
            b"fmt " if chunk_size >= 16 => {
                let audio_format = read_u16_le(bytes, chunk_start)?;
                let channels = read_u16_le(bytes, chunk_start + 2)?;
                let sample_rate = read_u32_le(bytes, chunk_start + 4)?;
                let block_align = read_u16_le(bytes, chunk_start + 12)?;
                let bits_per_sample = read_u16_le(bytes, chunk_start + 14)?;
                format = Some((
                    audio_format,
                    channels,
                    sample_rate,
                    block_align,
                    bits_per_sample,
                ));
            }
            b"data" => {
                data_range = Some((chunk_start, chunk_end));
            }
            _ => {}
        }

        offset = chunk_end + (chunk_size % 2);
    }

    let (audio_format, channels, sample_rate, block_align, bits_per_sample) =
        format.ok_or_else(|| "WAV fmt chunk is missing".to_string())?;
    if audio_format != 1 || bits_per_sample != 16 {
        return Err(format!(
            "Unsupported native WAV format: format={audio_format}, bits={bits_per_sample}"
        ));
    }
    if channels == 0 || sample_rate == 0 {
        return Err(format!(
            "Invalid native WAV format: channels={channels}, sample_rate={sample_rate}"
        ));
    }

    let bytes_per_frame = usize::from(block_align);
    let expected_frame_size = usize::from(channels) * 2;
    if bytes_per_frame < expected_frame_size || bytes_per_frame == 0 {
        return Err(format!("Invalid native WAV block alignment: {block_align}"));
    }

    let (data_start, data_end) =
        data_range.ok_or_else(|| "WAV data chunk is missing".to_string())?;
    let data = &bytes[data_start..data_end];
    let frame_count = data.len() / bytes_per_frame;
    let mut samples = Vec::with_capacity(frame_count);

    for frame in 0..frame_count {
        let frame_start = frame * bytes_per_frame;
        let mut sum = 0.0f32;
        for channel in 0..usize::from(channels) {
            let sample_start = frame_start + channel * 2;
            let sample = i16::from_le_bytes([data[sample_start], data[sample_start + 1]]);
            sum += sample as f32 / 32_768.0;
        }
        samples.push((sum / f32::from(channels)).clamp(-1.0, 1.0));
    }

    Ok(DecodedWav {
        samples,
        sample_rate,
    })
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Result<u16, String> {
    if offset + 2 > bytes.len() {
        return Err("Unexpected end of WAV data".to_string());
    }
    Ok(u16::from_le_bytes([bytes[offset], bytes[offset + 1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    if offset + 4 > bytes.len() {
        return Err("Unexpected end of WAV data".to_string());
    }
    Ok(u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}

fn read_u32_setting(app: &AppHandle, key: &str, default_value: u32, max_value: u32) -> u32 {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| {
            value.as_u64().or_else(|| {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<u64>().ok())
            })
        })
        .map(|value| value.min(u64::from(max_value)) as u32)
        .unwrap_or(default_value)
}

fn analyze_voice_activity(
    samples: &[f32],
    sample_rate: u32,
    pre_roll_ms: u32,
) -> Option<VoiceActivity> {
    if samples.is_empty() || sample_rate == 0 {
        return None;
    }

    let frame_size = ((f64::from(sample_rate) * FRAME_SECONDS).round() as usize).max(1);
    let mut frames = Vec::new();
    let mut max_rms = 0.0f32;
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + frame_size).min(samples.len());
        let rms = frame_rms(&samples[start..end]);
        max_rms = max_rms.max(rms);
        frames.push((start, end, rms));
        start = end;
    }

    if max_rms < SILENCE_FLOOR {
        return None;
    }

    let threshold = BASE_ACTIVITY_THRESHOLD
        .max(SILENCE_FLOOR)
        .max(max_rms * 0.08);
    let first_active = frames.iter().position(|(_, _, rms)| *rms >= threshold)?;
    let last_active = frames.iter().rposition(|(_, _, rms)| *rms >= threshold)?;
    let pre_roll_seconds = f64::from(pre_roll_ms.min(MAX_PRE_ROLL_MS)) / 1000.0;
    let leading_padding_seconds = TRIM_PADDING_SECONDS.max(pre_roll_seconds);
    let leading_padding_samples =
        (f64::from(sample_rate) * leading_padding_seconds).round() as usize;
    let padding_samples = (f64::from(sample_rate) * TRIM_PADDING_SECONDS).round() as usize;
    let min_output_samples = (f64::from(sample_rate) * MIN_OUTPUT_SECONDS).round() as usize;

    let mut start_sample = frames[first_active]
        .0
        .saturating_sub(leading_padding_samples);
    let mut end_sample = (frames[last_active].1 + padding_samples).min(samples.len());
    if end_sample <= start_sample {
        return None;
    }

    if end_sample - start_sample < min_output_samples {
        let missing = min_output_samples - (end_sample - start_sample);
        let extend_left = (missing / 2).min(start_sample);
        start_sample -= extend_left;
        end_sample = (end_sample + (missing - extend_left)).min(samples.len());
    }

    Some(VoiceActivity {
        start_sample,
        end_sample,
        threshold,
    })
}

fn frame_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum = samples.iter().map(|sample| sample * sample).sum::<f32>();
    (sum / samples.len() as f32).sqrt()
}

fn apply_noise_gate(samples: &mut [f32], sample_rate: u32, activity_threshold: f32) {
    if samples.is_empty() || sample_rate == 0 {
        return;
    }

    let frame_size = ((f64::from(sample_rate) * FRAME_SECONDS).round() as usize).max(1);
    let gate_threshold = (activity_threshold * 0.75).max(GATE_FLOOR);
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + frame_size).min(samples.len());
        if frame_rms(&samples[start..end]) < gate_threshold {
            samples[start..end].fill(0.0);
        }
        start = end;
    }
}

fn resample_linear(samples: &[f32], input_sample_rate: u32, output_sample_rate: u32) -> Vec<f32> {
    if samples.is_empty() || input_sample_rate == 0 || output_sample_rate == 0 {
        return Vec::new();
    }
    if input_sample_rate == output_sample_rate {
        return samples.to_vec();
    }

    let output_len = ((samples.len() as u64 * u64::from(output_sample_rate))
        / u64::from(input_sample_rate))
    .max(1) as usize;
    if samples.len() == 1 {
        return vec![samples[0]; output_len];
    }

    let ratio = input_sample_rate as f64 / output_sample_rate as f64;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source_position = index as f64 * ratio;
        let source_index = source_position.floor() as usize;
        let fraction = (source_position - source_index as f64) as f32;
        let current = samples
            .get(source_index)
            .copied()
            .unwrap_or_else(|| *samples.last().unwrap_or(&0.0));
        let next = samples.get(source_index + 1).copied().unwrap_or(current);
        output.push(current + (next - current) * fraction);
    }
    output
}

fn write_wav_mono_i16(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let data_len = samples
        .len()
        .checked_mul(2)
        .ok_or_else(|| "WAV data is too large".to_string())?;
    let data_len_u32 = u32::try_from(data_len).map_err(|_| "WAV data exceeds 4 GiB".to_string())?;
    let riff_len = 36u32
        .checked_add(data_len_u32)
        .ok_or_else(|| "WAV data exceeds RIFF size limits".to_string())?;
    let byte_rate = sample_rate * 2;
    let block_align = 2u16;

    let mut bytes = Vec::with_capacity(44 + data_len);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&riff_len.to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block_align.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len_u32.to_le_bytes());

    for sample in samples {
        bytes.extend_from_slice(&float_to_i16(*sample).to_le_bytes());
    }

    Ok(bytes)
}

fn float_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * 32_768.0).round() as i16
    } else {
        (clamped * 32_767.0).round() as i16
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_wav_with_tone() -> Vec<u8> {
        let sample_rate = 16_000u32;
        let mut samples = Vec::new();
        samples.extend(std::iter::repeat(0.0).take((sample_rate as f32 * 0.45) as usize));
        for index in 0..(sample_rate as f32 * 0.5) as usize {
            let t = index as f32 / sample_rate as f32;
            samples.push((t * 440.0 * std::f32::consts::TAU).sin() * 0.45);
        }
        samples.extend(std::iter::repeat(0.0).take((sample_rate as f32 * 0.5) as usize));
        write_wav_mono_i16(&samples, sample_rate).expect("synthetic wav")
    }

    #[test]
    fn decodes_and_trims_wav_activity() {
        let decoded = decode_wav_pcm16(&synthetic_wav_with_tone()).expect("decode");
        let activity =
            analyze_voice_activity(&decoded.samples, decoded.sample_rate, 250).expect("voice");
        let duration =
            (activity.end_sample - activity.start_sample) as f64 / decoded.sample_rate as f64;
        assert!(duration < 1.2, "duration should be trimmed, got {duration}");
        assert!(
            duration > 0.7,
            "duration should preserve padding, got {duration}"
        );
    }

    #[test]
    fn rejects_silent_wav_activity() {
        let samples = vec![0.0; 16_000];
        let wav = write_wav_mono_i16(&samples, 16_000).expect("silent wav");
        let decoded = decode_wav_pcm16(&wav).expect("decode");
        assert!(analyze_voice_activity(&decoded.samples, decoded.sample_rate, 250).is_none());
    }

    #[test]
    fn preserves_minimum_output_for_short_voice_activity() {
        let sample_rate = 1_000u32;
        let mut samples = vec![0.0; sample_rate as usize];
        for sample in samples.iter_mut().take(510).skip(500) {
            *sample = 0.4;
        }

        let activity = analyze_voice_activity(&samples, sample_rate, 250).expect("voice");
        let duration = (activity.end_sample - activity.start_sample) as f64 / sample_rate as f64;
        assert!(
            duration >= MIN_OUTPUT_SECONDS,
            "short activity should keep minimum duration, got {duration}"
        );
    }

    #[test]
    fn noise_gate_suppresses_quiet_frames_without_touching_voice() {
        let sample_rate = 100u32;
        let mut samples = vec![0.001, -0.001, 0.04, -0.04, 0.001, -0.001];

        apply_noise_gate(&mut samples, sample_rate, 0.02);

        assert_eq!(samples[0], 0.0);
        assert_eq!(samples[1], 0.0);
        assert!(samples[2].abs() > 0.03);
        assert!(samples[3].abs() > 0.03);
        assert_eq!(samples[4], 0.0);
        assert_eq!(samples[5], 0.0);
    }

    #[test]
    fn resamples_and_round_trips_prepared_wav() {
        let input = vec![0.0, 0.5, -0.5, 0.25];
        let resampled = resample_linear(&input, 8_000, OUTPUT_SAMPLE_RATE);

        assert_eq!(resampled.len(), 8);

        let wav = write_wav_mono_i16(&resampled, OUTPUT_SAMPLE_RATE).expect("wav");
        let decoded = decode_wav_pcm16(&wav).expect("decode");

        assert_eq!(decoded.sample_rate, OUTPUT_SAMPLE_RATE);
        assert_eq!(decoded.samples.len(), resampled.len());
        assert!(decoded
            .samples
            .iter()
            .all(|sample| (-1.0..=1.0).contains(sample)));
    }
}
