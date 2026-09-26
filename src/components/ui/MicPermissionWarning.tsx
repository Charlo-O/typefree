import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { useI18n } from "../../i18n";
import { platform as platformBridge } from "../../shared/platform";

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
  try {
    const p = await platformBridge.runtime.getPlatform();
    if (p === "darwin" || p === "win32" || p === "linux") return p;
  } catch {
    // Fall through to user agent detection.
  }
  return getFallbackPlatform();
};

const PLATFORM_CONFIG: Record<
  Platform,
  { messageKey: string; soundLabelKey: string; privacyLabelKey: string; showPrivacyButton: boolean }
> = {
  darwin: {
    messageKey: "micPermission.darwin.message",
    soundLabelKey: "micPermission.darwin.sound",
    privacyLabelKey: "micPermission.darwin.privacy",
    showPrivacyButton: true, // macOS has separate privacy settings
  },
  win32: {
    messageKey: "micPermission.win32.message",
    soundLabelKey: "micPermission.soundSettings",
    privacyLabelKey: "micPermission.privacySettings",
    showPrivacyButton: true, // Windows has privacy settings for microphone
  },
  linux: {
    messageKey: "micPermission.linux.message",
    soundLabelKey: "micPermission.soundSettings",
    privacyLabelKey: "",
    showPrivacyButton: false, // Linux typically doesn't have app-level mic privacy settings
  },
};

export default function MicPermissionWarning({
  error,
  onOpenSoundSettings,
  onOpenPrivacySettings,
}: MicPermissionWarningProps) {
  const { t } = useI18n();
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
    <Section variant="muted" padding={3}>
      <Text type="supporting">{error || t(config.messageKey)}</Text>
      <HStack gap={2} wrap="wrap">
        <Button
          label={t(config.soundLabelKey)}
          variant="secondary"
          size="sm"
          onClick={onOpenSoundSettings}
        >
          {t(config.soundLabelKey)}
        </Button>
        {config.showPrivacyButton && (
          <Button
            label={t(config.privacyLabelKey)}
            variant="secondary"
            size="sm"
            onClick={onOpenPrivacySettings}
          >
            {t(config.privacyLabelKey)}
          </Button>
        )}
      </HStack>
    </Section>
  );
}
