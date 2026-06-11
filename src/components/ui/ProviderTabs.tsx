import { ReactNode } from "react";
import { ProviderIcon } from "./ProviderIcon";
import type { ColorScheme as BaseColorScheme } from "../../utils/modelPickerStyles";

export interface ProviderTabItem {
  id: string;
  name: string;
}

type ColorScheme = Exclude<BaseColorScheme, "blue"> | "dynamic";

interface ProviderTabsProps {
  providers: ProviderTabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderIcon?: (providerId: string) => ReactNode;
  colorScheme?: ColorScheme;
  /** Allow horizontal scrolling for many providers */
  scrollable?: boolean;
}

const COLOR_CONFIG: Record<
  Exclude<ColorScheme, "dynamic">,
  { text: string; border: string; bg: string }
> = {
  indigo: {
    text: "text-neutral-900",
    border: "rgb(23 23 23)",
    bg: "rgb(250 250 250)",
  },
  purple: {
    text: "text-neutral-900",
    border: "rgb(23 23 23)",
    bg: "rgb(250 250 250)",
  },
};

export function ProviderTabs({
  providers,
  selectedId,
  onSelect,
  renderIcon,
  colorScheme = "indigo",
  scrollable = false,
}: ProviderTabsProps) {
  const colors = colorScheme !== "dynamic" ? COLOR_CONFIG[colorScheme] : null;

  return (
    <div className={`p-1.5 bg-slate-100/80 rounded-xl border border-slate-200/50 mb-2 ${scrollable ? "overflow-x-auto" : ""}`}>
      <div className="flex gap-1 min-w-max">
        {providers.map((provider) => {
          const isSelected = selectedId === provider.id;
          
          return (
            <button
              key={provider.id}
              onClick={() => onSelect(provider.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all duration-300 ${
                isSelected 
                  ? "bg-white text-indigo-600 shadow-sm ring-1 ring-slate-900/5 font-medium scale-[1.02]" 
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 font-normal"
              }`}
            >
              <div className={`transition-transform duration-300 ${isSelected ? "scale-110" : ""}`}>
                {renderIcon ? renderIcon(provider.id) : <ProviderIcon provider={provider.id} />}
              </div>
              <span className="tracking-tight">{provider.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
