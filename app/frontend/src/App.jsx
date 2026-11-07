import { useCallback, useEffect, useRef, useState } from "react";

const WEB_SERVER =
  typeof window !== "undefined"
    ? window.__WEB_SERVER__ ||
      document.querySelector('meta[name="web-server"]')?.content ||
      "unknown"
    : "unknown";

const METRICS_POLL_MS = 5000;
const LB_POLL_MS = 30000;

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function barTone(pct) {
  if (pct == null || Number.isNaN(pct)) return "";
  if (pct >= 85) return "hot";
  if (pct >= 70) return "warm";
  return "";
}

function liveFingerprint(data) {
  if (!data) return "";
  return [
    data.hostname,
    data.uptimeSeconds,
    data.memory?.usedPercent,
    data.loadAverage?.["1m"],
    data.loadAverage?.["5m"],
    data.loadAverage?.["15m"],
  ].join("|");
}

function lbFingerprint(data) {
  if (!data) return "";
  return JSON.stringify({
    algorithm: data.algorithm,
    updatedAt: data.updatedAt,
    upstreams: data.upstreams,
  });
}

export default function App() {
  const [metrics, setMetrics] = useState(null);
  const [lbStatus, setLbStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [webFlash, setWebFlash] = useState(false);

  const metricsAbort = useRef(null);
  const lbAbort = useRef(null);
  const liveFp = useRef("");
  const lbFp = useRef("");

  const loadMetrics = useCallback(async ({ full = false, manual = false } = {}) => {
    if (manual) setRefreshing(true);
    metricsAbort.current?.abort();
    const ac = new AbortController();
    metricsAbort.current = ac;

    try {
      const path = full ? "/api/metrics" : "/api/metrics/live";
      const res = await fetch(path, { cache: "no-store", signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fp = liveFingerprint(data);
      if (!full && fp === liveFp.current) {
        setError(null);
        return;
      }
      liveFp.current = fp;
      setMetrics((prev) => {
        if (full || !prev) return data;
        return {
          ...prev,
          ...data,
          node: { ...prev.node, ...data.node },
        };
      });
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err.message || "Failed to load metrics");
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadLbStatus = useCallback(async () => {
    lbAbort.current?.abort();
    const ac = new AbortController();
    lbAbort.current = ac;
    try {
      const res = await fetch("/lb-status", {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) {
        setLbStatus(null);
        lbFp.current = "";
        return;
      }
      const data = await res.json();
      const fp = lbFingerprint(data);
      if (fp === lbFp.current) return;
      lbFp.current = fp;
      setLbStatus(data);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setLbStatus(null);
      lbFp.current = "";
    }
  }, []);

  useEffect(() => {
    loadMetrics({ full: true });
    loadLbStatus();
    const metricsId = setInterval(() => loadMetrics({ full: false }), METRICS_POLL_MS);
    const lbId = setInterval(() => loadLbStatus(), LB_POLL_MS);
    return () => {
      clearInterval(metricsId);
      clearInterval(lbId);
      metricsAbort.current?.abort();
      lbAbort.current?.abort();
    };
  }, [loadMetrics, loadLbStatus]);

  useEffect(() => {
    // Soft highlight on first paint so reviewers notice which frontend answered.
    setWebFlash(true);
    const t = setTimeout(() => setWebFlash(false), 900);
    return () => clearTimeout(t);
  }, []);

  const algo = lbStatus?.algorithm || "weighted";
  const memPct = metrics?.memory?.usedPercent;

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden="true" />
      <header className="hero">
        <div className="hero-top">
          <p className="brand">Cluster Chronicles · CI live</p>
          <span
            className={`live-pill ${error ? "down" : loading ? "wait" : "up"}`}
            title={error ? "Backend unreachable" : "Polling /api/metrics/live"}
          >
            <span className="live-dot" aria-hidden="true" />
            {error ? "Offline" : loading ? "Connecting" : "Live"}
          </span>
        </div>
        <h1>Live infrastructure diagnostics (Jenkins CI)</h1>
        <p className="lede">
          Frontend on <strong className={webFlash ? "flash" : undefined}>{WEB_SERVER}</strong>
          {metrics?.hostname ? (
            <>
              {" "}
              · backend <strong>{metrics.hostname}</strong>
            </>
          ) : null}
        </p>
        <div className="actions">
          <button
            type="button"
            className={`btn ${refreshing ? "busy" : ""}`}
            onClick={() => {
              loadMetrics({ full: true, manual: true });
              loadLbStatus();
            }}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <span className="chip" title="Active nginx load-balancing strategy">
            LB · {algo}
          </span>
          {algo === "resource" && Array.isArray(lbStatus?.upstreams) ? (
            <span className="chip muted" title="Adaptive upstream weights">
              {lbStatus.upstreams
                .map((u) => `${u.host}:w${u.weight}`)
                .join(" · ")}
            </span>
          ) : null}
          <span className="meta">
            {updatedAt
              ? `Updated ${updatedAt.toLocaleTimeString()}`
              : loading
                ? "Loading…"
                : "Waiting…"}
          </span>
        </div>
      </header>

      {error ? (
        <div className="banner error" role="alert">
          Could not reach backend: {error}
        </div>
      ) : null}

      <section className="grid" aria-live="polite" aria-busy={loading}>
        {loading && !metrics ? (
          <>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="metric skeleton" aria-hidden="true">
                <div className="sk-line short" />
                <div className="sk-line" />
                <div className="sk-line mid" />
              </div>
            ))}
          </>
        ) : (
          <>
            <Metric
              label="Responding web server"
              value={WEB_SERVER}
              hint="Rotates when traffic hits different frontends via the load balancer"
              accent
              flash={webFlash}
            />
            <Metric
              label="Backend hostname"
              value={metrics?.hostname || "—"}
              hint="Application server container"
            />
            <Metric
              label="OS"
              value={metrics?.os?.prettyName || "—"}
              hint={metrics?.os?.arch}
            />
            <Metric
              label="Uptime"
              value={formatUptime(metrics?.uptimeSeconds)}
              hint="Host uptime"
            />
            <Metric
              label="Memory used"
              value={memPct != null ? `${memPct}%` : "—"}
              hint={
                metrics?.memory
                  ? `${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`
                  : undefined
              }
              bar={memPct}
              tone={barTone(memPct)}
            />
            <Metric
              label="CPU"
              value={
                metrics?.cpu
                  ? `${metrics.cpu.cores} cores @ ${metrics.cpu.speedMHz || "?"} MHz`
                  : "—"
              }
              hint={metrics?.cpu?.model}
            />
            <Metric
              label="Load average"
              value={
                metrics?.loadAverage
                  ? `${metrics.loadAverage["1m"]?.toFixed(2)} / ${metrics.loadAverage["5m"]?.toFixed(2)} / ${metrics.loadAverage["15m"]?.toFixed(2)}`
                  : "—"
              }
              hint="1m / 5m / 15m"
            />
            <Metric
              label="Container"
              value={
                metrics?.container?.runningInContainer ? "Yes (Docker)" : "Host / unknown"
              }
              hint={metrics?.node?.version}
            />
          </>
        )}
      </section>

      <footer className="foot">
        <span>GET /api/metrics/live → appserver:3000 (LB direct)</span>
        <span>Entry: loadbalancer → web1 / web2</span>
        <span>GET /lb-status → algorithm + weights</span>
      </footer>
    </div>
  );
}

function Metric({ label, value, hint, bar, accent, flash, tone }) {
  return (
    <article
      className={`metric ${accent ? "accent" : ""} ${flash ? "flash-card" : ""} ${tone || ""}`}
    >
      <h2>{label}</h2>
      <p className="value">{value}</p>
      {hint ? <p className="hint">{hint}</p> : null}
      {typeof bar === "number" ? (
        <div className={`bar ${tone || ""}`} aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      ) : null}
    </article>
  );
}
