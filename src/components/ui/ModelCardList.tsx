import type { KeyboardEvent } from "react";
import { Check, Globe, Play } from "lucide-react";
import type { ColorScheme } from "../../utils/modelPickerStyles";

export interface ModelCardOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

interface ModelCardListProps {
  models: ModelCardOption[];
  selectedModel: string;
  onModelSelect: (modelId: string) => void;
  activeModel?: string;
  activationMode?: "immediate" | "confirm";
  onModelActivate?: (modelId: string) => void;
  activateLabel?: string;
  activeLabel?: string;
  selectedLabel?: string;
  colorScheme?: ColorScheme;
  className?: string;
}

const COLOR_CONFIG: Record<
  ColorScheme,
  {
    selected: string;
    active: string;
    default: string;
    badge: string;
    activateButton: string;
  }
> = {
  indigo: {
    selected: "border-neutral-400 bg-neutral-50/80 shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
    active: "border-neutral-400 bg-neutral-50/90 shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    default:
      "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 hover:shadow-sm",
    badge:
      "flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700",
    activateButton:
      "border-neutral-300 bg-neutral-900 text-neutral-50 hover:bg-neutral-800 focus-visible:ring-neutral-900/15",
  },
  purple: {
    selected: "border-neutral-400 bg-neutral-50/80 shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
    active: "border-neutral-400 bg-neutral-50/90 shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    default:
      "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 hover:shadow-sm",
    badge:
      "flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700",
    activateButton:
      "border-neutral-300 bg-neutral-900 text-neutral-50 hover:bg-neutral-800 focus-visible:ring-neutral-900/15",
  },
  blue: {
    selected: "border-neutral-400 bg-neutral-50/80 shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
    active: "border-neutral-400 bg-neutral-50/90 shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    default:
      "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 hover:shadow-sm",
    badge:
      "flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700",
    activateButton:
      "border-neutral-300 bg-neutral-900 text-neutral-50 hover:bg-neutral-800 focus-visible:ring-neutral-900/15",
  },
};

export default function ModelCardList({
  models,
  selectedModel,
  onModelSelect,
  activeModel,
  activationMode = "immediate",
  onModelActivate,
  activateLabel = "启用",
  activeLabel = "已启用",
  selectedLabel = "Selected",
  colorScheme = "indigo",
  className = "",
}: ModelCardListProps) {
  const styles = COLOR_CONFIG[colorScheme];
  const committedModel = activeModel ?? selectedModel;
  const requiresConfirmation = activationMode === "confirm";

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>, modelId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onModelSelect(modelId);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {models.map((model) => {
        const isSelected = selectedModel === model.value;
        const isActive = committedModel === model.value;
        const showActiveButton = requiresConfirmation && isActive;
        const showActivateButton = requiresConfirmation && !isActive;
        const statusLabel = requiresConfirmation ? "" : isSelected ? selectedLabel : "";

        return (
          <div
            key={model.value}
            role="button"
            tabIndex={0}
            onClick={() => onModelSelect(model.value)}
            onKeyDown={(event) => handleCardKeyDown(event, model.value)}
            aria-pressed={requiresConfirmation ? isActive : isSelected}
            className={`group relative w-full overflow-hidden rounded-xl border p-4 text-left outline-none transition-all duration-200 focus-visible:ring-1 focus-visible:ring-neutral-900/10 ${
              isActive ? styles.active : isSelected ? styles.selected : styles.default
            }`}
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-r from-neutral-900/[0.025] to-transparent transition-opacity duration-200 ${
                isSelected || isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            />
            <div className="relative flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {model.icon ? (
                    <img src={model.icon} alt="" className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Globe className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  )}
                  <span className="truncate font-medium text-gray-900">{model.label}</span>
                </div>
                {model.description && (
                  <div className="mt-1 truncate text-xs text-gray-600">{model.description}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {statusLabel && (
                  <span className={styles.badge}>
                    {isActive && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                    {statusLabel}
                  </span>
                )}
                {showActiveButton && (
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-500 opacity-0 ring-1 ring-neutral-900/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {activeLabel}
                  </button>
                )}
                {showActivateButton && (
                  <button
                    type="button"
                    tabIndex={isSelected ? 0 : -1}
                    aria-label={`${activateLabel} ${model.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onModelActivate?.(model.value);
                    }}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium opacity-0 shadow-sm ring-1 ring-neutral-900/10 transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:outline-none focus-visible:ring-1 ${styles.activateButton}`}
                  >
                    <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                    {activateLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
