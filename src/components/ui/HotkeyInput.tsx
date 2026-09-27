import React, { useState, useCallback, useRef, useEffect } from "react";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import { useI18n } from "../../i18n";
import { platform } from "../../shared/platform";
import { mapKeyboardEventToHotkey } from "./hotkey-input-utils";

export interface HotkeyInputProps {
  value: string;
  onChange: (hotkey: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  captureMode?: "any" | "single";
}

export function HotkeyInput({
  value,
  onChange,
  onBlur,
  disabled = false,
  autoFocus = false,
  captureMode = "any",
}: HotkeyInputProps) {
  const { t } = useI18n();
  const [isCapturing, setIsCapturing] = useState(false);
  const [activeModifiers, setActiveModifiers] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|Darwin/.test(navigator.platform);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const mods = new Set<string>();
      if (e.ctrlKey || e.metaKey) mods.add(isMac ? "Cmd" : "Ctrl");
      if (e.altKey) mods.add(isMac ? "Option" : "Alt");
      if (e.shiftKey) mods.add("Shift");
      setActiveModifiers(mods);

      const hotkey = mapKeyboardEventToHotkey(e.nativeEvent, captureMode);
      if (hotkey) {
        onChange(hotkey);
        setIsCapturing(false);
        setActiveModifiers(new Set());
        containerRef.current?.blur();
      }
    },
    [captureMode, disabled, onChange, isMac]
  );

  const handleKeyUp = useCallback(() => {
    setActiveModifiers(new Set());
  }, []);

  const handleFocus = useCallback(() => {
    if (!disabled) {
      setIsCapturing(true);
      void platform.hotkeys.setListeningMode(true);
    }
  }, [disabled]);

  const handleBlur = useCallback(() => {
    setIsCapturing(false);
    setActiveModifiers(new Set());
    void platform.hotkeys.setListeningMode(false);
    onBlur?.();
  }, [onBlur]);

  useEffect(() => {
    if (autoFocus && containerRef.current) {
      containerRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      void platform.hotkeys.setListeningMode(false);
    };
  }, []);

  useEffect(() => {
    if (!isCapturing || !isMac) return;

    const cleanup = platform.hotkeys.onGlobeKeyPressed(() => {
      onChange("GLOBE");
      setIsCapturing(false);
      setActiveModifiers(new Set());
      containerRef.current?.blur();
    });

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
        return;
      }
      if (cleanup) {
        void cleanup.then((dispose) => dispose?.());
      }
    };
  }, [isCapturing, isMac, onChange]);

  const displayValue = formatHotkeyLabel(value);
  const isGlobe = value === "GLOBE";

  const hotkeyParts = value?.includes("+") ? displayValue.split("+") : [];

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label={captureMode === "single" ? t("hotkey.singleAria") : t("hotkey.comboAria")}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`
          relative overflow-hidden
          rounded-xl border-2
          transition-all duration-300 ease-out
          cursor-pointer select-none
          focus:outline-none
          ${
            disabled
              ? "bg-gray-50 border-gray-200 cursor-not-allowed opacity-60"
              : isCapturing
                ? "bg-gradient-to-br from-neutral-50 to-gray-100 border-neutral-400 shadow-lg shadow-neutral-100"
                : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-md"
          }
        `}
      >
        {isCapturing && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-neutral-500 via-gray-500 to-neutral-500 animate-pulse" />
        )}

        <div className="px-6 py-5">
          {isCapturing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-gray-600">Recording</span>
              </div>

              {activeModifiers.size > 0 ? (
                captureMode === "single" ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-1.5">
                      {Array.from(activeModifiers).map((mod) => (
                        <kbd
                          key={mod}
                          className="px-2.5 py-1.5 bg-neutral-100 border border-neutral-300 rounded-lg text-sm font-semibold text-neutral-900 shadow-sm"
                        >
                          {mod}
                        </kbd>
                      ))}
                    </div>
                    <p className="text-center text-amber-600 text-sm">
                      Single key only. Do not use Ctrl, Alt, Shift, or Cmd.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5">
                    {Array.from(activeModifiers).map((mod) => (
                      <kbd
                        key={mod}
                        className="px-2.5 py-1.5 bg-neutral-100 border border-neutral-300 rounded-lg text-sm font-semibold text-neutral-900 shadow-sm"
                      >
                        {mod}
                      </kbd>
                    ))}
                    <span className="text-neutral-400 font-medium">+</span>
                    <span className="px-2.5 py-1.5 border-2 border-dashed border-neutral-300 rounded-lg text-sm text-neutral-400">
                      key
                    </span>
                  </div>
                )
              ) : (
                <p className="text-center text-gray-500">
                  {captureMode === "single" ? t("hotkey.pressOne") : t("hotkey.pressAny")}
                </p>
              )}

              {captureMode === "single" ? (
                <p className="text-xs text-center text-gray-400">{t("hotkey.singleHint")}</p>
              ) : (
                <p className="text-xs text-center text-gray-400">
                  {t("hotkey.tryHint", {
                    keys: isMac ? "⌘⇧K 或 ⌥Space" : "Ctrl+Shift+K 或 Alt+Space",
                  })}
                </p>
              )}
            </div>
          ) : value ? (
            <div className="flex flex-col items-center gap-2">
              {hotkeyParts.length > 0 ? (
                <div className="flex items-center justify-center gap-1.5">
                  {hotkeyParts.map((part, i) => (
                    <React.Fragment key={part}>
                      {i > 0 && <span className="text-gray-300 font-medium">+</span>}
                      <kbd className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-base font-semibold text-gray-800 shadow-sm">
                        {part}
                      </kbd>
                    </React.Fragment>
                  ))}
                </div>
              ) : isGlobe ? (
                <div className="flex items-center gap-2">
                  <kbd className="px-4 py-2 bg-gradient-to-b from-gray-50 to-gray-100 border border-gray-200 rounded-xl text-2xl shadow-sm">
                    🌐
                  </kbd>
                  <span className="text-sm font-medium text-gray-600">Globe/Fn</span>
                </div>
              ) : (
                <kbd className="px-5 py-3 bg-gradient-to-b from-gray-50 to-gray-100 border border-gray-200 rounded-xl text-xl font-bold text-gray-800 shadow-sm min-w-[60px] text-center">
                  {displayValue}
                </kbd>
              )}

              <p className="text-xs text-gray-400">{t("hotkey.clickToChange")}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="flex items-center gap-2 text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"
                  />
                </svg>
                <span className="font-medium">{t("hotkey.clickToSet")}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HotkeyInput;
