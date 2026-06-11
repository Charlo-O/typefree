import { Globe } from "lucide-react";
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
  colorScheme?: ColorScheme;
  className?: string;
}

const COLOR_CONFIG: Record<
  ColorScheme,
  {
    selected: string;
    default: string;
    badge: string;
  }
> = {
  indigo: {
    selected: "border-indigo-500/40 bg-indigo-50/50 ring-1 ring-indigo-500/20 shadow-sm scale-[1.01]",
    default: "border-slate-200/60 bg-white hover:border-slate-300 hover:shadow-sm hover:bg-slate-50/50",
    badge: "text-[11px] text-indigo-700 bg-indigo-100/80 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1",
  },
  purple: {
    selected: "border-purple-500/40 bg-purple-50/50 ring-1 ring-purple-500/20 shadow-sm scale-[1.01]",
    default: "border-slate-200/60 bg-white hover:border-slate-300 hover:shadow-sm hover:bg-slate-50/50",
    badge: "text-[11px] text-purple-700 bg-purple-100/80 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1",
  },
  blue: {
    selected: "border-blue-500/40 bg-blue-50/50 ring-1 ring-blue-500/20 shadow-sm scale-[1.01]",
    default: "border-slate-200/60 bg-white hover:border-slate-300 hover:shadow-sm hover:bg-slate-50/50",
    badge: "text-[11px] text-blue-700 bg-blue-100/80 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1",
  },
};

export default function ModelCardList({
  models,
  selectedModel,
  onModelSelect,
  colorScheme = "indigo",
  className = "",
}: ModelCardListProps) {
  const styles = COLOR_CONFIG[colorScheme];

  return (
    <div className={`space-y-2 ${className}`}>
      {models.map((model) => {
        const isSelected = selectedModel === model.value;

        return (
          <button
            key={model.value}
            onClick={() => onModelSelect(model.value)}
            className={`w-full p-4 rounded-xl border text-left transition-all duration-300 ${
              isSelected ? styles.selected : styles.default
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {model.icon ? (
                    <img src={model.icon} alt="" className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Globe className="w-4 h-4 text-gray-400" aria-hidden="true" />
                  )}
                  <span className="font-medium text-gray-900">{model.label}</span>
                </div>
                {model.description && (
                  <div className="text-xs text-gray-600 mt-1">{model.description}</div>
                )}
              </div>
              {isSelected && <span className={styles.badge}>✓ Selected</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
