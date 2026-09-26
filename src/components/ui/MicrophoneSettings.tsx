import React, { useState, useEffect, useCallback, useRef } from "react";
import { AstryxCompatButton as Button, AstryxCompatToggle as Toggle } from "./astryxFormControls";
import { Selector } from "@astryxdesign/core/Selector";
import { Section } from "@astryxdesign/core/Section";
import { RefreshCw, Mic } from "lucide-react";
import { isBuiltInMicrophone } from "../../utils/audioDeviceUtils";
import { useI18n } from "../../i18n";

interface AudioDevice {
  deviceId: string;
  label: string;
  isBuiltIn: boolean;
}

interface MicrophoneSettingsProps {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  onPreferBuiltInChange: (value: boolean) => void;
  onDeviceSelect: (deviceId: string) => void;
}

export const MicrophoneSettings: React.FC<MicrophoneSettingsProps> = ({
  preferBuiltInMic,
  selectedMicDeviceId,
  onPreferBuiltInChange,
  onDeviceSelect,
}) => {
  const { t } = useI18n();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use refs to access current values without triggering re-renders
  const preferBuiltInRef = useRef(preferBuiltInMic);
  const selectedDeviceRef = useRef(selectedMicDeviceId);
  const onDeviceSelectRef = useRef(onDeviceSelect);

  // Keep refs in sync
  useEffect(() => {
    preferBuiltInRef.current = preferBuiltInMic;
    selectedDeviceRef.current = selectedMicDeviceId;
    onDeviceSelectRef.current = onDeviceSelect;
  }, [preferBuiltInMic, selectedMicDeviceId, onDeviceSelect]);

  const loadDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Check if mediaDevices API is available (may not be in Tauri WebView)
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError(t("settings.microphone.apiUnavailable"));
      setIsLoading(false);
      return;
    }

    try {
      // Request permission first to get device labels
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || t("settings.microphone.deviceFallback", { id: d.deviceId.slice(0, 8) }),
          isBuiltIn: isBuiltInMicrophone(d.label),
        }));

      setDevices(audioInputs);

      // If no device is selected and not preferring built-in, select the first device
      if (!preferBuiltInRef.current && !selectedDeviceRef.current && audioInputs.length > 0) {
        onDeviceSelectRef.current(audioInputs[0].deviceId);
      }
    } catch {
      setError(t("settings.microphone.accessError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadDevices();

    const handleDeviceChange = () => loadDevices();

    // Check if mediaDevices API is available (may not be in Tauri WebView)
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    }

    return () => {
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      }
    };
  }, [loadDevices]);

  const builtInDevice = devices.find((d) => d.isBuiltIn);
  const selectedDevice = devices.find((d) => d.deviceId === selectedMicDeviceId);

  return (
    <Section variant="transparent" padding={0}>
      <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
        <div className="flex-1">
          <p className="text-sm font-medium text-neutral-800">
            {t("settings.microphone.preferBuiltIn")}
          </p>
          <p className="text-xs text-neutral-600 mt-1">
            {t("settings.microphone.preferBuiltInDesc")}
          </p>
        </div>
        <Toggle checked={preferBuiltInMic} onChange={onPreferBuiltInChange} />
      </div>

      {preferBuiltInMic && builtInDevice && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-800">
              {t("settings.microphone.using")}
              <span className="font-medium">{builtInDevice.label}</span>
            </span>
          </div>
        </div>
      )}

      {preferBuiltInMic && !builtInDevice && devices.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">{t("settings.microphone.noBuiltIn")}</p>
        </div>
      )}

      {!preferBuiltInMic && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">
              {t("settings.microphone.inputDevice")}
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadDevices}
              disabled={isLoading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <Selector
              label={t("settings.microphone.inputDevice")}
              value={selectedMicDeviceId || "default"}
              placeholder={t("settings.microphone.selectPlaceholder")}
              onChange={(value) => onDeviceSelect(value === "default" ? "" : value)}
              options={[
                { value: "default", label: t("settings.microphone.systemDefault") },
                ...devices.map((device) => ({
                  value: device.deviceId,
                  label: device.isBuiltIn
                    ? `${device.label} · ${t("settings.microphone.builtInLabel")}`
                    : device.label,
                })),
              ]}
            />
          )}

          <p className="text-xs text-neutral-500">{t("settings.microphone.selectDesc")}</p>
        </div>
      )}
    </Section>
  );
};

export default MicrophoneSettings;
