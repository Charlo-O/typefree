import React, { useEffect, useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Stack } from "@astryxdesign/core/Stack";
import { Minus, Square, X, Copy } from "lucide-react";
import { platform } from "../shared/platform";

/**
 * Window control buttons for Linux and Windows platforms
 * Provides minimize, maximize/restore, and close functionality
 * macOS uses native window controls so this component is not rendered there
 */
export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Sync maximized state with main process
    const syncIsMaximized = async () => {
      try {
        const maximized = await platform.window.isMaximized();
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
      await platform.window.minimize();
    } catch {
      // Silently handle if API not available
    }
  };

  const handleMaximize = async () => {
    try {
      await platform.window.maximize();
      // Update state after toggle
      const maximized = await platform.window.isMaximized();
      setIsMaximized(!!maximized);
    } catch {
      // Silently handle if API not available
    }
  };

  const handleClose = async () => {
    try {
      await platform.window.close();
    } catch {
      // Silently handle if API not available
    }
  };

  return (
    <Stack direction="horizontal" align="center" gap={1} className="pointer-events-auto">
      <IconButton
        label="Minimize"
        icon={<Minus size={14} aria-hidden="true" />}
        variant="ghost"
        size="sm"
        onClick={handleMinimize}
        tooltip="Minimize"
      />
      <IconButton
        label={isMaximized ? "Restore" : "Maximize"}
        icon={
          isMaximized ? (
            <Copy size={14} aria-hidden="true" />
          ) : (
            <Square size={12} aria-hidden="true" />
          )
        }
        variant="ghost"
        size="sm"
        onClick={handleMaximize}
        tooltip={isMaximized ? "Restore" : "Maximize"}
      />
      <IconButton
        label="Close"
        icon={<X size={14} aria-hidden="true" />}
        variant="ghost"
        size="sm"
        onClick={handleClose}
        tooltip="Close"
        className="hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
      />
    </Stack>
  );
}
