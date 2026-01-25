import { useState, useEffect, useRef } from "react";

// Global flag to prevent duplicate registration across windows
let hotkeyRegistered = false;

export const useHotkey = () => {
  const [hotkey, setHotkey] = useState("`");
  const hasRegistered = useRef(false);

  const isTauriRuntime = (() => {
    if (typeof window === "undefined") return false;
    if (typeof window.__TAURI_INTERNALS__ !== "undefined") return true;
    if (typeof window.__TAURI__ !== "undefined") return true;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    return /\bTauri\b/i.test(ua);
  })();

  useEffect(() => {
    // Load hotkey from localStorage on mount
    const savedHotkey = localStorage.getItem("dictationKey");
    const hotkeyToUse = savedHotkey || "F1";

    setHotkey(hotkeyToUse);

    // Save default if not present
    if (!savedHotkey) {
      localStorage.setItem("dictationKey", hotkeyToUse);
    }

    // Register once per webview. In Tauri, the backend manages the global shortcut.
    // We skip registration when running the Vite dev server in a normal browser.
    if (isTauriRuntime && !hotkeyRegistered && !hasRegistered.current) {
      hasRegistered.current = true;
      hotkeyRegistered = true;

      // Add a small delay to ensure electronAPI is fully loaded
      const registerWithDelay = () => {
        setTimeout(() => {
          if (window.electronAPI?.updateHotkey) {
            console.log("Attempting to register hotkey:", hotkeyToUse);
            window.electronAPI
              .updateHotkey(hotkeyToUse)
              .then((result) => {
                if (result?.success) {
                  console.log("✅ Hotkey registered successfully:", hotkeyToUse);
                } else {
                  console.warn("❌ Failed to register hotkey:", hotkeyToUse, result);
                  hotkeyRegistered = false; // Allow retry
                }
              })
              .catch((err) => {
                console.error("❌ Error registering hotkey:", err);
                hotkeyRegistered = false; // Allow retry
              });
          } else {
            console.warn("electronAPI.updateHotkey not available, retrying in 500ms...");
            hotkeyRegistered = false;
            hasRegistered.current = false;
            setTimeout(registerWithDelay, 500);
          }
        }, 100);
      };

      registerWithDelay();
    }
  }, []);

  return {
    hotkey,
    setHotkey,
  };
};
