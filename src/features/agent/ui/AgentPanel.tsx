import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CornerDownLeft, Loader2, ShieldAlert, Square, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import { platform } from "../../../shared/platform";
import type {
  AgentApprovalDecision,
  AgentTaskSnapshot,
  PlatformListenerCleanup,
} from "../../../shared/platform";

/** Completed tasks fade out on their own; failures stay until dismissed. */
const COMPLETED_AUTO_DISMISS_MS = 15_000;

function cleanupPlatformListener(listener: PlatformListenerCleanup): void {
  if (!listener) return;
  void Promise.resolve(listener)
    .then((unlisten) => unlisten?.())
    .catch(() => {
      // ignore cleanup failures
    });
}

function isTerminal(snapshot: AgentTaskSnapshot | null): boolean {
  return (
    snapshot?.status === "completed" ||
    snapshot?.status === "failed" ||
    snapshot?.status === "cancelled"
  );
}

function StatusDot({ status }: { status: AgentTaskSnapshot["status"] }) {
  if (status === "starting" || status === "running") {
    return <Loader2 size={14} className="shrink-0 animate-spin text-white/70" aria-hidden />;
  }
  if (status === "awaitingApproval") {
    return <ShieldAlert size={14} className="shrink-0 text-amber-300" aria-hidden />;
  }
  const color =
    status === "completed"
      ? "bg-emerald-400"
      : status === "failed"
        ? "bg-red-400"
        : "bg-neutral-400";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function PanelButton({
  children,
  onClick,
  variant = "secondary",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const styles =
    variant === "primary"
      ? "bg-white text-neutral-950 hover:bg-white/90"
      : variant === "danger"
        ? "bg-red-500/20 text-red-200 hover:bg-red-500/30"
        : "bg-white/10 text-white/85 hover:bg-white/15";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export default function AgentPanel() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<AgentTaskSnapshot | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void platform.agent
      .getCurrentTask()
      .then((current) => {
        if (!cancelled && current) setSnapshot(current);
      })
      .catch(() => {
        // the panel simply waits for the next update
      });
    const unlisten = platform.agent.onTaskUpdated((next) => {
      setSnapshot(next);
      setActionError(null);
    });
    return () => {
      cancelled = true;
      cleanupPlatformListener(unlisten);
    };
  }, []);

  const hasSnapshot = snapshot !== null;

  // Keep the native panel exactly as tall as the card so no transparent area swallows clicks.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return;
    let lastHeight = 0;
    const observer = new ResizeObserver(([entry]) => {
      const height = Math.ceil(entry.target.getBoundingClientRect().height);
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        void platform.agent.resizePanel(height).catch(() => {});
      }
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [hasSnapshot]);

  useEffect(() => {
    if (snapshot?.status !== "completed") return;
    const timer = window.setTimeout(() => {
      void platform.agent.dismissPanel().catch(() => {});
    }, COMPLETED_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot?.status, snapshot?.taskId, snapshot?.message]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusyAction(true);
    setActionError(null);
    try {
      await action();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(false);
    }
  }, []);

  const respond = (decision: AgentApprovalDecision) => {
    if (!snapshot?.approval) return;
    const { taskId } = snapshot;
    const { requestKey } = snapshot.approval;
    void run(() => platform.agent.respondApproval(taskId, requestKey, decision));
  };

  const dismiss = () => void run(() => platform.agent.dismissPanel());

  if (!snapshot) {
    return <div ref={cardRef} className="h-px w-full" />;
  }

  const terminal = isTerminal(snapshot);
  const approval = snapshot.status === "awaitingApproval" ? snapshot.approval : null;
  const notice = snapshot.notice ? t(`agent.panel.notice.${snapshot.notice}`) : null;

  return (
    <div className="flex w-full select-none" style={{ backgroundColor: "transparent" }}>
      <div
        ref={cardRef}
        className="flex w-full flex-col gap-2 rounded-2xl border border-white/10 bg-neutral-950/95 px-3.5 py-3 text-white backdrop-blur-md"
        role="region"
        aria-label={t("agent.panel.title")}
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <StatusDot status={snapshot.status} />
          <span className="text-xs font-semibold text-white/90">
            {t(`agent.panel.status.${snapshot.status}`)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-white/45">“{snapshot.prompt}”</span>
          <button
            type="button"
            onClick={dismiss}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            aria-label={t("agent.panel.close")}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>

        {notice && <p className="text-[11px] text-amber-200/90">{notice}</p>}

        {approval && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 p-2.5">
            <p className="text-xs font-medium text-amber-100">
              {t(
                approval.kind === "fileChange" || approval.kind === "legacyFileChange"
                  ? "agent.panel.approval.fileChange"
                  : "agent.panel.approval.command"
              )}
              {snapshot.pendingApprovals > 1 &&
                ` · ${t("agent.panel.approval.more", { count: snapshot.pendingApprovals - 1 })}`}
            </p>
            {approval.command && (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-snug text-white/90">
                {approval.command}
              </pre>
            )}
            {approval.files.length > 0 && (
              <p className="break-all font-mono text-[11px] text-white/75">
                {approval.files.join(", ")}
              </p>
            )}
            {approval.reason && (
              <p className="text-[11px] leading-snug text-white/65">{approval.reason}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <PanelButton
                variant="primary"
                onClick={() => respond("accept")}
                disabled={busyAction}
              >
                <Check size={12} strokeWidth={3} />
                {t("agent.panel.approval.accept")}
              </PanelButton>
              <PanelButton onClick={() => respond("acceptForSession")} disabled={busyAction}>
                {t("agent.panel.approval.acceptForSession")}
              </PanelButton>
              <PanelButton
                variant="danger"
                onClick={() => respond("decline")}
                disabled={busyAction}
              >
                {t("agent.panel.approval.decline")}
              </PanelButton>
            </div>
          </div>
        )}

        {!terminal && !approval && snapshot.activity && (
          <p className="truncate font-mono text-[11px] text-white/55">{snapshot.activity}</p>
        )}

        {snapshot.message && (
          <p className="max-h-40 overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed text-white/90 select-text">
            {snapshot.message}
          </p>
        )}

        {snapshot.status === "failed" && snapshot.error && (
          <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs leading-snug text-red-200">
            {snapshot.error}
          </p>
        )}

        {actionError && <p className="text-[11px] text-red-200">{actionError}</p>}

        <div className="flex items-center justify-end gap-1.5">
          {!terminal && (
            <PanelButton
              variant="danger"
              onClick={() => void run(() => platform.agent.cancelTask(snapshot.taskId))}
              disabled={busyAction || snapshot.notice === "stopping"}
            >
              <Square size={10} strokeWidth={3} />
              {t("agent.panel.stop")}
            </PanelButton>
          )}
          {terminal && snapshot.message.trim() && (
            <PanelButton
              variant="primary"
              onClick={() => void run(() => platform.agent.insertResult(snapshot.taskId))}
              disabled={busyAction}
            >
              <CornerDownLeft size={12} strokeWidth={2.5} />
              {t("agent.panel.insert")}
            </PanelButton>
          )}
          {terminal && (
            <PanelButton onClick={dismiss} disabled={busyAction}>
              {t("agent.panel.close")}
            </PanelButton>
          )}
        </div>
      </div>
    </div>
  );
}
