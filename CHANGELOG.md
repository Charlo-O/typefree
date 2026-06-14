# Changelog

All notable changes to TypeFree's Tauri desktop app are documented here.

This changelog starts from the TypeFree Tauri desktop line. Older OpenWhispr and
early Electron-only history is intentionally omitted so release notes match the
current app, packaging, and GitHub Actions release flow.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.3.0] - 2026-06-14

### Added
- **OpenAI Realtime Dictation**: Added a `gpt-realtime-whisper` transcription model that streams 24 kHz PCM microphone audio through the Tauri backend and shows live transcript deltas while recording.
- **OpenAI Realtime Fallback**: Falls back to complete-audio OpenAI transcription with `gpt-4o-mini-transcribe` if the realtime WebSocket session fails or finishes without a usable final result.
- **Recording Waveform Empty State**: Added a reusable waveform animation for recording states before any live text is available.
- **Windows Tray Exit**: Added a tray context menu with an explicit Exit command and changed Windows control-panel close/minimize behavior to hide to the tray.
- **Type4Me-Style Vocabulary Tools**: Added quick correction, smart correction, grouped snippet editing, and replacement-first bulk snippet editing based on the Type4Me vocabulary workflow.
- **Hotword Save Action**: Added an explicit `Save hotword` button beside the hotword input so new hotwords are saved through a visible action instead of relying only on Enter.

### Changed
- **Vocabulary Editing Model**: Split hotwords and snippet replacements more clearly, grouped snippet triggers by replacement, and kept hotwords focused on ASR boosting while snippets handle final-text correction.
- **Control Panel Size**: Increased the default control panel window from `800x600` to `1040x760` and improved the narrow sidebar layout so vocabulary management has more room.
- **Recording Capsule UI**: Updated the recording overlay/floating dictation capsule to remove the small red recording dot, keep recognized text advancing left as it grows, and show a compact cleanup state during text cleanup.
- **Realtime Model Selection**: Exposed `gpt-realtime-whisper` in the OpenAI speech-to-text model picker while keeping existing file-based OpenAI, Groq, Z.ai, AssemblyAI, and Volcengine paths intact.
- **App Version**: Bumped package, Cargo, Tauri config, and lockfile metadata to `5.3.0`.

## [5.2.0] - 2026-06-13

### Added
- **Processing Modes**: Added direct paste, voice polish, English translation, and prompt optimization modes inspired by the Type4Me `extra` reference flow.
- **Vocabulary Management**: Added a control-panel vocabulary page with ASR hotwords, snippet replacements, user-defined entries, and bulk import.
- **Backend Vocabulary Sync**: Synced effective hotwords and snippet replacements into Tauri settings so frontend dictation, Volcengine streaming, and backend dictation paths can share the same vocabulary layer.
- **Recording Overlay Motion Styles**: Added three selectable recording overlay animation styles: timeline particles, classic waves, and dual spine particles.
- **macOS Backend Postprocessing**: Added cloud reasoning postprocessing for the macOS backend hotkey path so voice polish, English translation, and prompt optimization also work when dictation is coordinated from Rust.

### Changed
- **Floating Text Advance**: Reworked recording overlay transcript display so long text keeps advancing instead of freezing once it overflows.
- **Volcengine Hotwords**: Passed configured ASR hotwords into Volcengine/Doubao request context for supported recognition paths.
- **Reasoning Result Labeling**: Updated transcription history source labels so direct mode and fallback cleanup are no longer incorrectly marked as reasoned.
- **Settings Persistence**: Persisted processing mode, overlay style, reasoning model/provider, and custom reasoning credentials into backend-readable settings/env storage.
- **App Version**: Bumped package, Cargo, Tauri config, and lockfile metadata to `5.2.0`.

### Fixed
- **Browser Preview Guards**: Avoided noisy Tauri settings/env invoke attempts when the control panel is previewed in a plain browser outside the Tauri runtime.

## [5.1.0] - 2026-06-12

### Changed
- **Doubao ASR 2.0 Only**: Kept Volcengine/Doubao speech-to-text on the current ASR 2.0 model only, removed the older Doubao model choices from the picker, and migrated stale Volcengine model selections to `volcengine-bigmodel-async`.
- **Volcengine Endpoint Routing**: Routed all Volcengine/Doubao transcription requests through the ASR 2.0 WebSocket endpoint used by the current Seed ASR service.
- **Volcengine Credential UI**: Updated the settings copy so current API Key / Access Token credentials are primary, while APP ID remains available only for legacy setups.
- **Release Tag Compatibility**: Allowed release builds to run from uppercase `V*.*.*` tags while preserving normalized semantic version metadata.
- **App Version**: Bumped package, Cargo, Tauri config, and lockfile metadata to `5.1.0`.

### Fixed
- **Packaged Doubao Authentication**: Removed the hard requirement for `VOLCENGINE_APP_ID` when using current API-key based Volcengine credentials, and added fallback handling for modern `X-Api-Key` authentication when legacy headers are rejected.
- **Volcengine Streaming Errors**: Preserved the provider error returned by the streaming task instead of replacing it with a generic closed-session message.
- **Reasoning Provider Selection**: Honored the configured reasoning provider for DeepSeek/custom cleanup flows instead of inferring the provider only from the selected model id.

## [5.0.0] - 2026-06-12

### Added
- **DeepSeek AI Cleanup Provider**: Added DeepSeek as the first AI text enhancement provider, including provider metadata, API key persistence, model fetching, and connection speed testing.
- **Provider Model Management**: Added provider API key visibility controls, smaller model-list refresh actions, toast feedback for connection tests, and model activation flows that match the speech-to-text picker.
- **Updated Brand Assets**: Added refreshed TypeFree app icons, provider icons, and a dedicated DeepSeek provider icon for the settings UI.

### Changed
- **Speech Provider Ordering**: Moved Doubao and Z.ai to the front of the speech-to-text provider list for quicker access to the primary Chinese ASR providers.
- **Settings Navigation**: Reordered troubleshooting below recent transcriptions and refined the sidebar/tab styling so the control panel feels lighter and more consistent.
- **Model Picker Interaction**: Reworked provider tabs and model cards to use icon-first tabs, hover labels, evenly distributed desktop layouts, and a thinner activation outline.
- **API Key Forms**: Simplified API key rows by removing paste buttons where they were visually heavy, moving API key links closer to the input, and aligning input-side action button sizing.
- **Localization Polish**: Localized remaining obvious English copy in general settings, hotkey inputs, microphone permission prompts, update dialogs, model download toasts, and sidebar tooltips.
- **App Version**: Bumped package, Cargo, Tauri config, and lockfile metadata to `5.0.0`.

### Fixed
- **Final Dictation Paste**: Fixed a regression where shortcut-triggered dictation could finish processing but skip the final paste because the stop state was not marked consistently.
- **No Live Direct Typing**: Removed Windows live direct input while streaming so text is inserted only after the full utterance has been transcribed.
- **Windows Audio Ducking Restore**: Changed ducking to reduce other apps to a softer volume instead of muting them, and restored only sessions that TypeFree actually changed.
- **Clipboard Feedback**: Preserved clipboard paste toast feedback and cleaned up related copy so paste actions report results consistently.

## [4.6.0] - 2026-06-11

### Added
- **Prompt Context Controls**: Added AI cleanup context options for selected text and clipboard content so cleanup can better preserve references, terms, and user intent.
- **Provider Branding Assets**: Added a Doubao provider icon and updated Volcengine/Doubao provider naming across the transcription UI.
- **Renderer Diagnostics**: Added a frontend-to-backend renderer log bridge to make Tauri WebView issues easier to diagnose from native logs.

### Changed
- **AI Cleanup UI**: Simplified the AI text enhancement page by removing the extra cloud-AI explanation card and tightening the model selector flow.
- **Recording Feedback**: Shortened and softened recording start feedback, reduced duplicated sound playback, and kept stop feedback distinct.
- **Windows Audio Ducking**: Changed recording ducking from muting other sessions to lowering their volume temporarily, with safer restoration tracking.
- **Automatic Paste**: Improved non-macOS paste behavior by preferring clipboard-based paste simulation over direct synthetic text entry.
- **App Polish**: Refined landing assets, title/window controls, loading indicators, permission messaging, and app scrollbars for a lighter desktop feel.
- **App Version**: Bumped package, Cargo, Tauri config, and lockfile metadata to `4.6.0`.

### Fixed
- **Ducking Restore Reliability**: Preserved pending audio-session restore state if a restore attempt fails so affected app audio can be recovered on retry.
- **Hotkey Digit Input**: Normalized numpad digit capture so numeric hotkeys can be entered consistently in settings.
- **Reasoning API Compatibility**: Improved reasoning request handling, prompt-context plumbing, and provider configuration persistence.

## [4.5.0] - 2026-06-10

### Added
- **Volcengine/Doubao Streaming Dictation**: Added a cloud-first streaming ASR path that sends 16 kHz mono PCM chunks while recording and receives live partial/final transcript events from the Tauri backend.
- **Live Floating Transcript**: The recording UI now shows text as it is recognized, with a compact live preview, audio-level feedback, and stable sizing to avoid visual jitter.
- **Windows Live Direct Input**: On Windows, when AI text enhancement is disabled, Volcengine streaming can append recognized text directly into the focused input field as partial results arrive.
- **Windows Audio Ducking**: Added a native Windows audio ducking command so recording can temporarily soften competing system audio.

### Changed
- **Stop-To-Text Latency**: Stopping a Volcengine streaming recording now uses the already-visible live transcript immediately instead of waiting for a second full-audio transcription pass.
- **Volcengine Resource Routing**: Standardized Volcengine/Doubao requests on the SeedASR resource ID used by the streaming path.
- **Cloud Settings Sync**: Synced transcription provider, model, language, and reasoning settings into backend-readable Tauri settings for more reliable hotkey/backend paths.
- **Recording Sounds**: Made start/stop feedback softer with longer attack/release envelopes so recording begins and ends less abruptly.
- **App Version**: Bumped package, Cargo, Tauri config, and lockfile metadata to `4.5.0`.

### Fixed
- **Streaming Finish Handling**: Fixed a Tauri backend bug where `finish` closed the streaming command channel and was interpreted as `cancelled`, causing fallback to slower complete-audio transcription.
- **Duplicate Paste Prevention**: Completion callbacks can now skip paste when text has already been inserted live, while still saving transcription history.
- **Partial Rewrite Safety**: Live direct input only appends monotonic transcript deltas; if the ASR provider rewrites earlier text, TypeFree pauses live direct input and keeps the floating preview updated.
- **macOS Hotkey Routing**: Routed macOS Volcengine hotkey dictation through the frontend streaming path where needed so provider-specific settings are honored.

## [4.2.0] - 2026-03-16

### Added
- **Source Release Archives**: GitHub Actions release builds now attach full source `.zip` and `.tar.gz` archives.
- **Backend Clipboard Helpers**: Added additional clipboard and paste helpers for the Tauri desktop runtime.

### Changed
- **Release Packaging**: Updated Tauri release metadata and package versions for the `v4.2.0` release.

### Fixed
- **Window Visibility**: Improved main window show/hide behavior for the dictation surface.
- **Paste Reliability**: Expanded platform-specific paste simulation and fallback behavior.

## [4.1.0] - 2026-03-15

### Changed
- **Default UI Language**: Set the default UI language to Simplified Chinese for the TypeFree Tauri app.
- **Version Metadata**: Bumped Tauri, Cargo, and package metadata for the `v4.1.0` release.

## [4.0.3] - 2026-03-09

### Fixed
- **macOS Release Build**: Restored macOS release packaging after the Tauri v2 release workflow migration.

## [4.0.2] - 2026-03-09

### Changed
- **Unsigned macOS Builds**: Adjusted GitHub Actions release packaging to produce unsigned macOS artifacts when signing credentials are unavailable.

## [4.0.0] - 2026-03-08

### Added
- **Tauri v2 Release Workflow**: Added cross-platform GitHub Actions builds for Windows, macOS, and Linux.
- **TypeFree Desktop Packaging**: Moved release packaging to the current Tauri desktop app structure.

### Changed
- **Project Identity**: Release notes and packaging now refer to TypeFree rather than the older OpenWhispr app line.

## [3.0.0] - 2026-02-02

### Added
- **macOS Native Window Decorations**: Control panel now uses native macOS traffic light buttons instead of custom window controls.
- **Microphone Permission Declaration**: Added `Info.plist` with `NSMicrophoneUsageDescription` for proper microphone permission requests on macOS.
- **Tauri Window Drag Region**: Added `data-tauri-drag-region` support for dragging Tauri windows.

### Changed
- **macOS Private API**: Enabled `macOSPrivateApi` for transparent windows and WebView media device access.
- **Icon Regeneration**: Regenerated app icons for consistent cross-platform appearance.
- **Platform-Specific UI**: Kept custom title bars on Windows/Linux while using native decorations on macOS.

### Fixed
- **Media Device Guards**: Added safety checks around WebView media-device APIs.
- **Icon Path Configuration**: Fixed bundle icon paths in `tauri.conf.json`.
