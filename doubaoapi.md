# 豆包语音识别配置说明

TypeFree 的豆包语音识别走火山引擎语音识别服务，项目内部 provider id 是
`volcengine`，界面显示为 `Volcengine (豆包)`。

当前实现是云端优先，不是本地语音识别。录音开始后，前端会采集麦克风音频，
实时转换为 16 kHz 单声道 16-bit PCM 分片，并通过 Tauri Rust 后端使用火山引擎
WebSocket 二进制协议发送到云端识别。

参考文档：火山引擎大模型流式语音识别 API。

## 需要的凭据

在设置页选择 `Volcengine (豆包)` 后填写：

- `APP ID`
- `Access Token`

对应后端环境变量：

- `VOLCENGINE_APP_ID`
- `VOLCENGINE_ACCESS_TOKEN`

用户不需要填写 Resource ID。火山引擎协议层仍需要 `X-Api-Resource-Id`，TypeFree
在后端固定使用：

```text
volc.seedasr.sauc.duration
```

这个值不是用户凭据，不再作为设置项暴露。

## 模型选项

模型定义在 `src/models/modelRegistryData.json`：

- `volcengine-bigmodel-async`
  - 使用 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
  - 默认推荐，延迟更低，适合日常听写
- `volcengine-bigmodel`
  - 使用 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`
  - 更积极返回中间结果，适合需要即时反馈的场景
- `volcengine-bigmodel-nostream`
  - 使用 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream`
  - 通常在最后一包后返回完整结果，适合短音频或高准确率测试

默认建议使用 `volcengine-bigmodel-async`。

## 4.5.0 的实时链路

4.5.0 起，TypeFree 的豆包路径支持录音时实时返回文字：

1. `src/helpers/audioManager.js` 开始录音并采集音频帧。
2. 前端将音频下采样为 16 kHz 单声道 PCM。
3. `src/utils/tauriAPI.ts` 调用 Tauri 流式命令。
4. `src-tauri/src/commands/transcription.rs` 建立火山引擎 WebSocket 会话。
5. 后端发送配置包和约 200 ms 的 PCM 音频分片。
6. 后端解析云端返回的 partial/final 文本，并通过 `volcengine-streaming-transcript` 事件发给前端。
7. 浮窗实时显示识别出的文字。
8. 在 Windows 且 AI 文本增强关闭时，TypeFree 会把单调追加的文字增量直接输入到当前焦点输入框。
9. 停止录音时，TypeFree 会优先使用已经出现的实时文本，避免重新走完整音频转写。

如果火山引擎临时改写前文，TypeFree 会暂停实时直接输入，只继续更新浮窗，避免在目标输入框里产生重复或错位文字。

## 为什么仍然可能变慢

如果豆包路径仍然慢，通常从这些位置排查：

- 网络连接慢：WebSocket 建连、DNS、代理、VPN、跨区链路都会影响延迟。
- 服务端识别慢：火山引擎服务端负载、模型模式、音频长度都会影响返回时间。
- AI 文本增强开启：Reasoning 模型可能比语音识别本身更慢；要测试纯转写速度时先关闭 AI 文本增强。
- 流式回退：如果日志里出现 `Volcengine streaming failed, falling back to complete-audio transcription`，说明实时链路失败并退回整段音频转写。
- 音频过短或静音：太短或没有明显语音时，云端可能无法返回有效结果。

快速判断方法：

1. 录 2 到 3 秒短句测试。
2. 暂时关闭 AI 文本增强，只看语音识别耗时。
3. 换一个网络，或关闭/更换代理后再试。
4. 查看日志里的 `Volcengine streaming pipeline timing`，重点看 `roundTripDurationMs`、`transcriptionProcessingDurationMs` 和是否有 fallback。
5. 如果返回 401，优先确认 APP ID 和 Access Token 属于同一个已开通豆包流式语音识别服务的应用。

## 超时

完整音频转写路径有 60 秒超时保护。流式路径停止后会优先使用已收到文本，避免长时间等待；如果完全没有收到文本，才会报错或进入可用的回退路径。
