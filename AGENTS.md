# TypeFree Technical Reference for AI Assistants

This document is the working reference for AI assistants modifying the TypeFree codebase. Keep it aligned with the actual project: TypeFree is a Tauri v2 desktop dictation app with cloud speech-to-text providers, optional AI text cleanup, clipboard/history tools, and a lightweight recording overlay.

## Project Overview

TypeFree turns speech into text that can be pasted into the currently focused application. It is built around a small floating dictation UI, a control panel for settings/history/model configuration, and a native Tauri backend for recording, global hotkeys, transcription calls, clipboard operations, and local persistence.

The speech-to-text path is provider-based and supports both cloud and local runtimes. Cloud providers include AssemblyAI, OpenAI, Groq, Z.ai, and Volcengine/Doubao. Local ASR uses `src-tauri/src/local_asr/`: sherpa-onnx for ONNX families and shell-free external-command/OpenAI-compatible adapters for GGUF, R2T2, whisper.cpp, faster-whisper, and other user-installed engines.

## Core Technologies

- **Frontend**: React 19, TypeScript/JavaScript, Tailwind CSS v4, Vite
- **Desktop framework**: Tauri v2 with Rust commands
- **Native backend**: Rust, Tokio, reqwest, tokio-tungstenite, rusqlite
- **UI components**: shadcn-style components with Radix primitives
- **Persistence**: SQLite for transcription history, Tauri app data files for settings, and platform credential storage for API credentials
- **Speech-to-text**: Cloud providers plus local ASR runtimes through Tauri commands
- **AI cleanup/reasoning**: Cloud providers plus local GGUF reasoning models where supported
- **Clipboard automation**: Tauri clipboard plugin plus platform-specific paste simulation

AI 后处理模式目前包括 `direct`、`voice-polish`、`command`、`translate-en` 和 `prompt-optimize`。
其中 `command`（指令模式）只执行受控的文本转换：例如“帮我翻译 今天天气很好”会输出翻译结果；
它不会执行 shell、文件、应用或其他系统副作用。命令与内容需要在同一次录音中说出，未配置 reasoning
模型时会安全回退为原始转写文本。

## Runtime Architecture

### Windows and Views

- **Main window**: Small dictation surface on Windows/Linux. On macOS, the visible recording overlay is handled by the native panel path.
- **Control panel**: Full settings, history, model, prompt, clipboard, and developer UI.
- **Recording overlay**: macOS Handy-style non-activating NSPanel created from the Tauri backend and rendered by `features/dictation/ui/RecordingOverlay.tsx`.

Routing is handled in `src/AppRouter.tsx` by checking URL state:

- `?panel=true` renders the control panel.
- `?overlay=true` renders the recording overlay.
- The default route renders the floating dictation UI where needed.

### Frontend-to-Backend Bridge

The frontend uses `src/shared/platform` as the UI-facing bridge to Rust commands. `src/shared/platform/index.ts` is the stable UI-facing barrel, `src/shared/platform/platformCommands.ts` aggregates focused command modules, `src/shared/platform/tauriCommands.ts` is only a legacy compatibility barrel, `src/shared/platform/legacyDesktopApi.ts` assembles the narrow legacy/debug compatibility object, `src/shared/platform/platformBootstrap.ts` wires bootstrap internals, and `src/shared/platform/rendererPlatformInit.ts` is the renderer side-effect entry that installs the `window.tauriAPI` alias plus startup settings sync. `src/utils/tauriAPI.ts` is only a compatibility re-export; normal UI code should go through the platform bridge.

When adding new backend behavior:

1. Add the Rust command under `src-tauri/src/commands/`.
2. Register it in `src-tauri/src/lib.rs`.
3. Add a typed wrapper in the relevant `src/shared/platform/*Commands.ts` module, re-export it through `src/shared/platform/platformCommands.ts`, and mirror it through `src/shared/platform/tauriCommands.ts` only when legacy compatibility needs it.
4. Use the wrapper from React components or hooks.

## Important Files

### Tauri Backend

- `src-tauri/src/lib.rs`: Tauri app setup, plugin registration, command registration, database initialization, clipboard listener startup, dictation coordinator startup, overlay initialization.
- `src-tauri/src/commands/transcription.rs`: Tauri transcription command facade and provider catalog command.
- `src-tauri/src/commands/transcription_openai_realtime.rs`: OpenAI realtime Tauri command facade for realtime transcription command wrappers.
- `src-tauri/src/transcription/batch_service.rs`: Batch transcription orchestration, including prompt lookup, credential context loading, provider dispatch, timeout handling, and result logging.
- `src-tauri/src/transcription/domain.rs`: Shared transcription domain contract, including batch request/result/context, provider trait, unified transcript event payload, and legacy event bridge emission.
- `src-tauri/src/transcription/openai_realtime.rs`: OpenAI realtime WebSocket transcription session registry, audio upload loop, transcript event emission, and finish/cancel runtime.
- `src-tauri/src/transcription/providers.rs` and `src-tauri/src/transcription/providers/`: Transcription provider registry, batch/streaming/realtime capability metadata, provider credential metadata, dispatch, and AssemblyAI/OpenAI/Groq/Z.ai/Volcengine provider adapters.
- `src-tauri/src/local_asr/`: Local ASR manifest, WAV normalization, sherpa-onnx adapters, OpenAI-compatible endpoint adapter, and shell-free external command runner.
- `src-tauri/src/commands/transcription_volcengine.rs`: Volcengine/Doubao Tauri command facade for streaming command wrappers.
- `src-tauri/src/transcription/volcengine/batch.rs`: Volcengine/Doubao batch WebSocket transcription flow.
- `src-tauri/src/transcription/volcengine/protocol.rs`: Volcengine/Doubao WebSocket protocol helpers, auth mode selection, audio normalization, response parsing, and protocol-level tests.
- `src-tauri/src/transcription/volcengine/runtime.rs`: Volcengine/Doubao WebSocket runtime helpers for connection/auth fallback plus config/audio packet sending.
- `src-tauri/src/transcription/volcengine/streaming.rs`: Volcengine/Doubao streaming session registry and transcript event emission loop.
- `src-tauri/src/commands/dictation.rs`: macOS backend dictation coordinator for hotkey-driven record -> transcribe -> paste.
- `src-tauri/src/commands/recording.rs`: Native recording commands.
- `src-tauri/src/commands/clipboard.rs`: Clipboard read/write, image paste, paste tool checks, accessibility checks, and paste simulation.
- `src-tauri/src/commands/hotkey.rs`: Global hotkey registration and event dispatch.
- `src-tauri/src/commands/database.rs`: SQLite transcription history commands.
- `src-tauri/src/commands/settings.rs`: Non-secret settings persistence in the Tauri app data directory plus compatibility wrappers for legacy env-style callers.
- `src-tauri/src/commands/credentials.rs`: API credential storage, validation, and migration from legacy plaintext `.env` or sensitive `settings.json` mirrors into the platform credential store.
- `src-tauri/src/overlay.rs`: macOS recording overlay panel setup and show/hide behavior.
- `src-tauri/tauri.conf.json`: Product name, app identifier, windows, bundling, tray icon, and Tauri build config.

### Frontend

- `src/main.tsx`: Renderer platform initialization and React root mounting.
- `src/AppRouter.tsx`: Window/view router for the main UI, control panel, and recording overlay.
- `src/features/dictation/ui/FloatingDictationApp.tsx`: Floating dictation UI for non-macOS/default window use.
- `src/components/ControlPanel.tsx`: Main control panel shell.
- `src/features/settings/ui/SettingsPage.tsx`: Settings sections and configuration UI. `src/components/SettingsPage.tsx` is a compatibility re-export for older imports.
- `src/features/clipboardCenter/ui/ClipboardSettings.tsx`: Clipboard history, favorites, and clipboard settings UI. `src/components/ClipboardSettings.tsx` is a compatibility re-export for older imports.
- `src/features/vocabulary/ui/VocabularySettings.tsx`: Vocabulary hotwords, snippets, scoped layers, and context packs UI. `src/components/VocabularySettings.tsx` is a compatibility re-export for older imports.
- `src/features/settings/ui/TranscriptionModelPicker.tsx`: Speech-to-text provider/model/API-key configuration, including Volcengine/Doubao fields. `src/components/TranscriptionModelPicker.tsx` is a compatibility re-export for older imports.
- `src/features/settings/ui/ReasoningModelSelector.tsx`: AI cleanup/reasoning provider and model configuration. `src/components/ReasoningModelSelector.tsx` is a compatibility re-export for older imports.
- `src/features/settings/ui/LocalModelPicker.tsx`: Local model picker and download UI. `src/components/LocalModelPicker.tsx` is a compatibility re-export for older imports.
- `src/features/settings/ui/DeveloperSection.tsx`: Developer diagnostics, privacy diagnostics, and dictation timeline UI. `src/components/DeveloperSection.tsx` is a compatibility re-export for older imports.
- `src/features/promptStudio/ui/PromptStudio.tsx`: Prompt editing, versioning, test sample, and A/B comparison UI. `src/components/ui/PromptStudio.tsx` is a compatibility re-export for older imports.
- `src/features/dictation/ui/RecordingOverlay.tsx`: Recording/transcribing/pasting overlay UI.
- `src/components/ui/`: Reusable UI primitives.

### Hooks and Services

- `src/features/dictation/hooks/useAudioRecording.ts`: Renderer-side recording and processing flow. `src/hooks/useAudioRecording.ts` is a compatibility re-export for older imports.
- `src/features/hotkeys/hooks/useHotkey.ts` and `src/features/hotkeys/hooks/useHotkeyRegistration.ts`: Dictation hotkey state and registration behavior backed by the platform hotkey bridge. `src/hooks/useHotkey.ts` and `src/hooks/useHotkeyRegistration.ts` are compatibility re-exports for older imports.
- `src/features/appUpdate/hooks/useUpdater.ts`: App update state, events, download, and install workflow backed by the platform updater bridge. `src/hooks/useUpdater.ts` is a compatibility re-export for older imports.
- `src/features/settings/hooks/useSettings.ts`: Frontend settings state, localStorage sync, and API credential setters. `src/hooks/useSettings.ts` is a compatibility re-export for older imports.
- `src/features/settings/hooks/useModelDownload.ts`: Local model download, delete, cancel, and progress state for settings model UI. `src/hooks/useModelDownload.ts` is a compatibility re-export for older imports.
- `src/features/settings/hooks/useLocalModels.ts`: Compatibility local model collection/status hook backed by the platform model bridge. `src/hooks/useLocalModels.ts` is a compatibility re-export for older imports.
- `src/features/settings/hooks/usePermissions.ts`: Microphone, accessibility, and paste-tool permission checks for settings and onboarding UI. `src/hooks/usePermissions.ts` is a compatibility re-export for older imports.
- `src/features/clipboardCenter/hooks/useClipboardListener.ts`: Clipboard monitoring integration. `src/hooks/useClipboardListener.ts` is a compatibility re-export for older imports.
- `src/features/clipboardCenter/hooks/useClipboard.ts`: Clipboard paste/read helper for UI surfaces. `src/hooks/useClipboard.ts` is a compatibility re-export for older imports.
- `src/services/ReasoningService.ts`: Cloud reasoning/text cleanup.
- `src/services/VolcengineASRService.ts`: Renderer helper for Volcengine/Doubao audio conversion and backend invocation.
- `src/services/LocalReasoningService.ts`: Local reasoning integration where available.

### Models and Configuration

- `src/models/modelRegistryData.json`: Single source of truth for transcription providers, cloud reasoning providers, and local reasoning models.
- `src/models/ModelRegistry.ts`: TypeScript wrapper around model registry data.
- `src/config/prompts.ts`: Default speech cleanup prompt behavior.
- `src/config/constants.ts`: API URL helpers, timeouts, token limits, retry/cache defaults.
- `src/i18n/translations.ts`: English and Simplified Chinese UI text.

## Transcription Pipeline

### Frontend-Initiated Path

1. User starts dictation through UI or hotkey.
2. `features/dictation/hooks/useAudioRecording.ts` records audio.
3. Audio bytes are sent through `platform.transcription.transcribeAudio()` or the local adapter method.
4. `src/shared/platform` routes through `src/shared/platform/platformCommands.ts`, which re-exports focused command modules that invoke Rust commands such as `transcribe_audio` and `local_asr_transcribe`.
5. `src-tauri/src/commands/transcription.rs` dispatches `local` to `src-tauri/src/local_asr/`; cloud providers continue through `src-tauri/src/transcription/batch_service.rs`, which loads credentials and dispatches through the provider registry.
6. The returned text may be passed through `ReasoningService` if AI text cleanup is enabled.
7. The final text is pasted and saved to history.

### macOS Backend Dictation Path

The macOS hotkey path can run mostly from Rust so it remains responsive while the renderer is hidden or throttled:

1. Global hotkey event enters `commands/hotkey.rs`.
2. `commands/dictation.rs` coordinates state transitions.
3. Native recording starts/stops through `commands/recording.rs`.
4. Cloud transcription runs through `commands/transcription.rs`.
5. Text is saved through `commands/database.rs`.
6. Text is pasted through `commands/clipboard.rs`.
7. Overlay state is updated through `overlay.rs`.

Current caveat: the macOS backend hotkey path can route to Volcengine/Doubao, but it depends on `cloudTranscriptionProvider`, `cloudTranscriptionModel`, and the `VOLCENGINE_*` credentials being synced into the backend-readable credential store.

### Provider Notes

- **AssemblyAI**: Uploads audio, submits transcript jobs, polls until completion, supports prompt only on `universal-3-pro`, and falls back to `universal-2` where needed.
- **OpenAI**: Sends multipart audio to the audio transcription endpoint.
- **Groq**: Sends multipart audio to the OpenAI-compatible Groq transcription endpoint.
- **Z.ai**: Uses the GLM ASR endpoint; macOS converts to WAV when required.
- **Volcengine/Doubao**: Uses a WebSocket binary protocol through Rust because custom headers and streaming behavior are easier and safer in the backend. User-provided credentials are `VOLCENGINE_APP_ID` and `VOLCENGINE_ACCESS_TOKEN`; the protocol-level `X-Api-Resource-Id` is an internal default, not a user setting.
- **Local ASR**: `sherpa-onnx` is enabled by the default Cargo feature and handles SenseVoice, Paraformer, Whisper, and Qwen3-ASR ONNX bundles. GGUF/R2T2/whisper.cpp/faster-whisper use the external-command or OpenAI-compatible adapters; model files alone do not provide an executable runtime.

## Settings and Persistence

Settings live in two places:

- **Renderer localStorage**: Immediate UI state such as selected provider, selected model, language, hotkeys, and toggles.
- **Tauri app data files**:
  - `settings.json` for backend-readable settings.
  - `credentials/` on Windows for DPAPI-protected credential blobs.
  - legacy `.env` only as a migration source for older plaintext provider credentials.
  - `transcriptions.db` for transcription history.
  - `clipboard-images/` for clipboard image blobs and thumbnails.

Provider credentials are read and written through `src-tauri/src/commands/credentials.rs`. macOS uses Keychain through the `security` tool, Windows uses DPAPI-protected app-data blobs, and Linux uses Secret Service through `secret-tool`. Legacy `get_env_var`/`set_env_var` platform wrappers remain compatibility names but route to the credential store and remove old plaintext values.

Important localStorage keys include:

- `preferredLanguage`
- `cloudTranscriptionProvider`
- `cloudTranscriptionModel`
- `cloudTranscriptionBaseUrl`
- `localAsrRuntime`, `localAsrModelFamily`, `localAsrModelPath`
- `localAsrEncoderPath`, `localAsrDecoderPath`, `localAsrConvFrontendPath`, `localAsrTokenizerPath`
- `localAsrExecutablePath`, `localAsrCommandArgs`, `localAsrEndpoint`, `localAsrNumThreads`
- `cloudReasoningBaseUrl`
- `useReasoningModel`
- `reasoningModel`
- `dictationKey`
- `dictationTriggerMode`
- `clipboardHotkey`
- `activationMode`
- `preferBuiltInMic`
- `selectedMicDeviceId`
- provider key UI mirrors such as `openaiApiKey`, `assemblyaiApiKey`, `groqApiKey`, `zaiApiKey`, `volcengineAppId`, and `volcengineAccessToken`

Backend credential keys include:

- `ASSEMBLYAI_API_KEY`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`
- `ZAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `VOLCENGINE_APP_ID`
- `VOLCENGINE_ACCESS_TOKEN`

## Database Schema

SQLite schema is versioned through `PRAGMA user_version` plus a `schema_migrations` table in `src-tauri/src/commands/database.rs`.

Core tables:

- `transcriptions`: canonical history row, including raw text, processed text, processing method, optional error, and optional `session_id`.
- `transcription_sessions`: one dictation/session envelope with provider, model, language, status, start/completion timestamps, and error.
- `transcription_outputs`: stage-level outputs for raw, processed, normalized, pipeline, or future replay/debug artifacts.
- `transcriptions_fts`: FTS5 external-content index over `transcriptions.original_text` and `transcriptions.processed_text`.

History writes should use the platform history bridge. New session-aware writes should call `db_save_transcription_record`; legacy `db_save_transcription` remains as a compatibility wrapper.

## Clipboard Image Storage

Clipboard image history is file-backed. The backend writes the original PNG plus a thumbnail under the Tauri app data `clipboard-images/` directory and emits only `blobPath`, `thumbPath`, and metadata to the renderer. Frontend history should render `thumbPath` through `resolveClipboardImageSrc()` and paste/copy from `blobPath` through `clipboardImagePasteSource()`. Legacy inline `data:image/...` history entries should be migrated through `platform.clipboard.storeImage()` instead of kept in localStorage.

## Development Guidelines

### Adding a New Speech-to-Text Provider

1. Add provider metadata to `src/models/modelRegistryData.json`.
2. Add UI support in `src/features/settings/ui/TranscriptionModelPicker.tsx` if it needs special credentials or fields.
3. Add credential persistence helpers in `src/shared/platform/settingsCommands.ts`, re-export them through `src/shared/platform/platformCommands.ts`, mirror them through `src/shared/platform/tauriCommands.ts` when legacy compatibility needs them, and wire `src/features/settings/hooks/useSettings.ts`.
4. Add backend provider metadata, routing, and implementation in `src-tauri/src/transcription/providers.rs` and `src-tauri/src/transcription/providers/`; keep `src-tauri/src/commands/transcription.rs` as a command facade.
5. Add logging that makes upload, request, polling/streaming, and response timing easy to diagnose.
6. Test timeout behavior and empty-result handling.

### Adding a New Tauri Command

1. Implement the command in the relevant `src-tauri/src/commands/*.rs` module.
2. Register it in `tauri::generate_handler!` in `src-tauri/src/lib.rs`.
3. Expose a typed wrapper in the relevant `src/shared/platform/*Commands.ts` module, re-export it through `src/shared/platform/platformCommands.ts`, and mirror it through `src/shared/platform/tauriCommands.ts` if existing compatibility imports need it.
4. Prefer using that wrapper from React rather than importing `invoke()` directly across the UI.

### Adding a New Setting

1. Add or update the setting definition in `src/features/settings/schema/settingsSchema.ts` first, including its default value, type-specific normalization, import/export behavior, search terms, and `syncToBackend` when Rust commands read it.
2. Add UI state in `src/features/settings/hooks/useSettings.ts` through the schema helpers so localStorage serialization and backend sync stay centralized.
3. If the setting is a secret, mark it sensitive in the schema and store it through `setEnvVar` helpers instead of only localStorage.
4. Wire controls through `src/features/settings/ui/SettingsPage.tsx` or the relevant picker component, using schema normalization rather than component-local validation.

### Updating Prompts or Model Lists

- Prompt behavior belongs in `src/config/prompts.ts`.
- Provider/model metadata belongs in `src/models/modelRegistryData.json`.
- Avoid duplicating model definitions in UI components unless the component is intentionally presenting a curated subset.

## Testing Checklist

- GitHub CI (`.github/workflows/ci.yml`) runs `npm run verify:frontend` plus Linux and macOS Tauri Rust preflight targets on pushes/PRs to `main`.
- GitHub release (`.github/workflows/release.yml`) gates tag creation on frontend verification plus the same Linux and macOS Tauri Rust preflight targets.
- Linux Tauri CI dependencies are centralized in `.github/actions/setup-tauri-linux/action.yml`; update that action instead of editing workflow-local apt lists.
- Tauri Rust dependency caching is centralized in `.github/actions/cache-tauri-rust/action.yml`; workflows pass only a cache key prefix.
- Run `npm run test:frontend-boundaries` to guard the Tauri/platform and feature-sliced frontend boundaries: no `electronAPI` references in `src`, no JS/JSX source files under `src`, and migrated business hooks stay as thin compatibility facades.
- Run `npm run test:github-workflows` after CI/release workflow edits to verify Linux/macOS Rust preflight targets, release tag gating, and shared composite action usage.
- Run `npm run test:transcript-events` after streaming/realtime transcript event edits to keep the unified `transcript-event` bridge, legacy event emission, and UI listener path aligned.
- Run `npm run test:tauri-command-boundaries` after Rust command edits to keep public `#[tauri::command]` functions on `CommandResult` instead of raw `Result<T, String>`.
- Run `npm run test:tauri-command-errors` after `CommandError` classification edits to keep backend error kind and retryability mapping stable.
- Run `npm run test:tauri-clipboard-images` after clipboard image storage or retention edits to keep Rust file deletion bounded to `clipboard-images/`.
- Run `npm run test:tauri-provider-contracts` after transcription provider or transcript event edits to keep provider metadata, credential context, and streaming/realtime event payloads stable.
- Run `npm run test:tauri-volcengine-protocol` after Volcengine/Doubao protocol, audio normalization, auth, or response parsing edits.
- Run `npm run smoke:tauri-dev` when you need a bounded automated Tauri dev-runtime startup check; it waits for Vite, Cargo, and the app-running signal, writes logs under `.codex-run-logs/`, and tears down the process tree.
- Run `npm run smoke:runtime-probe` when you need the bounded startup check plus the Developer runtime probe sentinel for Tauri runtime, native recording capability, foreground/vocabulary sync, privacy diagnostics, and timeline persistence.
- Run `npm run smoke:native-recording` when you explicitly need a short device-level native recording smoke; it starts Tauri dev, captures a bounded native WAV sample, validates the returned bytes, emits a sentinel, and tears down the process tree. Do not put it in default verify gates because it depends on microphone hardware and OS permissions.
- Run `npm run smoke:dictation-pipeline` when you need a bounded runtime smoke for the completion pipeline without cloud STT or simulated paste into the foreground app; it uses a synthetic transcript, verifies clipboard write/read insertion, SQLite history save, timeline persistence, emits a sentinel, and tears down the process tree. Do not put it in default verify gates because it mutates local app data and the clipboard during an explicit smoke.
- Run `npm run smoke:cloud-credential-preflight` when you need a credential presence report for the selected cloud transcription provider without reading secret values, starting the microphone, or contacting the provider; pass `-- --cloud-provider <provider>` when overriding settings. Missing keys are reported in the summary as a warning because this is a preflight report, not provider availability proof.
- Run `npm run smoke:cloud-transcription` when you need a live provider smoke through the real native-recording -> platform transcription -> Tauri provider path; pass `-- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms>` when overriding settings. Add `-- --cloud-speech-fixture` when you need deterministic provider input through a generated 16 kHz mono WAV fixture instead of the microphone; this still calls the real Tauri provider path but does not prove native recording. Add `-- --cloud-speaker-fixture` on Windows when you want the generated speech to play through speakers while native recording captures microphone input; this can satisfy `--require-cloud-microphone` only when the physical microphone hears the speaker and the provider returns a non-empty transcript. The smoke first checks credential presence without returning secret values, then records or loads the fixture and calls the provider only when the required keys exist. Do not put it in default verify gates because it depends on microphone hardware or generated speech fixture support, stored provider credentials, network, and provider availability.
- Run `npm run handoff:runtime-smoke-evidence` when coordinating external macOS/Linux/Windows runtime evidence collection; pass `-- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms>`. Add `-- --output <file.md>`, `-- --format json --output <file.json>`, or `-- --bundle-dir <dir>` when you need transferable handoff files. Bundle mode writes Markdown, JSON, a bundle manifest, per-platform collector scripts, import helper scripts (`import-returned-evidence.ps1`/`.sh`), and final readiness scripts. Generated bundle scripts locate the TypeFree repo root from the current directory or the handoff script path before running `npm`/`node`, so they can be launched from the repo root or from the handoff bundle directory. It only prints or writes the per-platform collector commands, the manual `import:runtime-smoke-evidence` command, import helpers that call `node scripts/import-runtime-smoke-evidence.js`, and the final `verify:goal-readiness -- --manifest-dir <dir>` command; it does not start Tauri, read credentials, record audio, call providers, or write runtime evidence.
- Run `npm run verify:runtime-smoke-handoff-bundle -- --bundle-dir <dir>` before transferring or running a generated handoff command bundle. It only reads the generated handoff files and rejects path escapes, unknown executable scripts, fixture/allow-missing cloud shortcuts, secret/transcript payload keys, import helpers that bypass `scripts/import-runtime-smoke-evidence.js`, and final readiness commands that bypass `verify:goal-readiness -- --manifest-dir`; it does not start Tauri, read credentials, record audio, call providers, or write runtime evidence.
- Run `npm run collect:runtime-smoke-evidence` on each external platform when you need the full five-summary handoff for final goal readiness; pass `-- --cloud-provider <provider> --cloud-model <model> --cloud-language <lang> --cloud-smoke-ms <ms>`. It runs the runtime probe, native recording, dictation pipeline, credential preflight, and cloud transcription smoke, validates the set with `--require-cloud-microphone`, and writes a portable `runtime-smoke-set.<platform>.manifest.json` with relative summary paths and `goalReadinessArgs`. Do not put it in default verify gates because it runs hardware/network-dependent smoke commands.
- Run `npm run pack:runtime-smoke-evidence` when five summary files already exist and need to be turned into the same portable manifest bundle without rerunning Tauri; pass `-- --platform <platform> --runtime-probe <summary> --native-recording <summary> --dictation-pipeline <summary> --cloud-preflight <summary> --cloud-transcription <summary>`. It validates the copied bundle with `--require-cloud-microphone` before writing the manifest.
- Run `npm run import:runtime-smoke-evidence` when an external platform returns a `runtime-smoke-evidence-<platform>-<timestamp>/` directory, its manifest, or a returned directory containing one-level `runtime-smoke-evidence-*` child bundles; pass `-- --source <runtime-smoke-evidence-platform-dir-or-manifest> --manifest-dir <dir>`. It validates each source bundle with `--require-cloud-microphone`, requires a parseable manifest `collectedAt`, rejects path escapes and secret/transcript payload keys, copies only the manifest plus five summaries into the manifest directory, then validates the imported copy. Returned batch directories are one-level only: child directory platform, manifest filename platform, and manifest `platform` must match, and duplicate platforms fail closed. Add `-- --platform <platform>` to import only one platform from a multi-bundle source directory. Batch imports preflight destination conflicts before copying anything; `-- --replace` verifies a temporary imported copy before swapping so existing evidence is preserved on failure. Do not put it in default verify gates because it consumes external evidence artifacts and mutates the local manifest directory.
- Run `npm run verify:runtime-smoke-summaries` after collecting `.codex-run-logs/*.summary.json` runtime smoke artifacts; add `-- --require-cloud-microphone` when the evidence must prove native microphone recording through a cloud provider.
- Run `npm run verify:goal-readiness` only for final goal completion review after the required Windows runtime summary set is collected. Prefer `-- --manifest-dir <dir>` when platform bundles are under one directory, or `-- --windows-manifest <manifest>` for an explicit path; optional `--macos-manifest <manifest>` and `--linux-manifest <manifest>` remain supported and are strictly validated when provided. Explicit per-summary paths remain supported. It fails closed when required Windows evidence is missing, when any provided platform evidence is malformed, or when cloud transcription evidence is fixture-only instead of `native-recording`. When required evidence is missing, its failure output scopes the `handoff:runtime-smoke-evidence -- --platform <missing-platforms> --bundle-dir <dir>`, `verify:runtime-smoke-handoff-bundle`, and `import:runtime-smoke-evidence` commands to the missing platforms.
- Run `npm run tauri:dev` for an interactive smoke test.
- Verify the control panel opens and settings persist after restart.
- Test dictation start/stop with the configured global hotkey.
- Test the selected transcription provider with a short recording.
- For local ASR, run `npm run tauri:dev`, select the local runtime, verify `check runtime`, and test one configured ONNX or external-command model.
- For Volcengine/Doubao, verify APP ID, Access Token, WebSocket connection, and 60-second timeout behavior.
- Verify optional AI text cleanup can be enabled and disabled.
- Verify automatic paste in a normal text field.
- On macOS, verify Accessibility permission handling and overlay visibility across spaces/full-screen apps.
- Verify transcription history is written to SQLite and appears in the control panel.
- Run `npm run verify:frontend`, `npm run verify:tauri`, and `npm run tauri:build` before release-oriented changes.

## Common Issues

### Transcription Is Slow

- Check whether the delay is in audio conversion, upload/WebSocket connection, provider processing, polling, or reasoning cleanup.
- For cloud providers, network, DNS, VPN/proxy, provider region, and provider-side load can dominate latency.
- For Volcengine/Doubao, confirm the chosen model path. The backend sends the protocol-level `X-Api-Resource-Id` internally as `volc.seedasr.sauc.duration`; this is not exposed as a user setting.
- Disable AI text cleanup to isolate speech-to-text latency from post-processing latency.

### Transcription Returns Empty Text

- Confirm microphone permissions and selected input device.
- Check that recorded audio bytes are non-empty.
- Confirm provider credentials and selected model.
- Check backend logs for provider response payloads or API errors.

### Automatic Paste Fails

- macOS requires Accessibility permission for simulated paste.
- Linux requires an available paste simulation tool depending on X11/Wayland.
- Windows uses native key simulation paths.
- If paste simulation fails, keep the transcription text in the clipboard so the user can paste manually.

### Hotkey Is Unstable

- Keep hotkey callbacks fast and non-panicking.
- Avoid duplicate global shortcut registration from multiple windows.
- Use backend coordination for macOS dictation state transitions.

## Platform Notes

### macOS

- Uses a native non-activating overlay panel through `tauri-nspanel`.
- Requires microphone permission for recording.
- Requires Accessibility permission for automatic paste.
- Native recording and backend dictation coordination are strongest on macOS.

### Windows

- Uses the normal floating dictation UI path.
- Microphone and sound settings are opened through Windows settings URIs.
- Automatic paste depends on the Windows paste simulation implementation.

### Linux

- Uses the normal floating dictation UI path.
- Sound and microphone settings may require distro-specific tools.
- Paste simulation depends on X11/Wayland environment and installed tools.

## Code Style

- Prefer TypeScript for new React components.
- Follow existing shadcn/Radix component patterns.
- Keep Rust commands small and explicit; split provider-specific logic into helper functions when it grows.
- Add targeted logging around slow or failure-prone provider calls.
- Clean up listeners, temporary files, and async tasks.
- Do not introduce new Electron-only architecture. Legacy Electron code belongs in `legacy-electron/`; new runtime work should target Tauri.
