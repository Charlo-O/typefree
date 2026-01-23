import type { UILanguage } from "./types";

const EN: Record<string, string> = {
  "app.loading": "Loading OpenWhispr...",
  "app.hideForNow": "Hide this for now",
  "app.startListening": "Start listening",
  "app.stopListening": "Stop listening",
  "app.processing": "Processing...",
  "app.recording": "Recording...",
  "app.pressHotkeyToSpeak": "Press [{hotkey}] to speak",
  "app.cancelRecording": "Cancel recording",

  "settings.uiLanguage.label": "App Language",
  "settings.uiLanguage.help": "Changes the UI language (restart may be required).",
};

const ZH_CN: Record<string, string> = {
  "app.loading": "正在加载 OpenWhispr...",
  "app.hideForNow": "暂时隐藏",
  "app.startListening": "开始听写",
  "app.stopListening": "停止听写",
  "app.processing": "处理中...",
  "app.recording": "录音中...",
  "app.pressHotkeyToSpeak": "按下 [{hotkey}] 开始说话",
  "app.cancelRecording": "取消录音",

  "settings.uiLanguage.label": "界面语言",
  "settings.uiLanguage.help": "更改软件界面语言（可能需要重启生效）。",
};

export const TRANSLATIONS: Record<UILanguage, Record<string, string>> = {
  en: EN,
  "zh-CN": ZH_CN,
};
