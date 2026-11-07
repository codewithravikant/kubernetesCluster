import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "cc-onboarding-done";

const DEFAULT_MEMORY = [8192, 10240, 12288, 14336, 16384, 18432];
const DEFAULT_CPUS = [2, 4, 6, 8];

const GUIDES = [
  {
    title: "Host RAM",
    body: "This laptop needs Docker Desktop with enough memory for Minikube. Default is 6 vCPU / 12 GB. Cap is 8 vCPU / 18 GB.",
  },
  {
    title: "Docker + Minikube",
    body: "Install Docker Desktop, then Minikube, kubectl, and Helm. make chronicles installs the missing CLI tools when it can.",
  },
  {
    title: "Start the cluster",
    body: "Click Start Cluster (or run make chronicles). That builds images, applies manifests, and installs Prometheus, EFK, and Jenkins.",
  },
  {
    title: "Where settings land",
    body: "CPU and RAM write to config/cluster.yml. Apply restarts Minikube with the new size.",
  },
];

export function shouldShowOnboarding() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export default function OnboardingOverlay({
  open,
  onClose,
  options,
  onSave,
}) {
  const memoryOpts = options?.memory?.length ? options.memory : DEFAULT_MEMORY;
  const cpuOpts = options?.cpus?.length ? options.cpus : DEFAULT_CPUS;
  const [memory, setMemory] = useState(12288);
  const [cpus, setCpus] = useState(6);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
  }, [open]);

  const guide = GUIDES[Math.min(step, GUIDES.length - 1)];
  const last = step >= GUIDES.length - 1;

  const preview = useMemo(
    () => `Minikube: ${cpus} vCPU · ${Math.round(memory / 1024)} GB RAM`,
    [cpus, memory]
  );

  if (!open) return null;

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (onSave) await onSave({ memory, cpus });
      markOnboardingDone();
      onClose?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true">
      <div className="onboarding-card">
        <p className="login-eyebrow">Cluster Chronicles</p>
        <h2>{guide.title}</h2>
        <p>{guide.body}</p>
        {last ? (
          <div className="onboarding-form">
            <label>
              vCPU
              <select value={cpus} onChange={(e) => setCpus(Number(e.target.value))}>
                {cpuOpts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Memory (MB)
              <select
                value={memory}
                onChange={(e) => setMemory(Number(e.target.value))}
              >
                {memoryOpts.map((m) => (
                  <option key={m} value={m}>
                    {m} ({Math.round(m / 1024)} GB)
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">{preview}</p>
          </div>
        ) : null}
        {error ? <p className="flash err">{error}</p> : null}
        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="btn ghost" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                markOnboardingDone();
                onClose?.();
              }}
            >
              Skip
            </button>
          )}
          {!last ? (
            <button type="button" className="btn primary" onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={finish}>
              {busy ? "Saving…" : "Save & continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
