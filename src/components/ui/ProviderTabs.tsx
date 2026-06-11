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
  labelMode?: "always" | "hover";
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
  labelMode = "always",
  scrollable = false,
}: ProviderTabsProps) {
  const colors = colorScheme !== "dynamic" ? COLOR_CONFIG[colorScheme] : null;
  const showsHoverLabels = labelMode === "hover";

  return (
    <div
      className={`p-1.5 bg-neutral-100/80 rounded-xl border border-neutral-200/70 mb-2 ${
        showsHoverLabels ? "overflow-visible" : scrollable ? "overflow-x-auto" : ""
      }`}
    >
      <div
        className={
          showsHoverLabels
            ? "flex w-full items-center justify-between gap-2"
            : "flex gap-1 min-w-max"
        }
      >
        {providers.map((provider) => {
          const isSelected = selectedId === provider.id;

          return (
            <button
              key={provider.id}
              onClick={() => onSelect(provider.id)}
              aria-label={provider.name}
              className={`flex items-center justify-center rounded-lg border text-sm duration-150 ease-out ${
                showsHoverLabels
                  ? "group/provider-tab relative h-10 min-w-0 flex-1 px-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
                  : "shrink-0 min-w-[112px] gap-2 px-4 py-2.5 transition-all"
              } ${
                isSelected
                  ? "border-neutral-200/80 bg-white text-neutral-950 shadow-sm font-medium"
                  : "border-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/60 font-normal"
              }`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center"
              >
                {renderIcon ? (
                  renderIcon(provider.id)
                ) : (
                  <ProviderIcon provider={provider.id} className="h-5 w-5 shrink-0" />
                )}
              </span>
              <span
                aria-hidden={showsHoverLabels ? "true" : undefined}
                className={
                  showsHoverLabels
                    ? "pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 shadow-sm group-hover/provider-tab:block group-focus-visible/provider-tab:block"
                    : "whitespace-nowrap tracking-tight"
                }
              >
                {provider.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
