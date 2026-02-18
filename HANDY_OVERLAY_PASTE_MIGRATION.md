# Typefree macOS 悬浮窗 + 自动粘贴改造记录（参考 Handy）

> 目的：把 “按热键录音 -> 转录 -> 在光标处粘贴” 做到和 [Handy](https://github.com/cjpais/Handy) 一样稳定，且在全屏 App / 多显示器 / 不同键盘布局下可用。
>
> 本文聚焦 2 个用户可感知的问题：
> 1) 悬浮窗（录音/转录状态提示）看不见  
> 2) 转录完成后没有自动粘贴（或粘贴偶发失败/崩溃）

---

## 一、问题现象与复现

## 二、对比总览（旧实现 vs Handy vs 新实现）

| 项目 | 旧实现（改造前 / HEAD） | Handy | 新实现（改造后） |
| --- | --- | --- | --- |
| 悬浮窗载体 | 无独立 overlay 面板 | `tauri-nspanel` + `NSPanel` | 复用 `main` 窗口并转换为 `NSPanel`（`src-tauri/src/overlay.rs`） |
| 悬浮窗动画 | 无 | `show-overlay`/`hide-overlay` + fade | `show-overlay`/`hide-overlay` + fade（`src/components/RecordingOverlay.jsx`） |
| 悬浮窗跨全屏/空间 | 无 | `PanelLevel::Status` + `CollectionBehavior` | 同步对齐（`PanelLevel::Status` + `can_join_all_spaces/full_screen_auxiliary`） |
| 自动粘贴权限提示 | 无 | 有明确引导 | 增加 `AXIsProcessTrusted()` 检测并返回可读错误 |
| 自动粘贴线程约束 | 未处理 | 规避崩溃 | `run_on_main_thread` 调 Enigo，规避 `dispatch_assert_queue` |
| 键盘布局兼容 | `Unicode('v')`（易受布局/IME 影响） | `Key::Other(9)`（物理键位） | 改用 `Key::Other(0x09)`（物理键位） |
| 剪贴板保护 | 不恢复（覆盖用户剪贴板） | 保存/恢复 | 保存/恢复；失败时保留转录文本在剪贴板 |

---

### 1) 悬浮窗看不见

现象：
- 按热键开始录音、停止录音后，期望出现 “Recording / Transcribing / Pasting” 的小胶囊悬浮提示，但屏幕上没有任何提示。

复现：
1. `npm run tauri:dev`
2. 切换到任意目标 App（例如 Notes / VS Code / 浏览器输入框）
3. 按下全局热键开始录音、再按一次结束录音
4. 观察屏幕底部中间附近是否出现提示

### 2) 自动粘贴不生效（且可能崩溃）

现象 A（更常见）：
- 转录完成后没有自动粘贴到光标处，但剪贴板里已经有转录文本，手动 `Cmd+V` 可以粘贴。

现象 B（曾出现）：
- 偶发直接崩溃（`SIGTRAP / dispatch_assert_queue`），堆栈指向 `HIToolbox` / `TSMGetInputSourceProperty` / `enigo`。

复现：
1. 不授予 macOS 辅助功能（Accessibility）权限
2. 运行 dev 版二进制：`src-tauri/target/debug/typefree`
3. 按热键录音并结束
4. 观察：目标 App 不会收到粘贴，但剪贴板被写入文本

---

## 三、旧实现（改造前 / HEAD）的问题细节

### 1) “悬浮窗”在旧实现中并不存在

在 `HEAD` 版本中：
- `src-tauri/tauri.conf.json` 仅声明了 `main` 与 `control` 两个窗口，没有 `recording_overlay` 窗口。
- `src-tauri/src/` 里也没有 `overlay.rs` 相关模块。

这意味着：
- “看不见悬浮窗”不是渲染 bug，而是功能缺失（没有创建承载悬浮提示的独立窗口/面板）。

### 2) 粘贴逻辑：线程、权限、键盘布局三个坑叠加

旧版粘贴实现（`HEAD:src-tauri/src/commands/clipboard.rs`）核心问题：

旧代码（精简）：

```rust
#[tauri::command]
pub fn paste_text(text: String) -> Result<(), String> {
  write_clipboard(text)?;
  thread::sleep(Duration::from_millis(50));
  simulate_paste()
}
```

#### (1) 没有检查 Accessibility 权限，导致“看起来像没粘贴”

macOS 上，模拟键盘输入（`Cmd+V`）需要用户给 App 开启：
`System Settings -> Privacy & Security -> Accessibility`

旧实现未做任何检测或用户提示：
- 用户未授权时，系统会忽略 synthetic key events
- 结果表现为：自动粘贴“什么都没发生”，用户只能猜测原因

#### (2) Enigo 在 tokio worker 上调用，触发 `dispatch_assert_queue`（SIGTRAP）

从崩溃堆栈可以看到典型路径：
- `tokio-runtime-worker` -> `enigo::platform::macos_impl::*` -> `HIToolbox` -> `dispatch_assert_queue`

原因：
- Enigo 在 macOS 下会触达 `HIToolbox/TSM` 相关 API，其中部分要求在主线程/主队列调用
- 如果在后台线程调用，就会触发断言并 crash

旧实现的 `paste_text()` 是普通 Tauri command：
- 可能运行在非主线程（尤其在后台 dictation 流程里）
- 于是出现 SIGTRAP

#### (3) 使用 `Key::Unicode('v')`，键盘布局/IME 会导致 `Cmd+V` 不稳定

旧代码：
- `Cmd` + `Key::Unicode('v')`

问题：
- 当用户使用非英文布局或 IME 时，`Unicode('v')` 并不等价于物理键位的 `V`
- 导致 `Cmd+V` 组合不一定被目标 App 识别为 paste

#### (4) 没有剪贴板保护（会永久覆盖用户剪贴板）

旧代码：
- 直接把转录文本写入剪贴板并粘贴
- 粘贴完成后不恢复原剪贴板内容

这与 Handy 的体验不同：Handy 会保存用户剪贴板，粘贴后再恢复。

### 3) 热键触发链路偏 “前端驱动”，全屏/后台时不稳定

旧版 `HEAD:src-tauri/src/commands/hotkey.rs`：
- 热键回调里只做一件事：`emit("toggle-dictation")` 给前端

问题：
- 当目标 App 全屏、或 WebView 被系统 throttling 时，前端驱动链路可能延迟甚至不触发
- 用户体验为：热键不灵/反应慢/状态不同步

Handy 采取的是：关键录音/转录链路尽量在后端保证执行。

补充：曾出现 `panic_cannot_unwind` / `abort()` 的崩溃堆栈（`global_hotkey::*hotkey_handler`）。
- 这类崩溃通常意味着：热键回调处于 FFI 边界，内部发生 panic 时无法 unwind，只能 `abort()`。
- 修复思路是：确保热键回调绝不 panic，且回调只做最小派发，把重活挪到可控的 Rust async 任务里执行。

---

## 四、Handy 的关键实现点（我们对齐的部分）

### 1) 悬浮窗：使用非激活的 NSPanel（不抢焦点）

Handy（macOS）要点：
- 用 `tauri-nspanel` 把 overlay 做成 `NSPanel`
- `.no_activate(true)` + `PanelLevel::Status`  
  让面板在全屏 App 之上显示，同时不激活自身、不抢焦点
- `CollectionBehavior::can_join_all_spaces().full_screen_auxiliary()`  
  让 overlay 可跨空间/全屏辅助显示
- 前端通过 `show-overlay` / `hide-overlay` 事件做淡入淡出动画

### 2) 粘贴：布局无关 keycode + 剪贴板保存/恢复 + 延迟

Handy 粘贴链路要点：
- 写剪贴板 -> 延迟 -> 发送 paste key combo -> 再延迟 -> 恢复剪贴板
- 在 macOS 使用物理键位 keycode（`kVK_ANSI_V = 9`），避免布局/IME 影响

---

## 五、新实现（改造后）做了什么

### 1) 合并悬浮窗到 `main`（Handy 风格，无多余窗口）

新增文件/改动点：
- `src-tauri/src/overlay.rs`：把 `main` 窗口转换为 `NSPanel`，并复用原 overlay 的 size/position/show/hide 逻辑
- `src/main.jsx`：在 Tauri 运行时让 `main` 默认渲染 `RecordingOverlay`
- `src/components/RecordingOverlay.jsx`：监听 `show-overlay` / `hide-overlay` 事件，CSS 淡入淡出

后端把 `main` 转面板（关键点）：
- `main_window.to_panel::<RecordingOverlayPanel>()`
- `can_become_key_window: false`（不抢焦点）
- `PanelLevel::Status`（顶层状态栏级别）
- `CollectionBehavior::can_join_all_spaces().full_screen_auxiliary()`（跨 space/全屏辅助）
- `transparent + click-through`（视觉只显示胶囊，鼠标点击穿透）

位置计算做了 Retina/多显示器适配：
- 通过 `monitor.work_area()` + `monitor.scale_factor()` 转换成 logical points
- 每次 show 时重算坐标，避免用户移动到另一块屏幕后 overlay 跑偏

### 2) “看不见悬浮窗”的坑：Tauri v2 Capabilities（以及为什么最终合并到 main）

在“独立 overlay 窗口”方案中，关键根因是：
- Tauri v2 的 `@tauri-apps/api/event.listen` 受 capabilities 限制
- 窗口 label 如果不在 `src-tauri/capabilities/default.json` 的 `windows` 白名单里，`listen()` 会被拒绝
- `RecordingOverlay.jsx` 里 `listen()` 被 `try/catch` 吞掉后，UI 永远保持 `opacity: 0`，表现为“悬浮窗不存在”

最终方案直接把 overlay 合并到 `main`：
- 彻底避免“多余窗口”（用户视觉更简单）
- 也避免了 window label 额外维护导致的 capabilities 配置漂移

### 3) 粘贴稳定性改造

改动点（`src-tauri/src/commands/clipboard.rs`）：

新代码（精简逻辑）：

```rust
#[tauri::command]
pub fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
  ensure_accessibility_permission()?;
  let prev = app.clipboard().read_text().ok();
  app.clipboard().write_text(text)?;
  sleep(paste_delay);
  run_enigo_on_main_thread(app)?;
  sleep(restore_delay);
  restore(prev);
  Ok(())
}
```

#### (1) 明确提示/阻断：没有 Accessibility 就不尝试自动粘贴

- 新增 `AXIsProcessTrusted()` 检查
- 没权限直接返回错误，并保留转录文本在剪贴板里（用户可手动 `Cmd+V`）

这就是你看到的报错：
`macOS Accessibility permission is required for automatic pasting... Text is copied to clipboard...`

#### (2) 解决 SIGTRAP：Enigo 必须跑在主线程队列

- 新增 `simulate_paste_best_effort(app: &AppHandle)`
- 通过 `app.run_on_main_thread(...)` 执行 `simulate_paste()`
- 用 `mpsc::channel` 把结果同步回调用方

这样避免 tokio worker 线程触发 `dispatch_assert_queue`。

#### (3) 解决布局/IME：用物理键位 `kVK_ANSI_V = 0x09`

- macOS 下改用 `Key::Other(0x09)` 代替 `Key::Unicode('v')`
- 并且对 `Cmd` 释放增加延迟，给目标 App 足够时间观察组合键

#### (4) 剪贴板保护（对齐 Handy）

- 粘贴前读取并保存原剪贴板内容
- 粘贴后延迟一小段时间再恢复
- 若粘贴失败：不恢复，保证转录文本仍在剪贴板里可手动粘贴

---

## 六、用户侧注意事项（非常重要）

### 1) Accessibility 权限要加到“当前运行的二进制”

macOS 的 Accessibility 授权是按应用/二进制生效的：
- 你现在用 `npm run tauri:dev` 运行的是 `src-tauri/target/debug/typefree`
- 如果你只给了打包后的 `Typefree.app` 权限，dev 版仍然会报 “permission required”

建议做法：
1. 打开 `System Settings -> Privacy & Security -> Accessibility`
2. 把当前运行的 `typefree`（debug 二进制）加入并启用
3. 完全退出并重启 Typefree（我们这里的 “重启软件” 就是为了让系统权限生效）

### 2) “自动粘贴失败但文本已在剪贴板”是预期降级

没有权限/系统拒绝合成事件时：
- 自动粘贴会失败
- 但转录文本会保留在剪贴板里
- 用户可以手动 `Cmd+V`

---

## 七、验证清单（改造后应该看到什么）

1. 按热键开始录音时：出现 overlay（Recording）
2. 停止录音后：overlay 状态切换为 Transcribing / Pasting
3. 授权 Accessibility 后：转录完成会自动粘贴到目标 App 的光标位置
4. 未授权时：不会崩溃，且会返回明确报错，同时文本仍在剪贴板

---

## 八、可选的后续优化（建议）

这些不是“修复必要条件”，但能显著提升可用性：

- 前端统一展示 `backend-dictation-error`（toast/弹窗）并提供 “打开 Accessibility 设置” 按钮
- 在错误信息里区分 “dev 二进制” 与 “打包 app”，避免用户授权错对象
- 把 `write_clipboard/read_clipboard` 也统一切到 `tauri_plugin_clipboard_manager`，减少 arboard 与系统剪贴板差异带来的边缘问题
