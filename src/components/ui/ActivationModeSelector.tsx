import { MousePointerClick, MicVocal } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
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
    <Section variant="transparent" padding={0}>
      <HStack gap={2} wrap="wrap">
        <Button
          label={t("settings.tapToTalk")}
          icon={<MousePointerClick aria-hidden="true" />}
          variant={value === "tap" ? "primary" : "secondary"}
          isDisabled={disabled}
          onClick={() => onChange("tap")}
        >
          {t("settings.tapToTalk")} · {t("settings.tapOnOff")}
        </Button>
        <Button
          label={t("settings.pushToTalk")}
          icon={<MicVocal aria-hidden="true" />}
          variant={value === "push" && !pushDisabled ? "primary" : "secondary"}
          isDisabled={pushDisabled}
          onClick={() => {
            if (!pushDisabled) onChange("push");
          }}
        >
          {t("settings.pushToTalk")} · {t("settings.holdToRecord")}
        </Button>
      </HStack>
      <Text type="supporting" justify="center">
        {!allowPushToTalk
          ? t("settings.doublePressOnlyTap")
          : value === "tap"
            ? t("settings.tapModeDesc")
            : t("settings.pushModeDesc")}
      </Text>
    </Section>
  );
}
