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
    <div
      className={`flex bg-gray-50 border-b border-gray-200 ${scrollable ? "overflow-x-auto" : ""}`}
    >
      {providers.map((provider) => {
        const isSelected = selectedId === provider.id;

        // Get styles based on color scheme
        const selectedStyles = colors
          ? { borderBottomColor: colors.border, backgroundColor: colors.bg }
          : { borderBottomColor: "rgb(99 102 241)", backgroundColor: "rgb(238 242 255)" };

        const textClass = isSelected ? colors?.text || "text-neutral-900" : "text-gray-600";

        return (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 font-medium transition-all ${scrollable ? "whitespace-nowrap" : ""
              } ${textClass} ${isSelected ? "border-b-2" : "hover:bg-gray-100"}`}
            style={isSelected ? selectedStyles : undefined}
          >
            {renderIcon ? renderIcon(provider.id) : <ProviderIcon provider={provider.id} />}
            <span>{provider.name}</span>
          </button>
        );
      })}
    </div>
  );
}
