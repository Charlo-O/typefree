import React, { createContext, useContext } from "react";
import { Dialog as CoreDialog } from "@astryxdesign/core/Dialog";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { X } from "lucide-react";

type DialogState = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DialogContext = createContext<DialogState | null>(null);

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

export const DialogTrigger = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const DialogPortal = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const DialogOverlay = () => null;
export const DialogClose = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export const DialogContent = React.forwardRef<
  HTMLDialogElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, _ref) => {
  const state = useContext(DialogContext);
  if (!state) return null;

  return (
    <CoreDialog
      isOpen={state.open}
      onOpenChange={state.onOpenChange}
      purpose="form"
      aria-label="Dialog"
      className={className}
    >
      <div className="relative" {...props}>
        {children}
        <AstryxButton
          label="Close"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<X aria-hidden="true" size={16} />}
          className="absolute right-1 top-1"
          onClick={() => state.onOpenChange(false)}
        />
      </div>
    </CoreDialog>
  );
});
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-col gap-1 ${className ?? ""}`} {...props} />
);
DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-wrap justify-end gap-2 ${className ?? ""}`} {...props} />
);
DialogFooter.displayName = "DialogFooter";

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2 ref={ref} className={`text-lg font-semibold ${className ?? ""}`} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-secondary ${className ?? ""}`} {...props} />
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <AstryxButton
            label={cancelText}
            variant="ghost"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
          />
          <AstryxButton
            label={confirmText}
            variant={variant === "destructive" ? "destructive" : "primary"}
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <AstryxButton
            label={okText}
            variant="primary"
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
