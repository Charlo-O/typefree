# TypeFree

TypeFree 是一款基于 Tauri v2 的桌面语音听写应用，目标是在任意输入位置把语音快速转成可直接粘贴的文字。它支持多种云端语音转文字服务，也支持在转录后继续用 AI 模型做文本整理和润色。

## 主要功能

- 全局听写：在任意应用中通过全局快捷键开始和结束录音
- 悬浮主窗：使用更小的悬浮窗承载录音状态与常用操作
- 多提供商转录：支持 AssemblyAI、OpenAI、Groq、智谱 Z.ai 以及兼容 OpenAI 的自定义端点
- AI 文本整理：可在转录后使用云端或本地模型做文本清理、格式化与重写
- Prompt Studio：可查看、测试和自定义文本整理提示词
- 剪贴板中心：支持历史记录、收藏夹，以及通过独立窗口快速查看剪贴板内容
- 本地存储：使用 SQLite 保存历史转录内容
- 中英文界面：内置简体中文和英文界面

## 最近更新

本轮功能调整较多，详细说明见：

- [2026-03-08 更新说明](docs/2026-03-08-update.md)

## 环境要求

- Node.js 18 或更高版本
- Rust stable toolchain
- Tauri 对应平台依赖
  - 参考 [Tauri 官方环境要求](https://tauri.app/start/prerequisites/)

## 快速开始

### 克隆仓库

```bash
git clone https://github.com/Charlo-O/typefree.git
cd typefree
```

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run tauri:dev
```

## 构建发布版本

```bash
npm run tauri:build
```

常见输出目录：

- Windows NSIS 安装包：`src-tauri/target/release/bundle/nsis/`
- Windows MSI 安装包：`src-tauri/target/release/bundle/msi/`
- macOS 安装包：`src-tauri/target/release/bundle/dmg/`
- Linux 安装包：`src-tauri/target/release/bundle/`

## 基本使用

### 语音听写

1. 在目标输入框中聚焦光标
2. 按下你配置的听写快捷键开始录音
3. 再次按下快捷键，或按当前激活方式结束录音
4. 等待语音转文字和文本整理完成
5. 结果会自动粘贴到当前光标位置，同时写入历史记录

### 剪贴板窗口

- 可以在设置中为剪贴板配置单独的双击按键
- 双击该按键后，会打开独立的剪贴板窗口
- 剪贴板历史支持复制、粘贴、收藏和分组管理

## 配置说明

### 语音转文字

- AssemblyAI
  - 支持独立的转录提示词
  - `Universal-3 Pro` 的提示词能力更强
  - 中文场景会根据能力自动回落到 `universal-2`
- OpenAI / Groq / Z.ai / 自定义兼容端点
  - 适合直接接入已有的 Whisper 或兼容接口

### AI 文本整理

- 可选择是否启用 AI 文本增强
- 可选择云端模型或本地模型
- Prompt Studio 用于查看当前默认提示词、编辑自定义提示词，以及用测试文本验证输出效果

## CI/CD 发布流程

仓库内置了 GitHub Actions 发布工作流，支持两种触发方式：

- 推送形如 `vX.Y.Z` 的标签
- 在 GitHub Actions 中手动触发，并填写版本号

发布工作流会：

- 为 Windows、macOS 和 Linux 构建安装包
- 创建或更新对应版本的 GitHub Release 草稿
- 上传各平台安装包到 Release
- 额外上传当前版本的完整源码压缩包（zip 和 tar.gz）

工作流定义文件位于：

- [.github/workflows/release.yml](.github/workflows/release.yml)

## 调试与排障

- 开启调试日志后，可结合 `typefree-dev.log` 与前端日志定位问题
- 如果自动粘贴异常，优先检查目标应用焦点、系统权限和快捷键冲突
- 如果转录耗时过长，优先检查当前语音转文字提供商、模型和是否开启 Reasoning

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
