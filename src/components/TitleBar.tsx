import React, { useEffect, useState } from "react";
import WindowControls from "./WindowControls";
import { Button } from "./ui/button";
import { Power } from "lucide-react";
import { ConfirmDialog } from "./ui/dialog";

interface TitleBarProps {
  title?: string;
  showTitle?: boolean;
  children?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}

type Platform = "darwin" | "win32" | "linux" | "unknown";

const getFallbackPlatform = (): Platform => {
  if (typeof navigator === "undefined") return "unknown";
  const ua = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
  if (/Mac|Darwin/i.test(ua)) return "darwin";
  if (/Win/i.test(ua)) return "win32";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
};

const normalizePlatform = (value: string): Platform => {
  if (value === "darwin" || value === "win32" || value === "linux") return value;
  return "unknown";
};

export default function TitleBar({
  title = "",
  showTitle = false,
  children,
  className = "",
  actions,
}: TitleBarProps) {
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [platform, setPlatform] = useState<Platform>(() => getFallbackPlatform());

  useEffect(() => {
    let mounted = true;

    const loadPlatform = async () => {
      try {
        const nextPlatform = await window.electronAPI?.getPlatform?.();
        if (mounted && nextPlatform) {
          setPlatform(normalizePlatform(nextPlatform));
        }
      } catch {
        // Keep the initial browser-derived fallback.
      }
    };

    loadPlatform();
    return () => {
      mounted = false;
    };
  }, []);

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
                className="h-11 w-11 text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Quit Typefree"
                aria-label="Quit Typefree"
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
            <WindowControls />
          ) : (
            <>
              {actions}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowQuitConfirm(true)}
                className="h-11 w-11 text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Quit Typefree"
                aria-label="Quit Typefree"
              >
                <Power size={16} />
              </Button>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={showQuitConfirm}
        onOpenChange={setShowQuitConfirm}
        title="Quit Typefree?"
        description="This will close Typefree and stop background processes."
        confirmText="Quit"
        cancelText="Cancel"
        onConfirm={handleQuit}
        variant="destructive"
      />
    </div>
  );
}
