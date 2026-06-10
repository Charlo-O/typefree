# TypeFree Technical Reference for AI Assistants

This document is the working reference for AI assistants modifying the TypeFree codebase. Keep it aligned with the actual project: TypeFree is a Tauri v2 desktop dictation app with cloud speech-to-text providers, optional AI text cleanup, clipboard/history tools, and a lightweight recording overlay.

## Project Overview

TypeFree turns speech into text that can be pasted into the currently focused application. It is built around a small floating dictation UI, a control panel for settings/history/model configuration, and a native Tauri backend for recording, global hotkeys, transcription calls, clipboard operations, and local persistence.

The current speech-to-text path is provider-based and cloud-first. Supported transcription providers include AssemblyAI, OpenAI, Groq, Z.ai, and Volcengine/Doubao. Local models are used for optional reasoning/text cleanup where available; they are not the primary speech-to-text path in the current Tauri build.

## Core Technologies

- **Frontend**: React 19, TypeScript/JavaScript, Tailwind CSS v4, Vite
- **Desktop framework**: Tauri v2 with Rust commands
- **Native backend**: Rust, Tokio, reqwest, tokio-tungstenite, rusqlite
- **UI components**: shadcn-style components with Radix primitives
- **Persistence**: SQLite for transcription history, Tauri app data files for settings and API credentials
- **Speech-to-text**: Cloud providers through Tauri commands
- **AI cleanup/reasoning**: Cloud providers plus local GGUF reasoning models where supported
- **Clipboard automation**: Tauri clipboard plugin plus platform-specific paste simulation

## Runtime Architecture

### Windows and Views

- **Main window**: Small dictation surface on Windows/Linux. On macOS, the visible recording overlay is handled by the native panel path.
- **Control panel**: Full settings, history, model, prompt, clipboard, and developer UI.
- **Recording overlay**: macOS Handy-style non-activating NSPanel created from the Tauri backend and rendered by `RecordingOverlay.jsx`.

Routing is handled in `src/main.jsx` by checking URL state:

- `?panel=true` renders the control panel.
- `?overlay=true` renders the recording overlay.
- The default route renders the floating dictation UI where needed.

### Frontend-to-Backend Bridge

The frontend uses `src/utils/tauriAPI.ts` as the bridge to Rust commands. It exposes a compatibility object on `window.electronAPI` and `window.tauriAPI` so older frontend components can continue calling the same methods while the implementation routes through Tauri `invoke()`.

When adding new backend behavior:

1. Add the Rust command under `src-tauri/src/commands/`.
2. Register it in `src-tauri/src/lib.rs`.
3. Add a typed wrapper in `src/utils/tauriAPI.ts`.
4. Use the wrapper from React components or hooks.

## Important Files

### Tauri Backend

- `src-tauri/src/lib.rs`: Tauri app setup, plugin registration, command registration, database initialization, clipboard listener startup, dictation coordinator startup, overlay initialization.
- `src-tauri/src/commands/transcription.rs`: Cloud transcription providers, including AssemblyAI, OpenAI, Groq, Z.ai, and Volcengine/Doubao.
- `src-tauri/src/commands/dictation.rs`: macOS backend dictation coordinator for hotkey-driven record -> transcribe -> paste.
- `src-tauri/src/commands/recording.rs`: Native recording commands.
- `src-tauri/src/commands/clipboard.rs`: Clipboard read/write, image paste, paste tool checks, accessibility checks, and paste simulation.
- `src-tauri/src/commands/hotkey.rs`: Global hotkey registration and event dispatch.
- `src-tauri/src/commands/database.rs`: SQLite transcription history commands.
- `src-tauri/src/commands/settings.rs`: Settings and `.env` persistence in the Tauri app data directory.
- `src-tauri/src/overlay.rs`: macOS recording overlay panel setup and show/hide behavior.
- `src-tauri/tauri.conf.json`: Product name, app identifier, windows, bundling, tray icon, and Tauri build config.

### Frontend

- `src/main.jsx`: Window/view router and top-level providers.
- `src/App.jsx`: Floating dictation UI for non-macOS/default window use.
- `src/components/ControlPanel.tsx`: Main control panel shell.
- `src/components/SettingsPage.tsx`: Settings sections and configuration UI.
- `src/components/TranscriptionModelPicker.tsx`: Speech-to-text provider/model/API-key configuration, including Volcengine/Doubao fields.
- `src/components/ReasoningModelSelector.tsx`: AI cleanup/reasoning provider and model configuration.
- `src/components/RecordingOverlay.jsx`: Recording/transcribing/pasting overlay UI.
- `src/components/ui/`: Reusable UI primitives.

### Hooks and Services

- `src/hooks/useAudioRecording.js`: Renderer-side recording and processing flow.
- `src/hooks/useHotkey.js` and `src/hooks/useHotkeyRegistration.ts`: Hotkey state and registration behavior.
- `src/hooks/useSettings.ts`: Frontend settings state, localStorage sync, and API credential setters.
- `src/hooks/useClipboardListener.ts`: Clipboard monitoring integration.
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
2. `useAudioRecording.js` records audio.
3. Audio bytes are sent through `window.electronAPI.transcribeAudio()`.
4. `src/utils/tauriAPI.ts` invokes the Rust `transcribe_audio` command.
5. `src-tauri/src/commands/transcription.rs` routes by provider.
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

Current caveat: the macOS backend hotkey path can route to Volcengine/Doubao, but it depends on `cloudTranscriptionProvider`, `cloudTranscriptionModel`, and the `VOLCENGINE_*` credentials being synced into backend-readable settings and `.env`.

### Provider Notes

- **AssemblyAI**: Uploads audio, submits transcript jobs, polls until completion, supports prompt only on `universal-3-pro`, and falls back to `universal-2` where needed.
- **OpenAI**: Sends multipart audio to the audio transcription endpoint.
- **Groq**: Sends multipart audio to the OpenAI-compatible Groq transcription endpoint.
- **Z.ai**: Uses the GLM ASR endpoint; macOS converts to WAV when required.
- **Volcengine/Doubao**: Uses a WebSocket binary protocol through Rust because custom headers and streaming behavior are easier and safer in the backend. User-provided credentials are `VOLCENGINE_APP_ID` and `VOLCENGINE_ACCESS_TOKEN`; the protocol-level `X-Api-Resource-Id` is an internal default, not a user setting.

## Settings and Persistence

Settings live in two places:

- **Renderer localStorage**: Immediate UI state such as selected provider, selected model, language, hotkeys, and toggles.
- **Tauri app data files**:
  - `settings.json` for backend-readable settings.
  - `.env` for provider credentials and API keys.
  - `transcriptions.db` for transcription history.

Important localStorage keys include:

- `preferredLanguage`
- `cloudTranscriptionProvider`
- `cloudTranscriptionModel`
- `cloudTranscriptionBaseUrl`
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

```sql
CREATE TABLE transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  original_text TEXT NOT NULL,
  processed_text TEXT,
  is_processed BOOLEAN DEFAULT 0,
  processing_method TEXT DEFAULT 'none',
  agent_name TEXT,
  error TEXT
);
```

## Development Guidelines

### Adding a New Speech-to-Text Provider

1. Add provider metadata to `src/models/modelRegistryData.json`.
2. Add UI support in `src/components/TranscriptionModelPicker.tsx` if it needs special credentials or fields.
3. Add credential persistence helpers in `src/utils/tauriAPI.ts` and `src/hooks/useSettings.ts` if needed.
4. Add backend routing and implementation in `src-tauri/src/commands/transcription.rs`.
5. Add logging that makes upload, request, polling/streaming, and response timing easy to diagnose.
6. Test timeout behavior and empty-result handling.

### Adding a New Tauri Command

1. Implement the command in the relevant `src-tauri/src/commands/*.rs` module.
2. Register it in `tauri::generate_handler!` in `src-tauri/src/lib.rs`.
3. Expose a typed wrapper in `src/utils/tauriAPI.ts`.
4. Prefer using that wrapper from React rather than importing `invoke()` directly across the UI.

### Adding a New Setting

1. Add UI state in `src/hooks/useSettings.ts`.
2. Persist backend-readable values through `window.electronAPI.setSetting()` when the backend needs them.
3. If the setting is a secret, store it through `setEnvVar` helpers instead of only localStorage.
4. Wire controls through `SettingsPage.tsx` or the relevant picker component.

### Updating Prompts or Model Lists

- Prompt behavior belongs in `src/config/prompts.ts`.
- Provider/model metadata belongs in `src/models/modelRegistryData.json`.
- Avoid duplicating model definitions in UI components unless the component is intentionally presenting a curated subset.

## Testing Checklist

- Run `npm run tauri:dev` for an interactive smoke test.
- Verify the control panel opens and settings persist after restart.
- Test dictation start/stop with the configured global hotkey.
- Test the selected transcription provider with a short recording.
- For Volcengine/Doubao, verify APP ID, Access Token, WebSocket connection, and 60-second timeout behavior.
- Verify optional AI text cleanup can be enabled and disabled.
- Verify automatic paste in a normal text field.
- On macOS, verify Accessibility permission handling and overlay visibility across spaces/full-screen apps.
- Verify transcription history is written to SQLite and appears in the control panel.
- Run `npm run build` or `npm run tauri:build` before release-oriented changes.

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
- Do not introduce new Electron-only architecture. Legacy compatibility names may exist in the frontend bridge, but new runtime work should target Tauri.
