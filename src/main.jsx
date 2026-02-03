import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
// Import tauriAPI first to ensure window.electronAPI is set up
import "./utils/tauriAPI";
import "./types/electron";
import App from "./App.jsx";
import ControlPanel from "./components/ControlPanel.tsx";
import OnboardingFlow from "./components/OnboardingFlow.tsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { I18nProvider } from "./i18n";
import { useI18n } from "./i18n";
import "./index.css";

function AppRouter() {
  // Check if this is the control panel window
  const isControlPanel =
    window.location.pathname.includes("control") || window.location.search.includes("panel=true");

  // For main/dictation window, render the App component
  if (!isControlPanel) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "transparent",
        }}
      >
        <App />
      </div>
    );
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
