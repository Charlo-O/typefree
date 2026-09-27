import * as React from "react";
import { TextArea as AstryxTextArea } from "@astryxdesign/core/TextArea";
import { cn } from "../lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      value,
      defaultValue,
      onChange,
      disabled,
      rows,
      name,
      autoFocus,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(
      defaultValue == null ? "" : String(defaultValue)
    );
    const currentValue = isControlled ? String(value ?? "") : internalValue;

    return (
      <AstryxTextArea
        {...(props as any)}
        ref={ref}
        label={ariaLabel || "Text"}
        isLabelHidden
        htmlName={name}
        hasAutoFocus={autoFocus}
        value={currentValue}
        rows={rows ?? 2}
        isDisabled={disabled}
        className={cn(
          "typefree-textarea-shell",
          "flex min-h-[80px] w-full rounded-lg border px-3 py-2 text-sm transition-all duration-200 ease-in-out outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-y cursor-text",
          className
        )}
        onChange={(nextValue, event) => {
          if (!isControlled) {
            setInternalValue(nextValue);
          }
          onChange?.(event);
        }}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
