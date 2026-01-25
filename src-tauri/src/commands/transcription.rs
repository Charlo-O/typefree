use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionProvider {
    pub id: String,
    pub name: String,
    pub requires_key: bool,
}

/// Get available transcription providers
#[tauri::command]
pub fn get_transcription_providers() -> Vec<TranscriptionProvider> {
    vec![
        TranscriptionProvider {
            id: "openai".to_string(),
            name: "OpenAI Whisper".to_string(),
            requires_key: true,
        },
        TranscriptionProvider {
            id: "groq".to_string(),
            name: "Groq".to_string(),
            requires_key: true,
        },
        TranscriptionProvider {
            id: "zai".to_string(),
            name: "Z.ai (Zhipu GLM ASR)".to_string(),
            requires_key: true,
        },
    ]
}

/// Transcribe audio using cloud provider
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio_data: Vec<u8>,
    provider: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    // Get API key from settings
    let key_name = match provider.as_str() {
        "openai" => "OPENAI_API_KEY",
        "groq" => "GROQ_API_KEY",
        "zai" => "ZAI_API_KEY",
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let api_key = super::settings::get_env_var(app.clone(), key_name.to_string())?
        .ok_or_else(|| format!("{} not found. Please set your API key.", key_name))?;

    match provider.as_str() {
        "openai" => transcribe_openai(audio_data, api_key, model, language).await,
        "groq" => transcribe_groq(audio_data, api_key, model, language).await,
        "zai" => transcribe_zai(audio_data, api_key, model, language).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

async fn transcribe_openai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = model.unwrap_or_else(|| "whisper-1".to_string());

    // Create multipart form
    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.webm")
        .mime_str("audio/webm")
        .map_err(|e| e.to_string())?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(lang) = language {
        if lang != "auto" {
            form = form.text("language", lang);
        }
    }

    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", error_text));
    }

    #[derive(Deserialize)]
    struct OpenAIResponse {
        text: String,
    }

    let result: OpenAIResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(result.text)
}

async fn transcribe_groq(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = model.unwrap_or_else(|| "whisper-large-v3-turbo".to_string());

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.webm")
        .mime_str("audio/webm")
        .map_err(|e| e.to_string())?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(lang) = language {
        if lang != "auto" {
            form = form.text("language", lang);
        }
    }

    let response = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error: {}", error_text));
    }

    #[derive(Deserialize)]
    struct GroqResponse {
        text: String,
    }

    let result: GroqResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(result.text)
}

async fn transcribe_zai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = model.unwrap_or_else(|| "glm-asr-2512".to_string());

    // Z.ai requires WAV format, so we need to convert
    // For now, send as webm and let the API handle it if possible
    // In production, FFmpeg conversion would be done here

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(lang) = language {
        if lang != "auto" {
            form = form.text("language", lang);
        }
    }

    let response = client
        .post("https://api.z.ai/api/paas/v4/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Z.ai API error: {}", error_text));
    }

    #[derive(Deserialize)]
    struct ZaiResponse {
        text: String,
    }

    let result: ZaiResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(result.text)
}
