import * as React from "react";
import { TextInput as AstryxTextInput } from "@astryxdesign/core/TextInput";
import { cn } from "../lib/utils";

/** Native-prop compatibility surface backed by Astryx TextInput. */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  (
    {
      className,
      type = "text",
      value,
      defaultValue,
      onChange,
      disabled,
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
      <AstryxTextInput
        {...(props as any)}
        ref={ref}
        label={ariaLabel || "Input"}
        isLabelHidden
        htmlName={name}
        hasAutoFocus={autoFocus}
        value={currentValue}
        type={type as "text" | "password" | "email"}
        isDisabled={disabled}
        className={cn(
          "typefree-input-shell",
          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 py-1 text-[13px] shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
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

Input.displayName = "Input";

export { Input };
