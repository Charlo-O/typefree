import React, { useEffect, useMemo, useState } from "react";

// A minimal, non-interactive recording indicator window (Handy-style).
// The backend controls visibility via `show-overlay` / `hide-overlay` events.
export default function RecordingOverlay() {
  const [state, setState] = useState("idle"); // idle | recording | transcribing | processing
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let unlistenShow = null;
    let unlistenHide = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenShow = await listen("show-overlay", (event) => {
          const next = String(event?.payload || "idle");
          console.debug("[overlay-ui] show-overlay", next);
          setState(next);
          setVisible(true);
        });
        unlistenHide = await listen("hide-overlay", () => {
          console.debug("[overlay-ui] hide-overlay");
          setVisible(false);
        });
        console.debug("[overlay-ui] listeners ready");
      } catch {
        // If Tauri event API isn't available, keep overlay hidden.
        console.warn("[overlay-ui] failed to register Tauri event listeners");
      }
    })();

    return () => {
      try {
        unlistenShow?.();
        unlistenHide?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const label = useMemo(() => {
    switch (state) {
      case "recording":
        return "Recording";
      case "transcribing":
        return "Transcribing";
      case "processing":
        return "Pasting";
      default:
        return "Ready";
    }
  }, [state]);

  const dotClass = useMemo(() => {
    if (state === "recording") return "bg-red-500";
    if (state === "transcribing") return "bg-amber-400";
    if (state === "processing") return "bg-emerald-400";
    return "bg-white/60";
  }, [state]);

  return (
    <div
      className={[
        "w-full h-full select-none",
        "flex items-center justify-center",
        // Let the backend hide the window after the fade-out completes.
        "transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
      style={{ backgroundColor: "transparent" }}
    >
      <div
        className={[
          "h-9 px-3 rounded-full",
          "bg-neutral-900/75 backdrop-blur-md",
          "border border-white/10",
          "flex items-center gap-2",
          "text-white",
        ].join(" ")}
        style={{ WebkitAppRegion: "no-drag" }}
      >
        <span className={["w-2 h-2 rounded-full", dotClass].join(" ")} />
        <span className="text-xs font-medium tracking-wide">{label}</span>
      </div>
    </div>
  );
}
