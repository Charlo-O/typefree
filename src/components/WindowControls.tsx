import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Minus, Square, X, Copy } from "lucide-react";
import { useI18n } from "../i18n";

/**
 * Window control buttons for Linux and Windows platforms
 * Provides minimize, maximize/restore, and close functionality
 * macOS uses native window controls so this component is not rendered there
 */
export default function WindowControls() {
  const { t } = useI18n();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Sync maximized state with main process
    const syncIsMaximized = async () => {
      try {
        const maximized = await window.electronAPI?.windowIsMaximized?.();
        if (mounted) {
          setIsMaximized(!!maximized);
        }
      } catch {
        // Silently handle if API not available
      }
    };

    // Initial sync
    syncIsMaximized();

    // Poll for changes (window can be maximized via double-click on title bar, etc.)
    const intervalId = setInterval(syncIsMaximized, 1000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await window.electronAPI?.windowMinimize?.();
    } catch {
      // Silently handle if API not available
    }
  };

  const handleMaximize = async () => {
    try {
      await window.electronAPI?.windowMaximize?.();
      // Update state after toggle
      const maximized = await window.electronAPI?.windowIsMaximized?.();
      setIsMaximized(!!maximized);
    } catch {
      // Silently handle if API not available
    }
  };

  const handleClose = async () => {
    try {
      await window.electronAPI?.windowClose?.();
    } catch {
      // Silently handle if API not available
    }
  };

  return (
    <div className="flex items-center gap-1 pointer-events-auto">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMinimize}
        title={t("window.minimize")}
        className="h-8 w-8"
      >
        <Minus size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMaximize}
        title={isMaximized ? t("window.restore") : t("window.maximize")}
        className="h-8 w-8"
      >
        {isMaximized ? <Copy size={14} /> : <Square size={12} />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClose}
        className="h-8 w-8 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
        title={t("window.close")}
      >
        <X size={14} />
      </Button>
    </div>
  );
}
