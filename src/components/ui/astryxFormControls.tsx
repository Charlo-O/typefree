import React from "react";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { Switch as AstryxSwitch } from "@astryxdesign/core/Switch";
import { TextArea as AstryxTextArea } from "@astryxdesign/core/TextArea";
import { TextInput as AstryxTextInput } from "@astryxdesign/core/TextInput";

export type AstryxCompatButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
};

export function AstryxCompatButton({
  children,
  variant,
  size,
  disabled,
  label: explicitLabel,
  className,
  ...props
}: AstryxCompatButtonProps) {
  const textLabel = React.Children.toArray(children)
    .filter((child): child is string => typeof child === "string")
    .join(" ")
    .trim();
  const iconCandidate = React.Children.toArray(children);
  const icon =
    size === "icon" && iconCandidate.length === 1 && React.isValidElement(iconCandidate[0])
      ? iconCandidate[0]
      : undefined;
  const label = explicitLabel || textLabel || props["aria-label"] || props.title || "Action";

  return (
    <AstryxButton
      {...props}
      label={label}
      variant={
        variant === "destructive"
          ? "destructive"
          : variant === "default"
            ? "primary"
            : variant === "ghost" || variant === "link"
              ? "ghost"
              : "secondary"
      }
      size={size === "lg" ? "lg" : size === "sm" || size === "icon" ? "sm" : "md"}
      isDisabled={disabled}
      isIconOnly={Boolean(icon)}
      icon={icon}
      className={className}
    >
      {children}
    </AstryxButton>
  );
}

export type AstryxCompatInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function AstryxCompatInput({
  label,
  value,
  onChange,
  disabled,
  className,
  size: _size,
  type,
  ...props
}: AstryxCompatInputProps) {
  return (
    <AstryxTextInput
      {...(props as any)}
      label={label || "Input"}
      isLabelHidden={!label}
      value={value == null ? "" : String(value)}
      type={type as "text" | "password" | "email"}
      isDisabled={disabled}
      className={className}
      onChange={(_nextValue, event) => onChange?.(event)}
    />
  );
}

export type AstryxCompatTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
};

export function AstryxCompatTextarea({
  label,
  value,
  onChange,
  disabled,
  className,
  ...props
}: AstryxCompatTextareaProps) {
  return (
    <AstryxTextArea
      {...(props as any)}
      label={label || "Text"}
      isLabelHidden={!label}
      value={value == null ? "" : String(value)}
      isDisabled={disabled}
      className={className}
      onChange={(_nextValue, event) => onChange?.(event)}
    />
  );
}

export interface AstryxCompatToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}

export function AstryxCompatToggle({
  checked = false,
  onChange,
  disabled,
}: AstryxCompatToggleProps) {
  return (
    <AstryxSwitch
      label="Toggle setting"
      isLabelHidden
      value={checked}
      isDisabled={disabled}
      onChange={(nextValue) => onChange?.(nextValue)}
    />
  );
}
