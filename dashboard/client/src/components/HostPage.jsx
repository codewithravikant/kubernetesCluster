import { useCallback, useEffect, useState } from "react";

function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Meter({ label, usedPercent, detail, warnAt = 80, badAt = 90 }) {
  const pct = Math.max(0, Math.min(100, Number(usedPercent) || 0));
  const tone = pct >= badAt ? "bad" : pct >= warnAt ? "warn" : "ok";
  return (
    <article className={`host-card host-meter ${tone}`}>
      <header className="host-card-head">
        <h3>{label}</h3>
        <span className="host-pct">{pct.toFixed(1)}% used</span>
      </header>
      <div className="host-track" aria-hidden="true">
        <div className="host-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="host-detail">{detail}</p>
    </article>
  );
}

function Stat({ label, value, sub }) {
  return (
    <article className="host-card">
      <header className="host-card-head">
        <h3>{label}</h3>
      </header>
      <p className="host-stat-value">{value}</p>
      {sub ? <p className="host-detail">{sub}</p> : null}
    </article>
  );
}

export default function HostPage({ api, machines = [], onOpenObserve }) {
  const [host, setHost] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api("/api/observe/host");
      setHost(data);
    } catch (err) {
      setError(err.message);
      setHost(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const running = machines.filter((m) => m.state === "running").length;
  const reachable = machines.filter((m) => m.reachable).length;

  return (
    <div className="host-page">
      <div className="observe-intro panel">
        <div>
          <h2>
            Dashboard <span>host</span>
          </h2>
          <p>
            Free RAM, disk, load, and a snapshot of Minikube namespaces on the
            machine running this dashboard. Prometheus / Elasticsearch charts
            stay on{" "}
            <button type="button" className="linkish" onClick={onOpenObserve}>
              Observe
            </button>
            .
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="observe-hint err">{error}</p>}

      {host && (
        <>
          <section className="host-identity panel">
            <div>
              <p className="host-eyebrow">Control host</p>
              <h3>{host.hostname}</h3>
              <p className="host-detail">
                {host.platform} {host.release} · {host.arch} ·{" "}
                {host.cpuCount} CPUs
                {host.cpuModel ? ` · ${host.cpuModel}` : ""}
              </p>
            </div>
            <div className="host-identity-meta">
              <div>
                <span className="host-meta-label">Uptime</span>
                <strong>{formatUptime(host.uptimeSeconds)}</strong>
              </div>
              <div>
                <span className="host-meta-label">Load (1 / 5 / 15)</span>
                <strong>
                  {host.load.one.toFixed(2)} / {host.load.five.toFixed(2)} /{" "}
                  {host.load.fifteen.toFixed(2)}
                </strong>
              </div>
              <div>
                <span className="host-meta-label">Collected</span>
                <strong>
                  {new Date(host.collectedAt).toLocaleTimeString()}
                </strong>
              </div>
            </div>
          </section>

          <section className="host-grid">
            <Meter
              label="Memory"
              usedPercent={host.memory.usedPercent}
              detail={`${host.memory.availableHuman} free of ${host.memory.totalHuman} (${host.memory.usedHuman} used)`}
            />
            <Stat
              label="Free RAM"
              value={host.memory.availableHuman}
              sub={`Available for guests · total ${host.memory.totalHuman}`}
            />
            {host.diskRoot ? (
              <Meter
                label={`Disk ${host.diskRoot.mount}`}
                usedPercent={host.diskRoot.usedPercent}
                detail={`${host.diskRoot.availableHuman} free of ${host.diskRoot.sizeHuman}`}
                warnAt={75}
                badAt={90}
              />
            ) : (
              <Stat label="Disk" value="—" sub="df unavailable" />
            )}
            <Stat
              label="Disk free"
              value={host.diskRoot?.availableHuman || "—"}
              sub={
                host.diskRoot
                  ? `${host.diskRoot.mount} · ${host.diskRoot.filesystem}`
                  : "No mount data"
              }
            />
          </section>

          {host.disks?.length > 1 && (
            <section className="panel">
              <h3 className="host-section-title">Mounts</h3>
              <div className="observe-log-table-wrap">
                <table className="observe-log-table">
                  <thead>
                    <tr>
                      <th>Mount</th>
                      <th>Size</th>
                      <th>Used</th>
                      <th>Free</th>
                      <th>Used %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {host.disks.map((d) => (
                      <tr key={d.mount}>
                        <td className="mono">{d.mount}</td>
                        <td>{d.sizeHuman}</td>
                        <td>{d.usedHuman}</td>
                        <td>{d.availableHuman}</td>
                        <td>{d.usedPercent.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <section className="panel">
        <h3 className="host-section-title">Lab VMs on this host</h3>
        <p className="observe-hint">
          {machines.length} defined · {running} running · {reachable} reachable
        </p>
        <div className="host-vm-grid">
          {machines.map((m) => (
            <div key={m.name} className="host-vm-chip">
              <strong>{m.name}</strong>
              <span className="mono">{m.ip}</span>
              <span
                className={`host-vm-state ${
                  m.state === "running" ? "ok" : "muted"
                }`}
              >
                {m.state || "unknown"}
                {m.reachable ? " · ping ok" : ""}
              </span>
            </div>
          ))}
          {!machines.length && (
            <p className="observe-hint">No machines loaded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
