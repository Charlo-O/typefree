# TypeFree

TypeFree 是一款基于 [Tauri v2](https://v2.tauri.app/) 构建的现代化、高性能桌面听写应用程序。它利用先进的云端 AI 模型将语音转换为文本，并支持使用大语言模型（LLM）进行强大的后处理。

TypeFree 专为专业工作流设计，允许您在任何地方进行听写，然后使用 AI 对文本进行清理、格式化或重构，最后自动粘贴到目标位置。

![TypeFree 截图](https://via.placeholder.com/800x400?text=TypeFree+Application)

## 🚀 核心功能

- **全局听写**：按下 `F1`（可自定义）即可在任何应用程序中开始/停止听写。
- **高精度转写**：支持业界领先的云端提供商：
  - **OpenAI** (Whisper)
  - **Groq** (Whisper V3 Turbo - 极速体验)
  - **Z.ai** (智谱 GLM-ASR)
- **AI 文本增强**：使用 LLM 优化您的听写内容：
  - 修正语法和标点符号。
  - 自动格式化为列表、邮件或报告。
  - 支持 **OpenAI**、**Anthropic**、**Gemini** 以及通过自定义端点连接的 **Local AI** (Ollama/LocalAI)。
- **多语言界面**：完全本地化的 **简体中文** 和 **英文** 界面。
- **隐私与安全**：原生 Rust 后端确保 API 密钥和系统资源的安全处理。
- **跨平台**：针对 Windows 进行了优化（同时兼容 macOS/Linux）。

## 🛠️ 技术栈

- **核心架构**：Tauri v2 (Rust 后端)
- **前端框架**：React 19, TypeScript, Vite
- **样式方案**：Tailwind CSS v4, shadcn/ui
- **状态管理**：React Context + Tauri Store

## 📦 安装指南

### 前置条件
- **Windows**: [Microsoft Visual Studio C++ 生成工具](https://visualstudio.microsoft.com/zh-cn/visual-cpp-build-tools/)
- **Node.js**: 版本 18+ (推荐 LTS)
- **Rust**: 通过 [rustup.rs](https://rustup.rs/) 安装

### 开发环境设置

1. **克隆仓库**：
   ```bash
   git clone https://github.com/hero-tools/typefree.git
   cd typefree
   ```

2. **安装依赖**：
   ```bash
   npm install
   ```

3. **启动开发模式**：
   ```bash
   npm run tauri:dev
   ```

### 构建生产版本

创建优化后的安装包：
```bash
npm run tauri:build
```
可执行文件将输出到 `src-tauri/target/release/bundle/` 目录。

## ⚙️ 配置说明

TypeFree 完全通过其 **设置** 界面进行配置。右键点击系统托盘图标或使用 UI 控件即可访问设置。

### 语音转文字提供商
- **OpenAI**：标准且可靠的转写服务。
- **Groq**：推荐用于超低延迟场景。
- **Z.ai**：针对中英混合语音进行了优化。

### API 密钥
API 密钥安全存储在您的本地配置中。您需要为您希望使用的服务提供自己的 API 密钥。

## 🤝 参与贡献

欢迎提交代码！请确保遵循代码规范并运行格式化命令：
```bash
npm run format
```

## 📄 许可证

MIT License.
