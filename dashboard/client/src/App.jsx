import { useCallback, useEffect, useState } from "react";
import Topology from "./components/Topology.jsx";
import TerminalPanel from "./components/TerminalPanel.jsx";
import KnowledgeBase from "./components/KnowledgeBase.jsx";
import VmCard from "./components/VmCard.jsx";
import OnboardingOverlay, {
  shouldShowOnboarding,
} from "./components/OnboardingOverlay.jsx";
import LabProgressOverlay, {
  getReadyDismissToken,
  markReadyDismissed,
  readyToken,
} from "./components/LabProgressOverlay.jsx";
import LoginPage from "./components/LoginPage.jsx";
import ObservePage from "./components/ObservePage.jsx";
import HostPage from "./components/HostPage.jsx";
import { useTheme } from "./theme.jsx";

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new AuthError(data.error || "Authentication required");
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function shouldShowLabProgress(progress, forceOpen) {
  if (!progress) return false;
  if (progress.running) return true;
  if (forceOpen) return true;
  if (progress.ready) {
    const token = readyToken(progress);
    return Boolean(token) && getReadyDismissToken() !== token;
  }
  if (progress.error) {
    const token = `err:${progress.updatedAt || progress.error}`;
    return getReadyDismissToken() !== token;
  }
  return false;
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [machines, setMachines] = useState([]);
  const [topology, setTopology] = useState(null);
  const [resourceOptions, setResourceOptions] = useState(null);
  const [keyPresent, setKeyPresent] = useState(false);
  const [selected, setSelected] = useState(null);
  const [kbTopic, setKbTopic] = useState("overview");
  const [termSession, setTermSession] = useState(0);
  const [termMode, setTermMode] = useState("pod");
  const [busy, setBusy] = useState(null);
  const [log, setLog] = useState("");
  const [flash, setFlash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);
  const [labProgress, setLabProgress] = useState(null);
  const [forceLabOpen, setForceLabOpen] = useState(false);
  const [view, setView] = useState("lab");

  const handleAuthLoss = useCallback(() => {
    setUser(null);
    setMachines([]);
    setLabProgress(null);
    setLoading(false);
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const data = await api("/api/auth/me");
      if (data.authenticated) {
        setUser({ username: data.username });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const login = async (username, password) => {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setUser({ username: data.username });
    setLoading(true);
  };

  const logout = async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    handleAuthLoss();
  };

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/machines");
      setMachines(data.machines || []);
      setTopology(data.topology || null);
      setResourceOptions(data.options || null);
      setKeyPresent(!!data.keyPresent);
      setSelected((prev) => {
        if (prev && data.machines?.some((m) => m.name === prev)) return prev;
        return data.machines?.[0]?.name || null;
      });
    } catch (err) {
      if (err instanceof AuthError) {
        handleAuthLoss();
        return;
      }
      setFlash({ type: "err", text: err.message });
    } finally {
      setLoading(false);
    }
  }, [handleAuthLoss]);

  const refreshLabProgress = useCallback(async () => {
    try {
      const data = await api("/api/lab-progress");
      setLabProgress(data);
      if (data?.running) {
        setForceLabOpen(true);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        handleAuthLoss();
      }
    }
  }, [handleAuthLoss]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!user) return undefined;
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [user, refresh]);

  useEffect(() => {
    if (!user) return undefined;
    refreshLabProgress();
    const running = Boolean(labProgress?.running);
    const id = setInterval(refreshLabProgress, running ? 1500 : 5000);
    return () => clearInterval(id);
  }, [user, refreshLabProgress, labProgress?.running]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4200);
    return () => clearTimeout(t);
  }, [flash]);

  if (!authChecked) {
    return (
      <div className="login-page">
        <p className="login-lead" style={{ margin: "auto" }}>
          Loading…
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage onLogin={login} theme={theme} onToggleTheme={toggle} />
    );
  }

  const runAction = async (name, action) => {
    const key = `${name}:${action}`;
    setBusy(key);
    setLog(`Running ${action} on ${name}…\n`);
    try {
      const result = await api(`/api/machines/${name}/action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const out = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setLog(out || `(exit ${result.code})`);
      setFlash({
        type: result.ok ? "ok" : "err",
        text: result.ok
          ? `${action} completed on ${name}`
          : `${action} failed on ${name}`,
      });
      await refresh();
    } catch (err) {
      setFlash({ type: "err", text: err.message });
      setLog(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveResources = async (name, { memory, cpus, apply }) => {
    setBusy(`${name}:resources`);
    setLog(
      apply
        ? `Saving CPU/RAM for ${name} to config/cluster.yml and restarting Minikube…\n`
        : `Saving CPU/RAM for ${name} to infrastructure/config/cluster.yml…\n`
    );
    try {
      const result = await api(`/api/machines/${name}/resources`, {
        method: "PATCH",
        body: JSON.stringify({ memory, cpus, apply }),
      });
      const reloadOut = result.reload
        ? [result.reload.stdout, result.reload.stderr].filter(Boolean).join("\n")
        : "";
      setLog(
        [
          `Updated ${result.file}`,
          `memory=${result.machine.memory} MB  cpus=${result.machine.cpus}`,
          result.note,
          reloadOut,
        ]
          .filter(Boolean)
          .join("\n")
      );
      setFlash({
        type: result.ok ? "ok" : "err",
        text: result.ok
          ? apply
            ? `Applied ${name}: ${result.machine.memory} MB / ${result.machine.cpus} CPU`
            : `Saved ${name} → config/cluster.yml`
          : `Failed to apply resources on ${name}`,
      });
      await refresh();
    } catch (err) {
      setFlash({ type: "err", text: err.message });
      setLog(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveResourcesBatch = async (updates) => {
    const lines = [];
    for (const { name, memory, cpus } of updates) {
      const result = await api(`/api/machines/${name}/resources`, {
        method: "PATCH",
        body: JSON.stringify({ memory, cpus, apply: false }),
      });
      lines.push(
        `${name}: memory=${result.machine.memory} MB  cpus=${result.machine.cpus}`
      );
    }
    await refresh();
    return lines;
  };

  const runVerify = async () => {
    setBusy("verify");
    setLog("Running make verify…\n");
    try {
      const result = await api("/api/verify", { method: "POST", body: "{}" });
      setLog([result.stdout, result.stderr].filter(Boolean).join("\n"));
      setFlash({
        type: result.ok ? "ok" : "err",
        text: result.ok ? "Validation PASSED" : "Validation FAILED",
      });
    } catch (err) {
      setFlash({ type: "err", text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const startCluster = async () => {
    setBusy("chronicles");
    setForceLabOpen(true);
    setLog("Starting make chronicles…\n");
    try {
      const result = await api("/api/lab/chronicles", {
        method: "POST",
        body: "{}",
      });
      if (result.alreadyRunning) {
        setFlash({ type: "ok", text: "Cluster already running — showing progress" });
        setLog("Cluster already running; attached to live progress.\n");
      } else if (result.ok || result.started) {
        setFlash({ type: "ok", text: "Cluster started — watch live progress" });
        setLog(
          `Cluster started (pid ${result.pid || "?"}). Log: logs/chronicles-ui.log\n`
        );
      }
      await refreshLabProgress();
    } catch (err) {
      setFlash({ type: "err", text: err.message });
      setLog(err.message);
      setForceLabOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const stopLab = async () => {
    setBusy("stop");
    setForceLabOpen(true);
    setLog("Stopping Minikube…\n");
    try {
      const result = await api("/api/lab/stop", { method: "POST", body: "{}" });
      if (result.alreadyRunning) {
        setFlash({ type: "ok", text: "Stop already running — showing progress" });
      } else {
        setFlash({ type: "ok", text: "Stopping cluster…" });
        setLog(
          `Stop started (pid ${result.pid || "?"}). Log: logs/lab-power-ui.log\n`
        );
      }
      await refreshLabProgress();
      await refresh();
    } catch (err) {
      setFlash({ type: "err", text: err.message });
      setLog(err.message);
      setForceLabOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const destroyLab = async () => {
    const ok = window.confirm(
      "Delete the Minikube profile? This cannot be undone.\n\nUse Stop to power off without deleting."
    );
    if (!ok) return;

    setBusy("destroy");
    setForceLabOpen(true);
    setLog("Deleting Minikube profile…\n");
    try {
      const result = await api("/api/lab/destroy", {
        method: "POST",
        body: "{}",
      });
      if (result.alreadyRunning) {
        setFlash({ type: "ok", text: "Destroy already running — showing progress" });
      } else {
        setFlash({ type: "err", text: "Deleting cluster…" });
        setLog(
          `Destroy started (pid ${result.pid || "?"}). Log: logs/lab-power-ui.log\n`
        );
      }
      await refreshLabProgress();
      await refresh();
    } catch (err) {
      setFlash({ type: "err", text: err.message });
      setLog(err.message);
      setForceLabOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const dismissLabProgress = () => {
    if (labProgress?.ready) {
      markReadyDismissed(readyToken(labProgress));
    } else if (labProgress?.error) {
      markReadyDismissed(
        `err:${labProgress.updatedAt || labProgress.error}`
      );
    }
    setForceLabOpen(false);
  };

  const killLabProgress = async () => {
    setBusy("kill");
    try {
      await api("/api/lab/kill", { method: "POST", body: "{}" });
      setLabProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              ready: false,
              error: null,
              cancelled: true,
              phase: "cancelled",
              phaseLabel: "Cancelled",
              message: "Lab action cancelled — back to dashboard",
            }
          : prev
      );
      setForceLabOpen(false);
      setFlash({ type: "ok", text: "Lab action killed — back on dashboard" });
      setLog("Lab action cancelled from progress panel.\n");
      await refresh();
      await refreshLabProgress();
    } catch (err) {
      setFlash({ type: "err", text: err.message });
      setLog(err.message);
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const showLabOverlay = shouldShowLabProgress(labProgress, forceLabOpen);

  const scrollTerminal = () => {
    requestAnimationFrame(() => {
      document.getElementById("ssh-terminal")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  };

  const openClusterTerminal = () => {
    setTermMode("cluster");
    setKbTopic("minikube");
    setTermSession((n) => n + 1);
    setFlash({ type: "ok", text: "Opening terminal → cluster" });
    scrollTerminal();
  };

  const openTerminal = (name) => {
    setTermMode("pod");
    setSelected(name);
    setKbTopic(name);
    setTermSession((n) => n + 1);
    setFlash({ type: "ok", text: `Opening terminal → ${name}` });
    scrollTerminal();
  };

  const selectedMachine = machines.find((m) => m.name === selected) || null;

  const selectNamespace = (name) => {
    setSelected(name);
    setKbTopic(name);
  };

  const handleOnboardingComplete = ({ skipped, saved }) => {
    setShowOnboarding(false);
    if (saved) {
      setFlash({ type: "ok", text: "Lab resources saved to config/cluster.yml" });
      setLog("Onboarding saved RAM/CPU to infrastructure/config/cluster.yml");
    } else if (skipped) {
      setFlash({ type: "ok", text: "Setup skipped — you can edit RAM/CPU on each VM card" });
    }
  };

  const handleOnboardingSave = async (updates) => {
    const lines = await saveResourcesBatch(updates);
    setLog(["Onboarding resource save:", ...lines].join("\n"));
  };

  return (
    <div className="app">
      {showLabOverlay && labProgress && (
        <LabProgressOverlay
          progress={labProgress}
          onDismiss={dismissLabProgress}
          onKill={killLabProgress}
        />
      )}

      {showOnboarding && !loading && !showLabOverlay && (
        <OnboardingOverlay
          machines={machines}
          options={resourceOptions}
          keyPresent={keyPresent}
          onComplete={handleOnboardingComplete}
          onSaveAll={handleOnboardingSave}
        />
      )}

      <header className="topbar">
        <div className="brand">
          <h1>
            Cluster <span>Chronicles</span>
          </h1>
          <p>
            {view === "observe"
              ? "Observe — metrics, logs, and alerts"
              : view === "host"
                ? "Host — free RAM, disk, load, and cluster snapshot"
                : "Namespaces, Minikube status, and cluster controls"}
          </p>
          <nav className="view-nav" aria-label="Primary">
            <button
              type="button"
              className={`btn btn-ghost${view === "lab" ? " active" : ""}`}
              onClick={() => setView("lab")}
            >
              Cluster
            </button>
            <button
              type="button"
              className={`btn btn-ghost${view === "observe" ? " active" : ""}`}
              onClick={() => setView("observe")}
            >
              Observe
            </button>
            <button
              type="button"
              className={`btn btn-ghost${view === "host" ? " active" : ""}`}
              onClick={() => setView("host")}
            >
              Host
            </button>
          </nav>
        </div>
        <div className="top-actions">
          <span className="user-chip" title="Signed in">
            {user.username}
          </span>
          <button className="btn btn-ghost" type="button" onClick={toggle}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={logout}
            disabled={busy !== null}
          >
            Log out
          </button>
          {view === "lab" && (
            <>
              <button
                className="btn"
                type="button"
                onClick={refresh}
                disabled={busy !== null}
              >
                Refresh
              </button>
              <button
                className="btn"
                type="button"
                onClick={startCluster}
                disabled={
                  busy !== null ||
                  Boolean(
                    labProgress?.running && labProgress?.command === "chronicles"
                  )
                }
                title="Start make chronicles and watch live progress"
              >
                {busy === "chronicles" ||
                (labProgress?.running && labProgress?.command === "chronicles")
                  ? "Cluster running…"
                  : "Start Cluster"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={stopLab}
                disabled={
                  busy !== null ||
                  Boolean(
                    labProgress?.running && labProgress?.command === "stop"
                  )
                }
                title="Stop Minikube (disks kept). Does not stop this dashboard."
              >
                {busy === "stop" ||
                (labProgress?.running && labProgress?.command === "stop")
                  ? "Stopping…"
                  : "Stop"}
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={destroyLab}
                disabled={
                  busy !== null ||
                  Boolean(
                    labProgress?.running && labProgress?.command === "destroy"
                  )
                }
                title="Destroy all VMs (wipe). Asks for confirmation."
              >
                {busy === "destroy" ||
                (labProgress?.running && labProgress?.command === "destroy")
                  ? "Destroying…"
                  : "Destroy"}
              </button>
              <button
                className="btn btn-accent"
                type="button"
                onClick={runVerify}
                disabled={busy !== null}
              >
                {busy === "verify" ? "Validating…" : "Run validation"}
              </button>
            </>
          )}
        </div>
      </header>

      {view === "observe" ? (
        <ObservePage api={api} />
      ) : view === "host" ? (
        <HostPage
          api={api}
          machines={machines}
          onOpenObserve={() => setView("observe")}
        />
      ) : (
        <>
          <div className="layout">
            <section className="panel">
              <h2>Namespaces</h2>
              {loading ? (
                <p style={{ color: "var(--muted)" }}>Loading status…</p>
              ) : (
                <div className="vm-grid">
                  {machines.map((m) => (
                    <VmCard
                      key={m.name}
                      machine={m}
                      active={selected === m.name}
                      busy={busy}
                      options={resourceOptions}
                      onSelect={() => selectNamespace(m.name)}
                      onAction={runAction}
                      onSaveResources={saveResources}
                      onOpenTerminal={openTerminal}
                    />
                  ))}
                </div>
              )}
              {log && <div className="log-box">{log}</div>}
            </section>

            <section className="panel topology">
              <h2>Network topology</h2>
              <Topology
                machines={machines}
                topology={topology}
                selected={selected}
                onSelect={selectNamespace}
                onTopicFocus={setKbTopic}
              />
            </section>
          </div>

          <section className="panel terminal-shell">
            <div className="term-bar">
              <h2 style={{ margin: 0 }}>
                Terminal
                {termMode === "cluster"
                  ? " · cluster"
                  : selectedMachine
                    ? ` · ${selectedMachine.name}`
                    : ""}
              </h2>
              <div className="term-switch">
                <button
                  type="button"
                  className={`btn${termMode === "cluster" ? " btn-accent" : ""}`}
                  onClick={openClusterTerminal}
                >
                  cluster
                </button>
                {machines.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    className={`btn${termMode === "pod" && selected === m.name ? " btn-accent" : ""}`}
                    onClick={() => openTerminal(m.name)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <code>
                {termMode === "cluster"
                  ? "minikube status · kubectl get · describe · logs"
                  : selectedMachine
                    ? `kubectl exec -n ${selectedMachine.name} -it <pod> -- sh`
                    : "Select a namespace"}
              </code>
            </div>
            <TerminalPanel
              machine={selectedMachine}
              sessionKey={termSession}
              mode={termMode}
            />
          </section>

          <KnowledgeBase topic={kbTopic} onSelectTopic={setKbTopic} />
        </>
      )}

      {flash && (
        <div className={`flash ${flash.type === "ok" ? "ok" : "err"}`}>
          {flash.text}
        </div>
      )}
    </div>
  );
}
