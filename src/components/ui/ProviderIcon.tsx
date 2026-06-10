import { Brain, Wrench, HardDrive } from "lucide-react";
import { getProviderIcon } from "@/utils/providerIcons";

interface ProviderIconProps {
  provider: string;
  className?: string;
}

const PROVIDER_ICON_LABELS: Record<string, string> = {
  volcengine: "doubao",
  doubao: "doubao",
};

export function ProviderIcon({ provider, className = "w-5 h-5" }: ProviderIconProps) {
  if (provider === "custom") {
    return <Wrench className={className} />;
  }

  if (provider === "local") {
    return <HardDrive className={className} />;
  }

  const iconUrl = getProviderIcon(provider);

  if (!iconUrl) {
    return <Brain className={className} />;
  }

  const iconLabel = PROVIDER_ICON_LABELS[provider] || provider;

  return <img src={iconUrl} alt={`${iconLabel} icon`} className={className} />;
}
