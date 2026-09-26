import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { TextInput as AstryxTextInput } from "@astryxdesign/core/TextInput";
import { Stack } from "@astryxdesign/core/Stack";

interface ApiKeyInputProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  className?: string;
  placeholder?: string;
  label?: string;
  helpText?: React.ReactNode;
  variant?: "default" | "purple";
}

export default function ApiKeyInput({
  apiKey,
  setApiKey,
  className = "",
  placeholder = "sk-...",
  label = "API Key",
  helpText = "Get your API key from platform.openai.com",
  variant = "default",
}: ApiKeyInputProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const inputId = React.useId();

  return (
    <Stack className={className} gap={1}>
      <Stack direction="horizontal" gap={1} vAlign="center">
        <AstryxTextInput
          id={inputId}
          label={label || "API Key"}
          isLabelHidden={!label}
          type={isVisible ? "text" : "password"}
          value={apiKey}
          placeholder={placeholder}
          description={typeof helpText === "string" ? helpText : undefined}
          autoComplete="off"
          width="100%"
          onChange={(nextValue) => setApiKey(nextValue)}
        />
        <AstryxButton
          type="button"
          label={isVisible ? "Hide API Key" : "Show API Key"}
          isIconOnly
          icon={isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          size="sm"
          variant="ghost"
          onClick={() => setIsVisible((value) => !value)}
        />
      </Stack>
      {helpText && typeof helpText !== "string" ? <span>{helpText}</span> : null}
    </Stack>
  );
}
