use crate::commands::command_error::CommandResult;

use super::super::domain::{
    BatchTranscriptionRequest, BatchTranscriptionResult, TranscriptionProvider,
};

pub(super) struct VolcengineProvider;

impl TranscriptionProvider for VolcengineProvider {
    fn id(&self) -> &'static str {
        "volcengine"
    }

    async fn transcribe(
        &self,
        request: BatchTranscriptionRequest,
    ) -> CommandResult<BatchTranscriptionResult> {
        let BatchTranscriptionRequest {
            audio_data,
            context,
            model,
            language,
            prompt: _,
            session_id: _,
            endpoint_override: _,
        } = request;
        let (app_id, access_token, resource_id, hotwords) = context.into_volcengine()?;
        let text = crate::transcription::volcengine::batch::transcribe_volcengine(
            audio_data,
            app_id,
            access_token,
            resource_id,
            model,
            language,
            hotwords,
        )
        .await?;
        Ok(BatchTranscriptionResult::new(self.id(), text))
    }
}
