# TypeFree

TypeFree 是一款基于 **Tauri v2 + React + Rust** 的桌面语音听写客户端。它可以在任意输入框中把语音转成文字，自动写入剪贴板、粘贴到当前光标位置，并把转录结果保存到本地历史记录。

当前仓库地址：

```bash
git clone https://github.com/Charlo-O/typefree-new.git
cd typefree-new
```

## 运行时边界

TypeFree 当前唯一默认桌面运行时是 Tauri v2。默认开发、构建、发布和 CI 流程都以 `src/` + `src-tauri/` 为准。

旧 Electron 实现已移动到 `legacy-electron/`，只作为迁移参考保留。新增桌面能力必须通过 `src/shared/platform` 进入 Tauri bridge，不再新增 Electron main/preload 代码。

## 功能概览

- 全局听写快捷键：在当前聚焦应用中开始/停止录音。
- 处理模式快捷键：可为快速模式、语音润色、指令模式、英文翻译和 Prompt 优化分别绑定全局快捷键，按下后直接以对应模式听写。
- Tauri 原生客户端：Windows 使用 WASAPI，macOS/Linux 走原生录音能力抽象。
- 语音转文字：支持 AssemblyAI、OpenAI、Groq、Z.ai、Volcengine/Doubao，以及本地 ASR 运行时。
- 本地 ASR：内置 sherpa-onnx（SenseVoice、Paraformer、Whisper、Qwen3-ASR ONNX），并可通过外部命令或 OpenAI-compatible 本地服务接入 GGUF、R2T2、llama.cpp、whisper.cpp、faster-whisper 等引擎。
- AI 后处理：转录后可通过 reasoning 模型进行清理、格式化、改写；可选“指令模式”识别“帮我翻译”“总结”“改写”等文本指令。
- Prompt Studio：管理默认提示词、自定义提示词、版本、测试样例和 A/B 对比。
- 词表系统：支持 Hotwords、Snippets、Context Packs 和按场景分层。
- 剪贴板中心：支持文本/图片历史、收藏、缩略图存储和快速粘贴。
- 历史记录：SQLite 持久化 session、outputs、全文搜索和调试数据。
- 隐私与诊断：支持隐私应用策略、日志脱敏、runtime probe 和 session timeline。

## 技术栈

- Frontend: React 19, TypeScript, Tailwind CSS v4, Vite
- Desktop: Tauri v2
- Backend: Rust, Tokio, reqwest, tokio-tungstenite, rusqlite
- UI: shadcn-style components, Radix primitives, lucide-react
- Persistence: SQLite, Tauri app data, platform credential store
- CI/CD: GitHub Actions

## 目录结构

```text
.
├── src/                         # React/TypeScript 前端
├── src-tauri/                   # Tauri v2 Rust 后端和打包配置
├── src/shared/platform/         # UI 到 Tauri command 的统一 platform bridge
├── src/features/                # feature-sliced 前端功能模块
├── scripts/                     # 验证、runtime smoke、发布辅助脚本
├── .github/workflows/           # CI、客户端打包、Release workflows
├── .github/actions/             # GitHub Actions 复用步骤
├── docs/                        # 运行时、发布、验收文档
└── legacy-electron/             # 旧 Electron 实现，仅作为迁移参考
```

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- Rust stable toolchain
- Tauri 平台依赖

Linux 构建需要 WebKitGTK、ayatana appindicator、rsvg、patchelf 等依赖；GitHub Actions 已通过 `.github/actions/setup-tauri-linux` 自动安装。macOS 如需签名和 notarization，需要配置 Apple 开发者证书和 notarization secrets。

## 本地开发

安装依赖：

```bash
npm install
```

启动前端 + Tauri 后端开发环境：

```bash
npm run tauri:dev
```

只启动 Vite 前端：

```bash
npm run dev
```

本地构建桌面客户端：

```bash
npm run tauri:build
```

常见输出目录：

- Windows: `src-tauri/target/release/bundle/nsis/` 和 `src-tauri/target/release/bundle/msi/`
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `src-tauri/target/release/bundle/deb/`、`rpm/`、`appimage/`

## 配置语音服务

TypeFree 不会把 API key 写入仓库。开发时可以从设置页配置凭据，后端会通过平台 credential store 保存：

- Windows: DPAPI-protected app data
- macOS: Keychain
- Linux: Secret Service

支持的后端 credential keys：

- `ASSEMBLYAI_API_KEY`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`
- `ZAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `VOLCENGINE_APP_ID`
- `VOLCENGINE_ACCESS_TOKEN`

Volcengine/Doubao 配置说明见 [doubaoapi.md](doubaoapi.md)。

## 验证命令

前端、边界、类型、构建：

```bash
npm run verify:frontend
```

Tauri/Rust、命令边界、录音、转写 provider、release 配置：

```bash
npm run verify:tauri
```

完整 release-oriented 本地验证：

```bash
npm run verify:frontend
npm run verify:tauri
npm run tauri:build
```

Runtime smoke 命令会启动 Tauri dev runtime，并可能访问本地麦克风、剪贴板或 provider 网络服务：

```bash
npm run smoke:tauri-dev
npm run smoke:runtime-probe
npm run smoke:native-recording
npm run smoke:dictation-pipeline
npm run smoke:cloud-credential-preflight
npm run smoke:cloud-transcription
```

## GitHub Actions 构建客户端

仓库包含三类 Actions：

- `.github/workflows/ci.yml`: push/PR 到 `main` 时运行 frontend verify 和 Tauri Rust preflight。
- `.github/workflows/client-build.yml`: 手动触发客户端打包，上传 Windows/macOS/Linux artifact，适合测试构建。
- `.github/workflows/release.yml`: 推送 `vX.Y.Z` tag 或手动输入版本号后，创建 GitHub Release 并上传正式客户端安装包。

### 手动打包客户端

1. 打开 GitHub 仓库的 **Actions** 页面。
2. 选择 **Build Client** workflow。
3. 点击 **Run workflow**。
4. 选择 `all` 或单个平台。
5. 等待 job 完成后，在 workflow run 的 **Artifacts** 区下载客户端包。

### 发布正式 Release

方式一：推送 tag。

```bash
git tag -a v5.6.0 -m "Release v5.6.0"
git push origin v5.6.0
```

方式二：在 GitHub Actions 中手动运行 **Release** workflow，输入版本号。

Release workflow 会：

- 先运行 frontend verify、Rust preflight 和 release config gate。
- 自动创建缺失的 release tag。
- 构建 Windows、macOS、Linux 客户端。
- 上传安装包和源码压缩包。
- 发布 GitHub Release。

macOS 默认生成 unsigned artifact。如需 signed/notarized artifact，请在手动触发 Release 时选择 `signed-notarized`，并配置以下 GitHub secrets：

- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_API_PRIVATE_KEY_P8`

## 使用流程

1. 打开 TypeFree 客户端。
2. 在设置中选择语音转文字 provider、model 和语言。
3. 配置 API key 或 Volcengine APP ID / Access Token。
4. 设置全局听写快捷键。
5. （可选）在“AI 文本增强 → 处理模式快捷键”中为各处理模式分别绑定快捷键。
6. 在任意文本输入框聚焦光标。
7. 按快捷键开始录音，再次按快捷键结束。
8. TypeFree 会转写、可选 AI 后处理、写入剪贴板并自动粘贴。

需要用语音执行文本指令时，在“AI 文本增强”中选择“指令模式”，并在同一次录音中说出完整句子，
例如“帮我翻译 今天天气很好”或“总结 这周完成了接口和测试”。该模式只做文本转换，不执行系统命令；
如果未配置 reasoning 模型，TypeFree 会保留原始转写作为安全回退。

### 本地 ASR

在“语音转文字”中选择“本地 ASR”，再选择运行时并填写模型路径。SenseVoice 和 Paraformer 填一个 ONNX 文件；Whisper 填 encoder/decoder；Qwen3-ASR 填 sherpa-onnx 导出的 conv frontend、encoder、decoder、tokenizer 四个文件。

需要使用 GGUF、Confucius4-R2T2、llama.cpp 或 whisper.cpp 时，选择“外部命令”，填写可执行文件，并在命令参数中使用 `{audio_file}`、`{model}`、`{language}` 占位符。TypeFree 直接启动进程，不经过 shell。也可以选择 OpenAI-compatible 本地服务，填写 `/v1` 端点和服务端模型 ID。

Confucius4-R2T2 的标准 safetensors checkpoint 需要 Python/vLLM/CUDA 环境；桌面端更适合使用 GGUF 加 `mmproj`，通过 `r2t2_llama` 或你自己的 sidecar 命令接入。Q8_0 通常是质量和占用的平衡点，Q4_K_M 更省资源但需要自行验证中文专名识别效果。

## 排障

- 启动失败：确认没有旧的 `typefree.exe` 正在运行。
- 麦克风无数据：检查系统麦克风权限和输入设备选择。
- 自动粘贴失败：macOS 需要 Accessibility 权限；Linux 依赖 X11/Wayland 下的粘贴工具；Windows 使用原生按键模拟。
- 转录为空：检查录音 bytes、provider credential、模型、语言和网络。
- Volcengine/Doubao 超时：确认 APP ID、Access Token、网络和 provider 服务状态。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
