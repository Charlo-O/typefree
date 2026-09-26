import { ReactNode } from "react";
import { TabList } from "@astryxdesign/core/TabList";
import { Tab } from "@astryxdesign/core/TabList";
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

export function ProviderTabs({
  providers,
  selectedId,
  onSelect,
  renderIcon,
  colorScheme = "indigo",
  labelMode = "always",
  scrollable = false,
}: ProviderTabsProps) {
  const showsHoverLabels = labelMode === "hover";

  return (
    <TabList
      value={selectedId}
      onChange={onSelect}
      role="tablist"
      layout={showsHoverLabels ? "fill" : "hug"}
      overflow={scrollable ? "scroll" : "visible"}
      hasDivider={false}
      aria-label="Providers"
    >
      {providers.map((provider) => (
        <Tab
          key={provider.id}
          value={provider.id}
          label={provider.name}
          isLabelHidden={showsHoverLabels}
          icon={
            renderIcon ? (
              renderIcon(provider.id)
            ) : (
              <ProviderIcon provider={provider.id} className="h-5 w-5 shrink-0" />
            )
          }
        />
      ))}
    </TabList>
  );
}
