import { MousePointerClick, MicVocal } from "lucide-react";
import { useI18n } from "../../i18n";

type ActivationMode = "tap" | "push";

interface ActivationModeSelectorProps {
  value: ActivationMode;
  onChange: (mode: ActivationMode) => void;
  disabled?: boolean;
  allowPushToTalk?: boolean;
}

export function ActivationModeSelector({
  value,
  onChange,
  disabled = false,
  allowPushToTalk = true,
}: ActivationModeSelectorProps) {
  const { t } = useI18n();
  const pushDisabled = disabled || !allowPushToTalk;

  return (
    <div className="space-y-3">
      <div
        className={`
          relative flex rounded-xl border-2 p-1 transition-all duration-200
          ${disabled ? "bg-gray-50 border-gray-200 opacity-60" : "bg-gray-100/50 border-gray-200"}
        `}
      >
        <div
          className={`
            absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm
            transition-transform duration-200 ease-out
            ${value === "push" && allowPushToTalk ? "translate-x-[calc(100%+8px)]" : "translate-x-0"}
          `}
        />

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("tap")}
          className={`
            relative z-10 flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-lg
            transition-colors duration-200
            ${disabled ? "cursor-not-allowed" : "cursor-pointer"}
            ${value === "tap" ? "text-gray-900" : "text-gray-500 hover:text-gray-700"}
          `}
        >
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-5 h-5" />
            <span className="font-medium text-sm">{t("settings.tapToTalk")}</span>
          </div>
          <span className="text-xs text-gray-400">{t("settings.tapOnOff")}</span>
        </button>

        <button
          type="button"
          disabled={pushDisabled}
          onClick={() => {
            if (!pushDisabled) {
              onChange("push");
            }
          }}
          className={`
            relative z-10 flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-lg
            transition-colors duration-200
            ${pushDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
            ${
              value === "push" && !pushDisabled
                ? "text-gray-900"
                : pushDisabled
                  ? "text-gray-500"
                  : "text-gray-500 hover:text-gray-700"
            }
          `}
        >
          <div className="flex items-center gap-2">
            <MicVocal className="w-5 h-5" />
            <span className="font-medium text-sm">{t("settings.pushToTalk")}</span>
          </div>
          <span className="text-xs text-gray-400">{t("settings.holdToRecord")}</span>
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center">
        {!allowPushToTalk
          ? t("settings.doublePressOnlyTap")
          : value === "tap"
            ? t("settings.tapModeDesc")
            : t("settings.pushModeDesc")}
      </p>
    </div>
  );
}
