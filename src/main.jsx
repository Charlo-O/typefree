import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
// Import tauriAPI first to ensure window.electronAPI is set up
import "./utils/tauriAPI";
import "./types/electron";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { I18nProvider } from "./i18n";
import "./index.css";

const App = React.lazy(() => import("./App.jsx"));
const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
const RecordingOverlay = React.lazy(() => import("./components/RecordingOverlay.jsx"));

function AppRouter() {
  // Check if this is the control panel window
  const isControlPanel =
    window.location.pathname.includes("control") || window.location.search.includes("panel=true");

  const isRecordingOverlay = window.location.search.includes("overlay=true");

  const isTauri =
    typeof window !== "undefined" &&
    (typeof window.__TAURI_INTERNALS__ !== "undefined" ||
      typeof window.__TAURI__ !== "undefined" ||
      /\bTauri\b/i.test(navigator.userAgent || ""));

  // In Tauri, the recording overlay lives in a dedicated NSPanel window
  // (created from Rust via `tauri-nspanel`) and navigates with `?overlay=true`.
  if (isTauri && isRecordingOverlay) return <RecordingOverlay />;

  // Control panel
  if (isControlPanel) return <ControlPanel />;

  // Detect macOS — on macOS Tauri, overlay is handled by the backend NSPanel,
  // so the main window renders nothing. On Windows/Linux Tauri, we render
  // the App component (floating mic button) since native overlay isn't available.
  const isMacOS = /Mac|Darwin/i.test(navigator.platform || navigator.userAgent || "");

  // Electron or non-macOS Tauri: main dictation panel UI
  if (!isTauri || !isMacOS) return <App />;

  // macOS Tauri: no main renderer UI (control + overlay windows only)
  return null;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <Suspense fallback={null}>
          <AppRouter />
        </Suspense>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);
