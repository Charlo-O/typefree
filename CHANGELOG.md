# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-02-02

### Added
- **macOS Native Window Decorations**: Control panel now uses native macOS traffic light buttons (red/yellow/green) instead of custom window controls
- **Microphone Permission Declaration**: Added `Info.plist` with `NSMicrophoneUsageDescription` for proper microphone permission requests on macOS
- **Tauri Window Drag Region**: Added `data-tauri-drag-region` attribute for proper window dragging in Tauri v2

### Changed
- **macOS Private API**: Enabled `macOSPrivateApi` in both `tauri.conf.json` and `Cargo.toml` to support transparent windows and WebView media device access
- **Icon Regeneration**: Regenerated all app icons using `tauri icon` command for consistent appearance across all platforms
- **Platform-Specific UI**: Custom TitleBar only shown on Windows/Linux; macOS uses native decorations

### Fixed
- **navigator.mediaDevices API**: Added safety checks for `getUserMedia`, `enumerateDevices`, `addEventListener`, and `removeEventListener` to handle cases where these APIs are unavailable in Tauri's WebView environment
- **Icon Path Configuration**: Fixed bundle icon paths in `tauri.conf.json` to use existing icon files

## [Unreleased]

### Added
- **Connection Check**: Added a "Check Connection" action for cloud transcription and reasoning endpoints (endpoint URL + model validation)
- **AssemblyAI Transcription Provider**: Added AssemblyAI as a first-class speech-to-text provider with dedicated prompt support
- **Dedicated Clipboard Window**: Added a separate clipboard window triggered by an independent double-press single-key shortcut
- **Detailed Update Notes**: Added a Chinese update note for this round of changes in [docs/2026-03-08-update.md](docs/2026-03-08-update.md)
- **Release Source Bundle**: Release workflow now uploads full source archives to the GitHub Release after packaging succeeds

### Changed
- **Chinese README**: Rewrote `README.md` as the primary Chinese project documentation
- **Floating Window Behavior**: Main overlay now launches hidden, appears smaller, and opens in the lower-middle portion of the screen when invoked
- **Prompt Defaults**: Updated the default unified prompt to prefer cleaning dictated text instead of answering question-like speech
- **STT Prompt Placement**: The speech-to-text page now keeps only the AssemblyAI transcription prompt; prompt customization remains in Prompt Studio

### Fixed
- **Audio Recording Reliability**: Prevented duplicate starts with an `isStarting` guard and improved hotkey listener cleanup to avoid stale callbacks and state updates after unmount
- **Windows Hotkey Stability**: Prevented duplicate hotkey registration across windows and serialized backend registration to reduce random crashes
- **AssemblyAI Chinese Compatibility**: Adjusted model fallback handling for Chinese transcription when `universal-3-pro` is not available
- **Processing Timeout Control**: Added a 60-second timeout to stop long-running transcription pipelines instead of waiting indefinitely
