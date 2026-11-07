import { useCallback, useEffect, useMemo, useState } from "react";

const RANGES = ["15m", "1h", "6h", "24h"];
const SOURCES = [
  { id: "all", label: "All" },
  { id: "system", label: "System" },
  { id: "app", label: "Application" },
  { id: "docker", label: "Docker" },
];

function formatValue(value, unit) {
  if (value == null || Number.isNaN(value)) return "—";
  const n = Number(value);
  if (unit === "percent") return `${n.toFixed(1)}%`;
  if (unit === "s") return `${n.toFixed(3)}s`;
  if (unit === "bytes" || unit === "Bps") {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
    return n.toFixed(1);
  }
  return n.toFixed(2);
}

function lastPoint(series) {
  let best = null;
  for (const s of series || []) {
    const pts = s.points || [];
    if (!pts.length) continue;
    const [, v] = pts[pts.length - 1];
    if (best == null || v > best) best = v;
  }
  return best;
}

function MetricChart({ panel }) {
  const width = 480;
  const height = 160;
  const pad = { top: 12, right: 12, bottom: 24, left: 44 };
  const series = panel.series || [];
  const allPoints = series.flatMap((s) => s.points || []);

  const { paths, minY, maxY } = useMemo(() => {
    if (!allPoints.length) {
      return { paths: [], minY: 0, maxY: 1 };
    }
    const xs = allPoints.map(([t]) => t);
    const ys = allPoints.map(([, v]) => v);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const xScale = (t) =>
      pad.left + ((t - minX) / Math.max(maxX - minX, 1)) * plotW;
    const yScale = (v) =>
      pad.top + plotH - ((v - lo) / Math.max(hi - lo, 1e-9)) * plotH;

    const built = series.map((s, idx) => {
      const pts = s.points || [];
      if (pts.length < 2) return null;
      const d = pts
        .map(([t, v], i) => `${i === 0 ? "M" : "L"}${xScale(t).toFixed(1)},${yScale(v).toFixed(1)}`)
        .join(" ");
      const first = pts[0];
      const last = pts[pts.length - 1];
      const area = `${d} L${xScale(last[0]).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xScale(first[0]).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;
      return { name: s.name, d, area, idx };
    }).filter(Boolean);

    return { paths: built, minY: lo, maxY: hi };
  }, [allPoints, series]);

  const colors = [
    "var(--accent)",
    "var(--accent-2)",
    "var(--warn)",
    "var(--ok)",
  ];

  return (
    <article className="observe-card">
      <div className="observe-card-head">
        <h3>{panel.title}</h3>
        <span className="observe-stat">
          {panel.empty
            ? "No data"
            : formatValue(lastPoint(series), panel.unit)}
        </span>
      </div>
      {panel.error && (
        <p className="observe-hint err">{panel.error}</p>
      )}
      {panel.empty && !panel.error ? (
        <p className="observe-hint">
          No series for this range. Wait ~2 minutes after Prometheus restarts,
          or check the monitor VM disk (full disk stops scrapes).
        </p>
      ) : (
        <svg
          className="observe-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={panel.title}
        >
          <line
            x1={pad.left}
            y1={pad.top}
            x2={pad.left}
            y2={height - pad.bottom}
            className="observe-axis"
          />
          <line
            x1={pad.left}
            y1={height - pad.bottom}
            x2={width - pad.right}
            y2={height - pad.bottom}
            className="observe-axis"
          />
          <text x={4} y={pad.top + 8} className="observe-axis-label">
            {formatValue(maxY, panel.unit)}
          </text>
          <text x={4} y={height - pad.bottom} className="observe-axis-label">
            {formatValue(minY, panel.unit)}
          </text>
          {paths.map((p) => (
            <g key={p.name}>
              <path d={p.area} fill={colors[p.idx % colors.length]} opacity="0.12" />
              <path
                d={p.d}
                fill="none"
                stroke={colors[p.idx % colors.length]}
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
      )}
      {series.length > 1 && (
        <ul className="observe-legend">
          {series.slice(0, 6).map((s, i) => (
            <li key={s.name}>
              <span
                className="observe-swatch"
                style={{ background: colors[i % colors.length] }}
              />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function ObservePage({ api }) {
  const [tab, setTab] = useState("metrics");
  const [range, setRange] = useState("1h");
  const [metrics, setMetrics] = useState(null);
  const [metricsErr, setMetricsErr] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const [logRange, setLogRange] = useState("1h");
  const [logSource, setLogSource] = useState("all");
  const [logHost, setLogHost] = useState("");
  const [logSeverity, setLogSeverity] = useState("");
  const [logQ, setLogQ] = useState("");
  const [logs, setLogs] = useState(null);
  const [logsErr, setLogsErr] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const [alerts, setAlerts] = useState([]);
  const [presets, setPresets] = useState([]);
  const [alertsErr, setAlertsErr] = useState(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    preset: "high_cpu",
    threshold: 80,
    forDuration: "5m",
    severity: "warning",
  });
  const [formBusy, setFormBusy] = useState(false);
  const [formMsg, setFormMsg] = useState(null);
  const [ingress, setIngress] = useState(null);
  const [ingressErr, setIngressErr] = useState(null);

  const loadIngress = useCallback(async () => {
    try {
      const data = await api("/api/observe/ingress");
      setIngress(data);
      setIngressErr(null);
    } catch (err) {
      setIngressErr(err.message);
      setIngress(null);
    }
  }, [api]);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsErr(null);
    try {
      const data = await api(`/api/observe/metrics?range=${encodeURIComponent(range)}`);
      setMetrics(data);
    } catch (err) {
      setMetricsErr(err.message);
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  }, [api, range]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsErr(null);
    const params = new URLSearchParams({
      range: logRange,
      source: logSource,
      size: "50",
    });
    if (logHost.trim()) params.set("host", logHost.trim());
    if (logSeverity) params.set("severity", logSeverity);
    if (logQ.trim()) params.set("q", logQ.trim());
    try {
      const data = await api(`/api/observe/logs?${params}`);
      setLogs(data);
    } catch (err) {
      setLogsErr(err.message);
      setLogs(null);
    } finally {
      setLogsLoading(false);
    }
  }, [api, logRange, logSource, logHost, logSeverity, logQ]);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsErr(null);
    try {
      const data = await api("/api/observe/alerts");
      setAlerts(data.rules || []);
      setPresets(data.presets || []);
    } catch (err) {
      setAlertsErr(err.message);
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (tab === "metrics") {
      loadMetrics();
      loadIngress();
    }
  }, [tab, loadMetrics, loadIngress]);

  useEffect(() => {
    if (tab === "logs") loadLogs();
  }, [tab, loadLogs]);

  useEffect(() => {
    if (tab === "alerts") loadAlerts();
  }, [tab, loadAlerts]);

  const onPresetChange = (presetId) => {
    const p = presets.find((x) => x.id === presetId);
    setForm((f) => ({
      ...f,
      preset: presetId,
      threshold: p?.defaultThreshold ?? f.threshold,
      forDuration: p?.defaultFor && p.defaultFor !== "0m" ? p.defaultFor : f.forDuration,
      title: f.title || p?.title || "",
    }));
  };

  const createAlert = async (e) => {
    e.preventDefault();
    setFormBusy(true);
    setFormMsg(null);
    try {
      const data = await api("/api/observe/alerts", {
        method: "POST",
        body: JSON.stringify({
          title: form.title || undefined,
          preset: form.preset,
          threshold: Number(form.threshold),
          forDuration: form.forDuration,
          severity: form.severity,
        }),
      });
      setFormMsg({ type: "ok", text: `Created ${data.rule?.uid || "alert"}` });
      await loadAlerts();
    } catch (err) {
      setFormMsg({ type: "err", text: err.message });
    } finally {
      setFormBusy(false);
    }
  };

  const deleteAlert = async (uid) => {
    if (!uid.startsWith("dash-")) return;
    if (!window.confirm(`Delete alert ${uid}?`)) return;
    try {
      await api(`/api/observe/alerts/${encodeURIComponent(uid)}`, {
        method: "DELETE",
        body: "{}",
      });
      await loadAlerts();
    } catch (err) {
      setAlertsErr(err.message);
    }
  };

  return (
    <div className="observe">
      <div className="observe-intro panel">
        <div>
          <h2>Observe</h2>
          <p>
            Metrics from Prometheus, logs from Elasticsearch, and alerts from Grafana,
            inside this dashboard at 127.10.10.10.
          </p>
        </div>
        <div className="observe-tabs" role="tablist">
          {["metrics", "logs", "alerts"].map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`btn${tab === id ? " btn-accent" : ""}`}
              onClick={() => setTab(id)}
            >
              {id === "metrics" ? "Metrics" : id === "logs" ? "Logs" : "Alerts"}
            </button>
          ))}
        </div>
      </div>

      {tab === "metrics" && (
        <section className="observe-section">
          <div className="observe-toolbar">
            <div className="observe-range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`btn btn-ghost${range === r ? " active" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                loadMetrics();
                loadIngress();
              }}
              disabled={metricsLoading}
            >
              {metricsLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          <article className="observe-card ingress-status">
            <div className="observe-card-head">
              <h3>Ingress</h3>
              <span className="observe-stat">
                {ingress?.health || (ingressErr ? "unavailable" : "…")}
              </span>
            </div>
            {ingressErr && <p className="observe-hint err">{ingressErr}</p>}
            <dl className="ingress-facts">
              {(ingress?.details || []).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </article>
          {metricsErr && <p className="observe-hint err">{metricsErr}</p>}
          <div className="observe-grid">
            {(metrics?.panels || []).map((panel) => (
              <MetricChart key={panel.id} panel={panel} />
            ))}
            {!metrics && !metricsErr && metricsLoading && (
              <p className="observe-hint">Loading metrics…</p>
            )}
          </div>
        </section>
      )}

      {tab === "logs" && (
        <section className="observe-section panel">
          <form
            className="observe-filters"
            onSubmit={(e) => {
              e.preventDefault();
              loadLogs();
            }}
          >
            <label>
              Range
              <select
                value={logRange}
                onChange={(e) => setLogRange(e.target.value)}
              >
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select
                value={logSource}
                onChange={(e) => setLogSource(e.target.value)}
              >
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Host
              <input
                value={logHost}
                onChange={(e) => setLogHost(e.target.value)}
                placeholder="e.g. appserver"
              />
            </label>
            <label>
              Severity
              <select
                value={logSeverity}
                onChange={(e) => setLogSeverity(e.target.value)}
              >
                <option value="">Any</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label className="observe-grow">
              Message
              <input
                value={logQ}
                onChange={(e) => setLogQ(e.target.value)}
                placeholder="filter text"
              />
            </label>
            <button type="submit" className="btn btn-accent" disabled={logsLoading}>
              {logsLoading ? "Searching…" : "Search"}
            </button>
          </form>
          {logsErr && <p className="observe-hint err">{logsErr}</p>}
          {logs && (
            <p className="observe-hint">
              Showing {logs.hits?.length || 0} of {logs.total ?? "?"} events
            </p>
          )}
          <div className="observe-log-table-wrap">
            <table className="observe-log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Host</th>
                  <th>Severity</th>
                  <th>Container</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {(logs?.hits || []).map((row) => (
                  <tr key={row.id}>
                    <td className="mono">
                      {row.timestamp
                        ? new Date(row.timestamp).toLocaleString()
                        : "—"}
                    </td>
                    <td>{row.host || "—"}</td>
                    <td>
                      <span className={`sev ${row.severity || ""}`}>
                        {row.severity || "—"}
                      </span>
                    </td>
                    <td className="mono">{row.container || "—"}</td>
                    <td className="msg" title={row.message}>
                      {row.message}
                    </td>
                  </tr>
                ))}
                {!logsLoading && logs && !(logs.hits || []).length && (
                  <tr>
                    <td colSpan={5} className="observe-hint">
                      No log events for these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "alerts" && (
        <section className="observe-section observe-alerts">
          <div className="panel">
            <div className="observe-toolbar">
              <h3 style={{ margin: 0 }}>Alert rules</h3>
              <button
                type="button"
                className="btn"
                onClick={loadAlerts}
                disabled={alertsLoading}
              >
                {alertsLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            {alertsErr && <p className="observe-hint err">{alertsErr}</p>}
            <div className="observe-log-table-wrap">
              <table className="observe-log-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Severity</th>
                    <th>State</th>
                    <th>For</th>
                    <th>Condition</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((rule) => (
                    <tr key={rule.uid}>
                      <td>
                        <strong>{rule.title}</strong>
                        <div className="observe-hint mono">
                          {rule.ruleGroup || rule.uid}
                        </div>
                      </td>
                      <td>
                        <span className={`sev ${rule.severity}`}>
                          {rule.severity}
                        </span>
                      </td>
                      <td>
                        <span className={`sev ${rule.state || "inactive"}`}>
                          {rule.state || "—"}
                        </span>
                      </td>
                      <td className="mono">{rule.for || "—"}</td>
                      <td className="msg" title={rule.expr}>
                        {rule.condition}
                      </td>
                      <td>
                        {rule.deletable ? (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => deleteAlert(rule.uid)}
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="observe-hint">locked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!alertsLoading && !alerts.length && (
                    <tr>
                      <td colSpan={6} className="observe-hint">
                        No alert rules returned from Prometheus or Grafana.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form className="panel observe-alert-form" onSubmit={createAlert}>
            <h3>Create alert</h3>
            <p className="observe-hint">
              Preset thresholds only — rules land in Grafana folder{" "}
              <strong>Dashboard alerts</strong> with uid <code>dash-*</code>.
              School Ansible rules stay locked.
            </p>
            <label>
              Name
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Optional display name"
              />
            </label>
            <label>
              Preset
              <select
                value={form.preset}
                onChange={(e) => onPresetChange(e.target.value)}
              >
                {(presets.length
                  ? presets
                  : [
                      { id: "high_cpu", title: "CPU above threshold" },
                      { id: "high_memory", title: "Memory above threshold" },
                      { id: "low_disk", title: "Disk free below threshold" },
                      {
                        id: "container_restarts",
                        title: "Container restarts above threshold",
                      },
                    ]
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="observe-form-row">
              <label>
                Threshold
                <input
                  type="number"
                  step="any"
                  value={form.threshold}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, threshold: e.target.value }))
                  }
                  required
                />
              </label>
              <label>
                For
                <select
                  value={form.forDuration}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, forDuration: e.target.value }))
                  }
                >
                  {["1m", "2m", "5m", "10m", "15m"].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Severity
                <select
                  value={form.severity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, severity: e.target.value }))
                  }
                >
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                  <option value="critical">critical</option>
                </select>
              </label>
            </div>
            {formMsg && (
              <p className={`observe-hint ${formMsg.type === "ok" ? "ok" : "err"}`}>
                {formMsg.text}
              </p>
            )}
            <button type="submit" className="btn btn-accent" disabled={formBusy}>
              {formBusy ? "Creating…" : "Create alert"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
