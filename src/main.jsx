import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
// Import tauriAPI first to ensure window.electronAPI is set up
import "./utils/tauriAPI";
import "./types/electron";
import App from "./App.jsx";
import ControlPanel from "./components/ControlPanel.tsx";
import RecordingOverlay from "./components/RecordingOverlay.jsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { I18nProvider } from "./i18n";
import "./index.css";

function AppRouter() {
  // Check if this is the control panel window
  const isControlPanel =
    window.location.pathname.includes("control") || window.location.search.includes("panel=true");

  const isTauri =
    typeof window !== "undefined" &&
    (typeof window.__TAURI_INTERNALS__ !== "undefined" ||
      typeof window.__TAURI__ !== "undefined" ||
      /\bTauri\b/i.test(navigator.userAgent || ""));

  // In Tauri, the `main` window is the recording overlay window (Handy-style).
  // In Electron, keep rendering the original floating dictation panel UI.
  if (!isControlPanel) {
    return isTauri ? <RecordingOverlay /> : <App />;
  }

  // Control panel
  return <ControlPanel />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);
