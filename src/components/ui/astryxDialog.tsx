import React, { createContext, useContext } from "react";
import { Dialog as CoreDialog } from "@astryxdesign/core/Dialog";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { X } from "lucide-react";

type DialogState = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DialogContext = createContext<DialogState | null>(null);

function getTextContent(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join(" ");
  if (React.isValidElement(node)) {
    return getTextContent((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function findDialogTitle(node: React.ReactNode): string {
  if (Array.isArray(node)) {
    for (const child of node) {
      const title = findDialogTitle(child);
      if (title) return title;
    }
    return "";
  }
  if (!React.isValidElement(node)) return "";
  const type = node.type as {
    displayName?: string;
    render?: { displayName?: string };
  };
  if (type.displayName === "DialogTitle" || type.render?.displayName === "DialogTitle") {
    return getTextContent((node.props as { children?: React.ReactNode }).children)
      .replace(/\s+/g, " ")
      .trim();
  }
  return findDialogTitle((node.props as { children?: React.ReactNode }).children);
}

/**
 * Compound-dialog compatibility surface backed by Astryx's native Dialog.
 * Existing feature dialogs can keep their composition while sharing the
 * accessible, themed modal implementation.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>;
}

export const DialogTrigger = ({ children }: { children: React.ReactNode }) => {
  const state = useContext(DialogContext);
  if (!state || !React.isValidElement(children)) return <>{children}</>;
  return React.cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      (children.props as { onClick?: (event: React.MouseEvent) => void }).onClick?.(event);
      if (!event.defaultPrevented) state.onOpenChange(true);
    },
  } as Partial<typeof children.props>);
};
export const DialogPortal = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const DialogOverlay = () => null;
export const DialogClose = ({ children }: { children: React.ReactNode }) => {
  const state = useContext(DialogContext);
  if (!state || !React.isValidElement(children)) return <>{children}</>;
  return React.cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      (children.props as { onClick?: (event: React.MouseEvent) => void }).onClick?.(event);
      if (!event.defaultPrevented) state.onOpenChange(false);
    },
  } as Partial<typeof children.props>);
};

export const DialogContent = React.forwardRef<
  HTMLDialogElement,
  React.HTMLAttributes<HTMLDivElement>
>(
  (
    { className, children, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...props },
    _ref
  ) => {
    const state = useContext(DialogContext);
    if (!state) return null;
    const titleLabel = findDialogTitle(children);

    return (
      <CoreDialog
        ref={_ref}
        isOpen={state.open}
        onOpenChange={state.onOpenChange}
        purpose="info"
        width="100%"
        maxHeight="90dvh"
        padding={0}
        aria-label={(ariaLabel ?? titleLabel) || "Dialog"}
        aria-labelledby={ariaLabelledBy}
        className={`typefree-dialog z-50 grid w-full max-w-lg gap-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_0_rgba(255,255,255,0.8)_inset] ${className ?? ""}`}
      >
        <div className="relative" {...props}>
          {children}
          <AstryxButton
            label="Close"
            variant="ghost"
            size="sm"
            isIconOnly
            icon={<X aria-hidden="true" size={16} />}
            className="absolute right-4 top-4 h-6 w-6 min-w-0 rounded-lg p-1 opacity-70 hover:bg-neutral-100 hover:opacity-100"
            onClick={() => state.onOpenChange(false)}
          />
        </div>
      </CoreDialog>
    );
  }
);
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col space-y-1.5 text-center sm:text-left ${className ?? ""}`}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 ${className ?? ""}`}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={`text-lg font-semibold leading-none tracking-tight text-neutral-950 brand-heading ${className ?? ""}`}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-neutral-500 brand-body ${className ?? ""}`} {...props} />
));
DialogDescription.displayName = "DialogDescription";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  variant?: "default" | "destructive";
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <AstryxButton
            label={cancelText}
            variant="ghost"
            className="h-10 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-100 brand-body"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
          />
          <AstryxButton
            label={confirmText}
            variant={variant === "destructive" ? "destructive" : "primary"}
            className={`h-10 rounded-lg px-4 py-2 text-sm font-medium brand-body ${
              variant === "destructive"
                ? "bg-[#dc2626] text-white shadow-[0_2px_8px_rgba(220,38,38,0.3)] hover:bg-[#b91c1c]"
                : "bg-neutral-950 text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800"
            }`}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  okText = "OK",
  onOk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  okText?: string;
  onOk: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <AstryxButton
            label={okText}
            variant="primary"
            className="h-10 rounded-lg bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 brand-body"
            onClick={() => {
              onOk();
              onOpenChange(false);
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
