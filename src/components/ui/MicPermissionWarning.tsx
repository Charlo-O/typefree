import { useEffect, useMemo, useState } from "react";
import { Button } from "./button";

interface MicPermissionWarningProps {
  error: string | null;
  onOpenSoundSettings: () => void;
  onOpenPrivacySettings: () => void;
}

type Platform = "darwin" | "win32" | "linux";

const getFallbackPlatform = (): Platform => {
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("linux")) return "linux";
  }
  return "win32";
};

const getPlatform = async (): Promise<Platform> => {
  if (typeof window !== "undefined" && window.electronAPI?.getPlatform) {
    try {
      const p = await window.electronAPI.getPlatform();
      if (p === "darwin" || p === "win32" || p === "linux") return p;
    } catch {
      // Fall through to user agent detection.
    }
  }
  return getFallbackPlatform();
};

const PLATFORM_CONFIG: Record<
  Platform,
  { message: string; soundLabel: string; privacyLabel: string; showPrivacyButton: boolean }
> = {
  darwin: {
    message:
      "If the microphone prompt doesn't appear, open Sound settings to select your input device, then try again.",
    soundLabel: "Open Sound Input",
    privacyLabel: "Open Microphone Privacy",
    showPrivacyButton: true, // macOS has separate privacy settings
  },
  win32: {
    message:
      "If the microphone prompt doesn't appear, open Windows Settings to select your input device, then try again.",
    soundLabel: "Open Sound Settings",
    privacyLabel: "Open Privacy Settings",
    showPrivacyButton: true, // Windows has privacy settings for microphone
  },
  linux: {
    message:
      "If the microphone prompt doesn't appear, open your system sound settings to select your input device, then try again.",
    soundLabel: "Open Sound Settings",
    privacyLabel: "",
    showPrivacyButton: false, // Linux typically doesn't have app-level mic privacy settings
  },
};

export default function MicPermissionWarning({
  error,
  onOpenSoundSettings,
  onOpenPrivacySettings,
}: MicPermissionWarningProps) {
  const [platform, setPlatform] = useState<Platform>(() => getFallbackPlatform());
  const config = useMemo(() => PLATFORM_CONFIG[platform], [platform]);

  useEffect(() => {
    let mounted = true;
    getPlatform().then((nextPlatform) => {
      if (mounted) setPlatform(nextPlatform);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <p className="text-sm text-amber-900">{error || config.message}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onOpenSoundSettings}>
          {config.soundLabel}
        </Button>
        {config.showPrivacyButton && (
          <Button variant="outline" size="sm" onClick={onOpenPrivacySettings}>
            {config.privacyLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
