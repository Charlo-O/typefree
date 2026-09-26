import React, { useState, useCallback, useRef, useEffect } from "react";
import { Section } from "@astryxdesign/core/Section";
import { TextInput as AstryxTextInput } from "@astryxdesign/core/TextInput";
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
  const containerRef = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|Darwin/.test(navigator.platform);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
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

  const captureDescription = isCapturing
    ? activeModifiers.size > 0
      ? `${Array.from(activeModifiers).join(" + ")} + key`
      : captureMode === "single"
        ? t("hotkey.pressOne")
        : t("hotkey.pressAny")
    : value
      ? t("hotkey.clickToChange")
      : t("hotkey.clickToSet");

  // TextInput keeps the field accessible and themed while the key handlers
  // below preserve the existing hotkey-capture contract.
  const HotkeyField = AstryxTextInput as React.ComponentType<any>;
  return (
    <Section variant={isCapturing ? "muted" : "transparent"} padding={3}>
      <HotkeyField
        ref={containerRef}
        label={captureMode === "single" ? t("hotkey.singleAria") : t("hotkey.comboAria")}
        value={displayValue}
        isReadOnly
        isDisabled={disabled}
        description={captureDescription}
        status={
          isCapturing
            ? {
                type: "warning",
                message: t("hotkey.tryHint", {
                  keys: isMac ? "⌘⇧K 或 ⌥Space" : "Ctrl+Shift+K 或 Alt+Space",
                }),
              }
            : undefined
        }
        onChange={() => undefined}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </Section>
  );
}

export default HotkeyInput;
