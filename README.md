# TypeFree

<p align="center">
  <strong>🎤 AI-Powered Voice Dictation for Your Desktop</strong>
</p>

<p align="center">
  Turn your voice into text anywhere on your computer — powered by cloud AI transcription
</p>

---

## ✨ Features

### 🎙️ Voice-to-Text Dictation
- **Global Hotkey** - Press a single key (default: `F1`) to start/stop dictation from anywhere
- **Floating Widget** - Minimal, always-on-top microphone button for quick access
- **Two Activation Modes**:
  - **Tap to Talk** - Press to start, press again to stop
  - **Push to Talk** - Hold to record, release to process

### 🤖 AI-Powered Transcription
- **Cloud Speech-to-Text** - Supports multiple providers:
  - OpenAI Whisper API
  - Groq API
  - Z.ai (智谱 AI)
  - Any OpenAI-compatible custom endpoint
- **Multi-language Support** - Transcribe in any language supported by the provider

### 🧠 AI Text Enhancement
- **Intelligent Cleanup** - Automatically removes filler words, fixes grammar, and formats text
- **Agent Mode** - Address your AI assistant by name (e.g., "Hey Jarvis, make this more formal")
- **Cloud & Local AI** - Choose between cloud models (GPT, etc.) or local models via Ollama
- **Prompt Studio** - Customize how AI processes your speech

### 📋 History & Management
- **Transcription History** - View and manage all past transcriptions
- **One-Click Copy** - Easily copy or re-use previous transcriptions
- **SQLite Database** - Fast, local storage of your history

### 🎨 User Experience
- **Bilingual Interface** - English and Simplified Chinese (中文简体)
- **Control Panel** - Settings, history, and quick-start guide in one place
- **Auto-Paste** - Transcribed text automatically pastes at your cursor
- **Auto-Start** - Launch at system startup (optional)
- **Auto-Updates** - Built-in update checker and installer

### 🔧 Developer Tools
- **Debug Logging** - Enable detailed logs for troubleshooting
- **Custom API Endpoints** - Connect to self-hosted models

---

## 📋 Prerequisites

- **Node.js** 18 or higher
- **Rust** toolchain (stable)
- **Tauri Prerequisites** - See [Tauri Setup Guide](https://tauri.app/start/prerequisites/)

---

## 🚀 Quick Start

### Installation (Development)

```bash
# Clone the repository
git clone https://github.com/Charlo-O/typefree1.git
cd typefree1

# Install dependencies
npm install

# Run in development mode
npm run tauri:dev
```

### Build for Production

```bash
npm run tauri:build
```

Output files:
- **Windows**: `src-tauri/target/release/bundle/nsis/Typefree_x.x.x_x64-setup.exe`
- **MSI**: `src-tauri/target/release/bundle/msi/Typefree_x.x.x_x64_en-US.msi`

---

## 📖 Usage

### Basic Dictation

1. **Click** in any text field where you want to type
2. **Press** `F1` (or your configured hotkey) to start recording
3. **Speak** your text clearly
4. **Press** `F1` again to stop and process
5. Your transcribed text will **automatically paste** at your cursor!

### Using the Agent

When AI Text Enhancement is enabled, you can give your agent specific instructions:

```
"Hey Jarvis, write a formal email about the meeting tomorrow"
"Hey Assistant, convert this to bullet points"
"Hey Jarvis, make this more professional"
```

Regular dictation (without mentioning the agent name) will simply clean up your speech:
```
"um so like I think we should uh schedule a meeting for next week"
→ "I think we should schedule a meeting for next week."
```

---

## ⚙️ Configuration

### Transcription Providers

1. **OpenAI** - Get API key from [platform.openai.com](https://platform.openai.com)
2. **Groq** - Get API key from [console.groq.com](https://console.groq.com)
3. **Z.ai (智谱)** - Get API key from [open.bigmodel.cn](https://open.bigmodel.cn)
4. **Custom** - Any OpenAI-compatible `/v1/audio/transcriptions` endpoint

### AI Enhancement Providers

- **Cloud AI**: OpenAI, Groq, Z.ai, or custom OpenAI-compatible chat endpoints
- **Local AI**: Ollama or any local model serving OpenAI-compatible API

---

## 🔧 Troubleshooting

### Hotkey Not Working
- Check for conflicts with other applications
- Change the hotkey in Settings → General → Dictation Hotkey
- Ensure the app has permission to register global shortcuts

### No Audio / Microphone Issues
- Check that the correct microphone is selected in Settings
- Grant microphone permission when prompted
- Try enabling "Prefer Built-in Microphone" if using Bluetooth headphones

### Text Not Pasting
- Ensure Accessibility permissions are granted (macOS)
- Try manually copying from the history if auto-paste fails

### Enable Debug Mode
For detailed troubleshooting, enable Debug Logging in Settings → Developer to capture detailed logs.

---

## 🛠️ Tech Stack

- **Frontend**: React 19 + Vite + Tailwind CSS
- **Desktop**: Tauri v2
- **Database**: SQLite (via rusqlite)
- **UI Components**: Radix UI + shadcn/ui

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Tauri](https://tauri.app) - Desktop application framework
- [OpenAI Whisper](https://openai.com/research/whisper) - Speech-to-text model
- [Radix UI](https://www.radix-ui.com) - UI primitives
