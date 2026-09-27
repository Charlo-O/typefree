import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { Button as AstryxButton } from "@astryxdesign/core/Button";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button-variants";

function getTextLabel(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextLabel).join(" ");
  if (React.isValidElement(node)) {
    return getTextLabel((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  // Keep the shadcn-facing API intact while delegating the actual button
  // rendering to Astryx.  The old utility classes are intentionally retained
  // so callers keep their existing dimensions, colors and focus treatment.
  const childrenArray = React.Children.toArray(props.children);
  const textLabel = getTextLabel(props.children).replace(/\s+/g, " ").trim();
  const icon =
    size === "icon" && childrenArray.length === 1 && React.isValidElement(childrenArray[0])
      ? childrenArray[0]
      : undefined;
  const label = textLabel || props["aria-label"] || props.title || "Action";

  if (!asChild) {
    const { children, ...buttonProps } = props;
    return (
      <AstryxButton
        {...(buttonProps as React.ComponentProps<typeof AstryxButton>)}
        data-slot="button"
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
        isDisabled={Boolean(buttonProps.disabled)}
        isIconOnly={Boolean(icon)}
        icon={icon}
        className={buttonVariants({ variant, size, className })}
      >
        {children}
      </AstryxButton>
    );
  }

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
