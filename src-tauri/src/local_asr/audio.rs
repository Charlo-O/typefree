//! Small WAV decoder used by native offline runtimes.

#[allow(dead_code)]
pub(crate) fn decode_wav_to_16k_mono(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("local ASR requires a PCM WAV audio payload".to_string());
    }

    let mut offset = 12usize;
    let mut channels = 0u16;
    let mut sample_rate = 0u32;
    let mut audio_format = 0u16;
    let mut bits_per_sample = 0u16;
    let mut data = None;

    while offset + 8 <= bytes.len() {
        let chunk_id = &bytes[offset..offset + 4];
        let chunk_size =
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start
            .checked_add(chunk_size)
            .ok_or_else(|| "invalid WAV chunk size".to_string())?;
        if chunk_end > bytes.len() {
            return Err("WAV chunk extends beyond audio payload".to_string());
        }

        match chunk_id {
            b"fmt " if chunk_size >= 16 => {
                audio_format =
                    u16::from_le_bytes(bytes[chunk_start..chunk_start + 2].try_into().unwrap());
                channels =
                    u16::from_le_bytes(bytes[chunk_start + 2..chunk_start + 4].try_into().unwrap());
                sample_rate =
                    u32::from_le_bytes(bytes[chunk_start + 4..chunk_start + 8].try_into().unwrap());
                bits_per_sample = u16::from_le_bytes(
                    bytes[chunk_start + 14..chunk_start + 16]
                        .try_into()
                        .unwrap(),
                );
            }
            b"data" => data = Some(&bytes[chunk_start..chunk_end]),
            _ => {}
        }

        // RIFF chunks are word aligned.
        offset = chunk_end + (chunk_size & 1);
    }

    let data = data.ok_or_else(|| "WAV payload has no data chunk".to_string())?;
    if channels == 0 || sample_rate == 0 {
        return Err("WAV payload has invalid channel or sample-rate metadata".to_string());
    }
    if audio_format != 1 && audio_format != 3 {
        return Err("local ASR supports PCM or IEEE-float WAV audio only".to_string());
    }
    if !matches!(bits_per_sample, 16 | 32) {
        return Err("local ASR supports 16-bit or 32-bit WAV samples only".to_string());
    }

    let bytes_per_sample = usize::from(bits_per_sample / 8);
    let frame_bytes = bytes_per_sample
        .checked_mul(usize::from(channels))
        .ok_or_else(|| "invalid WAV channel count".to_string())?;
    if frame_bytes == 0 || data.len() < frame_bytes {
        return Err("WAV payload has no complete audio frames".to_string());
    }

    let frame_count = data.len() / frame_bytes;
    let mut mono = Vec::with_capacity(frame_count);
    for frame in 0..frame_count {
        let frame_start = frame * frame_bytes;
        let mut sum = 0.0f32;
        for channel in 0..usize::from(channels) {
            let sample_start = frame_start + channel * bytes_per_sample;
            let sample = match (audio_format, bits_per_sample) {
                (1, 16) => {
                    let value = i16::from_le_bytes(
                        data[sample_start..sample_start + 2].try_into().unwrap(),
                    );
                    f32::from(value) / f32::from(i16::MAX)
                }
                (1, 32) => {
                    let value = i32::from_le_bytes(
                        data[sample_start..sample_start + 4].try_into().unwrap(),
                    );
                    value as f32 / 2_147_483_648.0
                }
                (3, 32) => {
                    f32::from_le_bytes(data[sample_start..sample_start + 4].try_into().unwrap())
                }
                _ => unreachable!("validated WAV format and sample width"),
            };
            sum += sample;
        }
        mono.push(sum / f32::from(channels));
    }

    if sample_rate == 16_000 {
        return Ok(mono);
    }

    let output_len = ((mono.len() as u64 * 16_000 + u64::from(sample_rate) - 1)
        / u64::from(sample_rate)) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source = index as f64 * f64::from(sample_rate) / 16_000.0;
        let left = source.floor() as usize;
        let right = (left + 1).min(mono.len() - 1);
        let fraction = (source - left as f64) as f32;
        output.push(mono[left.min(mono.len() - 1)] * (1.0 - fraction) + mono[right] * fraction);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::decode_wav_to_16k_mono;

    fn wav_pcm16(samples: &[i16], sample_rate: u32, channels: u16) -> Vec<u8> {
        let mut payload = Vec::new();
        for sample in samples {
            for _ in 0..channels {
                payload.extend_from_slice(&sample.to_le_bytes());
            }
        }
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36u32 + payload.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * u32::from(channels) * 2).to_le_bytes());
        wav.extend_from_slice(&(channels * 2).to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        wav.extend_from_slice(&payload);
        wav
    }

    #[test]
    fn decodes_pcm16_and_resamples_to_16khz() {
        let wav = wav_pcm16(&[0, 1000, -1000, 0], 8_000, 1);
        let samples = decode_wav_to_16k_mono(&wav).expect("decode WAV");
        assert_eq!(samples.len(), 8);
        assert!(samples[1] > 0.0);
        assert!(samples[2] > samples[1]);
    }

    #[test]
    fn rejects_non_wav_payloads() {
        let error = decode_wav_to_16k_mono(b"not audio").expect_err("invalid WAV");
        assert!(error.contains("PCM WAV"));
    }
}
