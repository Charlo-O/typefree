use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct AnthropicReasoningRequest {
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub text: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct ReasoningResult {
    pub success: bool,
    pub text: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentItem {
    #[serde(rename = "type")]
    pub item_type: String,
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    pub content: Vec<AnthropicContentItem>,
}

#[tauri::command]
pub async fn process_anthropic_reasoning(
    req: AnthropicReasoningRequest,
) -> Result<ReasoningResult, String> {
    let max_tokens = req.max_tokens.unwrap_or(1024);

    let client = Client::new();
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("content-type", "application/json")
        .header("x-api-key", req.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&serde_json::json!({
            "model": req.model,
            "max_tokens": max_tokens,
            "temperature": req.temperature,
            "system": req.system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": req.text
                        }
                    ]
                }
            ]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let body_text = res.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Ok(ReasoningResult {
            success: false,
            text: None,
            error: Some(format!(
                "Anthropic API error: {} {}",
                status.as_u16(),
                body_text
            )),
        });
    }

    let parsed: AnthropicResponse = serde_json::from_str(&body_text).map_err(|e| {
        format!(
            "Failed to parse Anthropic response: {} (body: {})",
            e,
            body_text.chars().take(500).collect::<String>()
        )
    })?;

    let text = parsed
        .content
        .iter()
        .find(|item| item.item_type == "text")
        .and_then(|item| item.text.clone())
        .unwrap_or_default()
        .trim()
        .to_string();

    if text.is_empty() {
        return Ok(ReasoningResult {
            success: false,
            text: None,
            error: Some("Anthropic returned empty response".to_string()),
        });
    }

    Ok(ReasoningResult {
        success: true,
        text: Some(text),
        error: None,
    })
}
