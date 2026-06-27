import * as React from "react";

export interface ToastProps {
  id?: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "default" | "destructive" | "success";
  duration?: number;
  onClose?: () => void;
}

export interface ToastContextType {
  toast: (props: Omit<ToastProps, "id">) => void;
  dismiss: (id?: string) => void;
}

export const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

export const toast = {
  success: (message: string) => ({
    title: "Success",
    description: message,
    variant: "success" as const,
  }),
  error: (message: string) => ({
    title: "Error",
    description: message,
    variant: "destructive" as const,
  }),
  info: (message: string) => ({
    description: message,
    variant: "default" as const,
  }),
};
