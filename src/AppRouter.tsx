import React from "react";

type LazyDefaultComponent = { default: React.ComponentType };

const FloatingDictationApp = React.lazy(
  () => import("./features/dictation/ui/FloatingDictationApp") as Promise<LazyDefaultComponent>
);
const ControlPanel = React.lazy(
  () => import("./components/ControlPanel") as Promise<LazyDefaultComponent>
);
const RecordingOverlay = React.lazy(
  () => import("./features/dictation/ui/RecordingOverlay") as Promise<LazyDefaultComponent>
);

function isTauriRuntime(): boolean {
  const tauriWindow = window as Window &
    typeof globalThis & {
      __TAURI_INTERNALS__?: unknown;
      __TAURI__?: unknown;
    };

  return (
    typeof tauriWindow.__TAURI_INTERNALS__ !== "undefined" ||
    typeof tauriWindow.__TAURI__ !== "undefined" ||
    /\bTauri\b/i.test(navigator.userAgent || "")
  );
}

export function AppRouter() {
  const isControlPanel =
    window.location.pathname.includes("control") || window.location.search.includes("panel=true");

  const isRecordingOverlay = window.location.search.includes("overlay=true");
  const isTauri = isTauriRuntime();

  // In Tauri, the recording overlay lives in a dedicated NSPanel window
  // (created from Rust via `tauri-nspanel`) and navigates with `?overlay=true`.
  if (isTauri && isRecordingOverlay) return <RecordingOverlay />;

  if (isControlPanel) return <ControlPanel />;

  // On macOS Tauri, overlay is handled by the backend NSPanel, so the main
  // window renders nothing. On Windows/Linux Tauri, render the floating UI.
  const isMacOS = /Mac|Darwin/i.test(navigator.platform || navigator.userAgent || "");

  if (!isTauri || !isMacOS) return <FloatingDictationApp />;

  return null;
}

export default AppRouter;
