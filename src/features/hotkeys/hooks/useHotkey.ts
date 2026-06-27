import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { platform } from "../../../shared/platform";

// Global flag to prevent duplicate registration across windows.
let hotkeyRegistered = false;

export type UseHotkeyResult = {
  hotkey: string;
  setHotkey: Dispatch<SetStateAction<string>>;
};

const isPanelWindow = (): boolean => {
  if (typeof window === "undefined") return false;

  try {
    return new URLSearchParams(window.location.search).get("panel") === "true";
  } catch {
    return false;
  }
};

export const useHotkey = (): UseHotkeyResult => {
  const [hotkey, setHotkey] = useState("`");
  const hasRegistered = useRef(false);

  useEffect(() => {
    const savedHotkey = localStorage.getItem("dictationKey");
    const hotkeyToUse = savedHotkey || "F1";

    setHotkey(hotkeyToUse);

    if (!savedHotkey) {
      localStorage.setItem("dictationKey", hotkeyToUse);
    }

    // Register once per webview. In Tauri, the backend manages the global shortcut.
    // Skip registration when running the Vite dev server in a normal browser.
    if (
      platform.runtime.isTauri() &&
      !isPanelWindow() &&
      !hotkeyRegistered &&
      !hasRegistered.current
    ) {
      hasRegistered.current = true;
      hotkeyRegistered = true;

      const registerWithDelay = () => {
        setTimeout(() => {
          console.log("Attempting to register hotkey:", hotkeyToUse);
          platform.hotkeys
            .updateDictation(hotkeyToUse)
            .then(async (result) => {
              if (result?.success) {
                console.log("Hotkey registered successfully:", hotkeyToUse);
                return;
              }

              console.warn("Failed to register hotkey:", hotkeyToUse, result);
              if (hotkeyToUse !== "F1") {
                const fallback = await platform.hotkeys.updateDictation("F1");
                if (fallback?.success) {
                  localStorage.setItem("dictationKey", "F1");
                  setHotkey("F1");
                  hotkeyRegistered = true;
                  console.warn("Hotkey fallback applied: original key unavailable, switched to F1");
                  return;
                }
              }
              hotkeyRegistered = false;
            })
            .catch((err: unknown) => {
              console.error("Error registering hotkey:", err);
              hotkeyRegistered = false;
            });
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
