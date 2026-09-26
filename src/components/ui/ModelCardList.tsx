import type { KeyboardEvent } from "react";
import { Check, Globe, Play } from "lucide-react";
import { Card } from "@astryxdesign/core/Card";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
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
  activeModel?: string;
  activationMode?: "immediate" | "confirm";
  onModelActivate?: (modelId: string) => void;
  activateLabel?: string;
  activeLabel?: string;
  selectedLabel?: string;
  colorScheme?: ColorScheme;
  className?: string;
}

export default function ModelCardList({
  models,
  selectedModel,
  onModelSelect,
  activeModel,
  activationMode = "immediate",
  onModelActivate,
  activateLabel = "启用",
  activeLabel = "已启用",
  selectedLabel = "Selected",
  colorScheme = "indigo",
  className = "",
}: ModelCardListProps) {
  const committedModel = activeModel ?? selectedModel;
  const requiresConfirmation = activationMode === "confirm";

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, modelId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onModelSelect(modelId);
  };

  return (
    <Stack gap={2} className={className}>
      {models.map((model) => {
        const isSelected = selectedModel === model.value;
        const isActive = committedModel === model.value;
        const showActiveButton = requiresConfirmation && isActive;
        const showActivateButton = requiresConfirmation && !isActive;
        const statusLabel = requiresConfirmation ? "" : isSelected ? selectedLabel : "";

        return (
          <Card
            key={model.value}
            role="button"
            tabIndex={0}
            onClick={() => onModelSelect(model.value)}
            onKeyDown={(event) => handleCardKeyDown(event, model.value)}
            aria-pressed={requiresConfirmation ? isActive : isSelected}
            padding={3}
            variant={isActive || isSelected ? "muted" : "default"}
            elevation={isActive || isSelected ? "low" : "none"}
          >
            <Stack direction="horizontal" vAlign="center" justify="between" gap={3}>
              <Stack direction="horizontal" vAlign="center" gap={2} minHeight={0}>
                {model.icon ? (
                  <img src={model.icon} alt="" className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Globe className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                )}
                <Stack gap={0.5} minHeight={0}>
                  <Text weight="medium">{model.label}</Text>
                  {model.description && <Text type="supporting">{model.description}</Text>}
                </Stack>
              </Stack>
              <Stack direction="horizontal" vAlign="center" gap={2}>
                {statusLabel && (
                  <Text type="supporting">
                    {isActive && <Check aria-hidden="true" />} {statusLabel}
                  </Text>
                )}
                {showActiveButton && (
                  <AstryxButton
                    type="button"
                    isDisabled
                    label={activeLabel}
                    size="sm"
                    variant="secondary"
                  >
                    <Check aria-hidden="true" />
                    {activeLabel}
                  </AstryxButton>
                )}
                {showActivateButton && (
                  <AstryxButton
                    type="button"
                    tabIndex={isSelected ? 0 : -1}
                    label={`${activateLabel} ${model.label}`}
                    size="sm"
                    variant="primary"
                    aria-label={`${activateLabel} ${model.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onModelActivate?.(model.value);
                    }}
                  >
                    <Play aria-hidden="true" />
                    {activateLabel}
                  </AstryxButton>
                )}
              </Stack>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
