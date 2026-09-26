import React from "react";
import { Card as CoreCard } from "@astryxdesign/core/Card";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "muted" | "transparent";
  elevation?: "none" | "low" | "med" | "high";
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, elevation, children, ...props }, ref) => (
    <CoreCard ref={ref} variant={variant} elevation={elevation} className={className} {...props}>
      {children}
    </CoreCard>
  )
);
Card.displayName = "AstryxCard";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={`flex flex-col gap-1 p-4 ${className ?? ""}`} {...props} />
  )
);
CardHeader.displayName = "AstryxCardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={`text-base font-semibold ${className ?? ""}`} {...props} />
));
CardTitle.displayName = "AstryxCardTitle";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={`p-4 pt-0 ${className ?? ""}`} {...props} />
  )
);
CardContent.displayName = "AstryxCardContent";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-secondary ${className ?? ""}`} {...props} />
));
CardDescription.displayName = "AstryxCardDescription";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={`flex items-center gap-2 p-4 pt-0 ${className ?? ""}`} {...props} />
  )
);
CardFooter.displayName = "AstryxCardFooter";
