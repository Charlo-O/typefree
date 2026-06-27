use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandErrorKind {
    Permission,
    Network,
    Configuration,
    Cancelled,
    Timeout,
    Provider,
    Clipboard,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: CommandErrorKind,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

pub type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    pub fn new(kind: CommandErrorKind, message: impl Into<String>) -> Self {
        let retryable = matches!(kind, CommandErrorKind::Network | CommandErrorKind::Timeout);
        Self {
            kind,
            message: message.into(),
            retryable,
            source: None,
        }
    }

    pub fn configuration(message: impl Into<String>) -> Self {
        Self::new(CommandErrorKind::Configuration, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(CommandErrorKind::Timeout, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(CommandErrorKind::Internal, message)
    }

    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    pub fn from_message(message: impl Into<String>) -> Self {
        let message = message.into();
        let lower = message.to_lowercase();
        let kind = if lower.contains("accessibility")
            || lower.contains("permission")
            || lower.contains("privacy")
        {
            CommandErrorKind::Permission
        } else if lower.contains("api key")
            || lower.contains("access token")
            || lower.contains("not found")
            || lower.contains("required")
            || lower.contains("unknown provider")
            || lower.contains("unsupported credential")
            || lower.contains("credential store is not supported")
            || lower.contains("not supported on this platform")
            || lower.contains("not applicable")
            || lower.contains("not available")
            || lower.contains("unavailable")
            || lower.contains("missing-dependency")
        {
            CommandErrorKind::Configuration
        } else if lower.contains("timed out") || lower.contains("timeout") {
            CommandErrorKind::Timeout
        } else if lower.contains("cancelled") || lower.contains("canceled") {
            CommandErrorKind::Cancelled
        } else if lower.contains("clipboard")
            || lower.contains("paste")
            || lower.contains("osascript")
            || lower.contains("enigo")
        {
            CommandErrorKind::Clipboard
        } else if lower.contains("network")
            || lower.contains("connect")
            || lower.contains("connection")
            || lower.contains("websocket")
            || lower.contains("ws ")
            || lower.contains("request")
        {
            CommandErrorKind::Network
        } else if lower.contains("api error")
            || lower.contains("asr")
            || lower.contains("transcription")
            || lower.contains("upload failed")
            || lower.contains("polling failed")
        {
            CommandErrorKind::Provider
        } else {
            CommandErrorKind::Internal
        };

        Self::new(kind, message)
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::from_message(message)
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self::from_message(message)
    }
}

#[cfg(test)]
mod tests {
    use super::{CommandError, CommandErrorKind};

    fn assert_message_kind(message: &str, kind: CommandErrorKind, retryable: bool) {
        let error = CommandError::from_message(message);
        assert_eq!(error.kind, kind);
        assert_eq!(error.retryable, retryable);
        assert_eq!(error.message, message);
    }

    #[test]
    fn classifies_permission_errors() {
        assert_message_kind(
            "Accessibility permission is required for paste",
            CommandErrorKind::Permission,
            false,
        );
        assert_message_kind(
            "Privacy permission denied for microphone",
            CommandErrorKind::Permission,
            false,
        );
    }

    #[test]
    fn classifies_configuration_errors() {
        for message in [
            "OpenAI API key not configured",
            "Unknown provider: foo",
            "Unsupported credential key: BAD_KEY",
            "Credential store is not supported on this platform",
            "missing-dependency: secret-tool",
        ] {
            assert_message_kind(message, CommandErrorKind::Configuration, false);
        }
    }

    #[test]
    fn classifies_timeout_and_network_errors_as_retryable() {
        assert_message_kind(
            "Volcengine streaming transcription timed out after finish",
            CommandErrorKind::Timeout,
            true,
        );
        assert_message_kind(
            "WebSocket connection failed while sending request",
            CommandErrorKind::Network,
            true,
        );
    }

    #[test]
    fn classifies_cancelled_clipboard_and_provider_errors() {
        assert_message_kind(
            "Recording cancelled by user",
            CommandErrorKind::Cancelled,
            false,
        );
        assert_message_kind(
            "Clipboard paste failed via enigo",
            CommandErrorKind::Clipboard,
            false,
        );
        assert_message_kind(
            "AssemblyAI upload failed",
            CommandErrorKind::Provider,
            false,
        );
        assert_message_kind(
            "ASR API error: 401 unauthorized",
            CommandErrorKind::Provider,
            false,
        );
    }

    #[test]
    fn falls_back_to_internal_errors() {
        assert_message_kind("unexpected worker state", CommandErrorKind::Internal, false);
    }

    #[test]
    fn preserves_explicit_source() {
        let error = CommandError::configuration("bad setting").with_source("settings");
        assert_eq!(error.kind, CommandErrorKind::Configuration);
        assert_eq!(error.source.as_deref(), Some("settings"));
    }
}
