import { useEffect, useMemo, useRef, useState } from "react";

const DISMISS_KEY = "ss-lab-ready-dismissed";
const LOG_VISIBLE_LINES = 6;

export function getReadyDismissToken() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) || "";
  } catch {
    return "";
  }
}

export function markReadyDismissed(token) {
  try {
    sessionStorage.setItem(DISMISS_KEY, token || "1");
  } catch {
    /* ignore */
  }
}

export function clearReadyDismissed() {
  try {
    sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

/** Stable token for a finished ready event (re-show on next run). */
export function readyToken(progress) {
  if (!progress?.ready) return "";
  return String(progress.updatedAt || progress.message || "ready");
}

function machineEntries(machines) {
  if (!machines || typeof machines !== "object") return [];
  return Object.entries(machines).map(([name, row]) => ({
    name,
    status: row?.status || "pending",
    label: row?.label || name,
  }));
}

export default function LabProgressOverlay({ progress, onDismiss, onKill }) {
  const [killing, setKilling] = useState(false);
  const logRef = useRef(null);
  const running = Boolean(progress?.running);
  const ready = Boolean(progress?.ready) && !running;
  const failed = Boolean(progress?.error) && !running && !ready;
  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  const machines = useMemo(
    () => machineEntries(progress?.machines),
    [progress?.machines]
  );
  const logLines = useMemo(() => {
    const raw = Array.isArray(progress?.logLines) ? progress.logLines : [];
    const cleaned = raw.map((line) => String(line ?? "")).filter(Boolean);
    if (cleaned.length > 0) return cleaned.slice(-LOG_VISIBLE_LINES);
    if (running) return ["Waiting for process output…"];
    return [];
  }, [progress?.logLines, running]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines]);

  const handleKill = async () => {
    if (!onKill || killing) return;
    const ok = window.confirm(
      "Kill the running lab action and return to the dashboard?\n\nMinikube may be mid-start — you can Stop or Destroy afterward."
    );
    if (!ok) return;
    setKilling(true);
    try {
      await onKill();
    } finally {
      setKilling(false);
    }
  };

  const commandEyebrow = {
    chronicles: "make chronicles",
    stop: "Stop Minikube",
    destroy: "Delete Minikube",
  };
  const eyebrow = ready
    ? "Cluster ready"
    : failed
      ? "Error"
      : commandEyebrow[progress?.command] || "Lab progress";

  useEffect(() => {
    if (!running) return undefined;
    clearReadyDismissed();
    return undefined;
  }, [running]);

  return (
    <div
      className="onboard-backdrop lab-progress-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-progress-title"
    >
      <div className="onboard-modal lab-progress-modal">
        <header className="onboard-head">
          <div>
            <p className="onboard-eyebrow">{eyebrow}</p>
            <h2 id="lab-progress-title">
              {ready ? (
                <>
                  Local LAB is <span>Ready</span>
                </>
              ) : failed ? (
                <>
                  Lab setup <span>failed</span>
                </>
              ) : progress?.command === "stop" ? (
                <>
                  Stopping <span>Minikube</span>
                </>
              ) : progress?.command === "destroy" ? (
                <>
                  Destroying <span>cluster</span>
                </>
              ) : (
                <>
                  Building local <span>lab</span>
                </>
              )}
            </h2>
            <p className="onboard-lead">
              {progress?.message ||
                (running
                  ? "Provisioning is in progress…"
                  : "Waiting for status…")}
            </p>
          </div>
          <div className="lab-progress-head-actions">
            {running && onKill && (
              <button
                className="btn btn-danger"
                type="button"
                onClick={handleKill}
                disabled={killing}
                title="Kill lab action and return to dashboard"
              >
                {killing ? "Killing…" : "Kill"}
              </button>
            )}
            {(ready || failed) && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={onDismiss}
              >
                Dismiss
              </button>
            )}
          </div>
        </header>

        {logLines.length > 0 && (
          <div
            className="lab-progress-term"
            aria-label="Lab process output"
            title="Live process output"
          >
            <div className="lab-progress-term-chrome">
              <span className="lab-progress-term-label">output</span>
              <span className="lab-progress-term-live">
                {running ? "live" : ready ? "done" : failed ? "error" : ""}
              </span>
            </div>
            <pre
              ref={logRef}
              className="lab-progress-term-body"
              aria-live="polite"
            >
              {logLines.map((line, i) => (
                <code key={`${i}-${line.slice(0, 24)}`}>{line}</code>
              ))}
            </pre>
          </div>
        )}

        <div className="lab-progress-bar-wrap" role="status" aria-live="polite">
          <div className="lab-progress-meta">
            <span>{progress?.phaseLabel || progress?.phase || "…"}</span>
            <span>{percent}%</span>
          </div>
          <div
            className={`lab-progress-track${running ? " live" : ""}${
              ready ? " ready" : ""
            }${failed ? " failed" : ""}`}
          >
            <div
              className="lab-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {machines.length > 0 && (
          <ul className="lab-progress-machines">
            {machines.map((m) => (
              <li key={m.name} className={`lab-progress-machine ${m.status}`}>
                <span className={`lab-progress-dot ${m.status}`} />
                <span className="lab-progress-label">{m.label}</span>
                <span className="lab-progress-state">{m.status}</span>
              </li>
            ))}
          </ul>
        )}

        {failed && progress?.error && (
          <p className="onboard-error">{progress.error}</p>
        )}

        <footer className="onboard-foot lab-progress-foot">
          {running ? (
            <>
              <p className="lab-progress-hint">
                Status updates live. Kill returns you to the dashboard.
              </p>
              {onKill && (
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={handleKill}
                  disabled={killing}
                >
                  {killing ? "Killing…" : "Kill & open dashboard"}
                </button>
              )}
            </>
          ) : ready ? (
            <button
              className="btn btn-accent"
              type="button"
              onClick={onDismiss}
            >
              Open dashboard
            </button>
          ) : (
            <button className="btn" type="button" onClick={onDismiss}>
              Close
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
