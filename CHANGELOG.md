# Changelog

All notable changes to TypeFree's Tauri desktop app are documented here.

This changelog starts from the TypeFree Tauri desktop line. Older OpenWhispr and
early Electron-only history is intentionally omitted so release notes match the
current app, packaging, and GitHub Actions release flow.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
