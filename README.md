# Typefree

Typefree is a Tauri v2 + React desktop dictation app.

It provides a small floating dictation panel (always-on-top) and a Control Panel for settings and history.
Press a global hotkey to start/stop recording, transcribe via cloud providers (OpenAI/Groq/Z.ai), and auto-paste the result.

## Features

- Global hotkey to start/stop dictation (default: `F1`, configurable)
- Floating dictation window
  - Transparent background
  - Appears at the bottom-right corner of the desktop
  - Right-click menu on the mic button
- Control Panel (history, settings, API keys)
- Local transcription history (SQLite)

## Prerequisites

- Node.js 18+
- Rust toolchain (stable)
- Tauri prerequisites for your OS: https://tauri.app/start/prerequisites/

## Development

```bash
npm install
npm run tauri:dev
```

Vite runs at `http://localhost:5174` in dev.

## Build

```bash
npm run tauri:build
```

## Usage

1. Press the hotkey (`F1` by default) to start recording.
2. Press again to stop recording and run transcription.
3. Text will be copied/pasted automatically (depending on OS permissions).

## Troubleshooting

- Hotkey does nothing:
  - Check for hotkey conflicts and change it in Control Panel.
  - Ensure the app has permission to register global shortcuts on your OS.
- History/text does not update:
  - If you see this, check the app console/logs for IPC/event errors.

## License

MIT. See `LICENSE`.
