import React, { useState } from "react";
import WindowControls from "./WindowControls";
import { Button } from "./ui/button";
import { Power } from "lucide-react";
import { ConfirmDialog } from "./ui/dialog";
import { useI18n } from "../i18n";

interface TitleBarProps {
  title?: string;
  showTitle?: boolean;
  children?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}

export default function TitleBar({
  title = "",
  showTitle = false,
  children,
  className = "",
  actions,
}: TitleBarProps) {
  const { t } = useI18n();
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  const platform =
    typeof window !== "undefined" && window.electronAPI?.getPlatform
      ? window.electronAPI.getPlatform()
      : "darwin";

  const handleQuit = async () => {
    try {
      await window.electronAPI?.appQuit?.();
    } catch {
      // Silently handle if API not available
    }
  };

  const getActionsContent = () => {
    if (!actions) return null;

    if (platform !== "darwin" && React.isValidElement(actions)) {
      const childrenArray = React.Children.toArray(actions.props.children);
      return <>{[...childrenArray].reverse()}</>;
    }

    return actions;
  };

  return (
    <div className={`bg-white border-b border-gray-100 select-none ${className}`}>
      <div
        className="flex items-center justify-between h-12 px-4"
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" }}>
          {platform !== "darwin" ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowQuitConfirm(true)}
                className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                title={t("window.quit")}
                aria-label={t("window.quit")}
              >
                <Power size={16} />
              </Button>
              {getActionsContent()}
            </>
          ) : (
            <>
              {showTitle && title && (
                <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
              )}
              {children}
            </>
          )}
        </div>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {platform !== "darwin" ? (
            <>
              <WindowControls />
            </>
          ) : (
            <>{actions}</>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={showQuitConfirm}
        onOpenChange={setShowQuitConfirm}
        title={t("window.quitConfirm")}
        description={t("window.quitDesc")}
        confirmText={t("window.quit")}
        cancelText={t("dialog.cancel")}
        onConfirm={handleQuit}
        variant="destructive"
      />
    </div>
  );
}
