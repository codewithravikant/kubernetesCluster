/**
 * Observe API — proxies Prometheus, Elasticsearch, and Grafana for the
 * dashboard Observe page. Mount after requireAuth.
 */

import { randomBytes } from "node:crypto";
import { Router } from "express";
import { getHostStats } from "./host-stats.js";
import { gatherTopologyFacts } from "./topology-facts.js";

const PROM_URL = (
  process.env.OBSERVE_PROM_URL || "http://127.0.0.1:9090"
).replace(/\/$/, "");
const ES_URL = (process.env.OBSERVE_ES_URL || "http://127.0.0.1:9200").replace(
  /\/$/,
  ""
);
const GRAFANA_URL = (
  process.env.OBSERVE_GRAFANA_URL || "http://127.0.0.1:3001"
).replace(/\/$/, "");
const GRAFANA_USER = process.env.OBSERVE_GRAFANA_USER || "admin";
const GRAFANA_PASS = process.env.OBSERVE_GRAFANA_PASS || "devops";

const RANGE_MS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const LOG_RANGES = new Set(["15m", "1h", "6h", "24h"]);
const LOG_SOURCES = new Set(["all", "system", "app", "docker"]);
const METRIC_RANGES = new Set(["15m", "1h", "6h", "24h"]);
const SEVERITIES = new Set(["info", "warning", "critical"]);
const FOR_DURATIONS = new Set(["1m", "2m", "5m", "10m", "15m"]);

const FOLDER_TITLE = "Dashboard alerts";
const FOLDER_UID = "dash-alerts";
const RULE_GROUP = "dashboard";

/** Fixed PromQL panels — browser cannot send free-form queries. */
const METRIC_PANELS = [
  {
    id: "cpu",
    title: "CPU Usage %",
    unit: "percent",
    step: "30s",
    queries: [
      {
        legend: "cpu",
        expr: `(1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[2m]))) * 100`,
      },
    ],
  },
  {
    id: "memory",
    title: "Memory Usage %",
    unit: "percent",
    step: "30s",
    queries: [
      {
        legend: "memory",
        expr: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`,
      },
    ],
  },
  {
    id: "disk_io",
    title: "Disk I/O (bytes/s)",
    unit: "Bps",
    step: "30s",
    queries: [
      {
        legend: "read",
        expr: `sum by (instance) (rate(node_disk_read_bytes_total[2m]))`,
      },
      {
        legend: "write",
        expr: `sum by (instance) (rate(node_disk_written_bytes_total[2m]))`,
      },
    ],
  },
  {
    id: "network",
    title: "Network In/Out (bytes/s)",
    unit: "Bps",
    step: "30s",
    queries: [
      {
        legend: "rx",
        expr: `sum by (instance) (rate(node_network_receive_bytes_total{device!="lo"}[2m]))`,
      },
      {
        legend: "tx",
        expr: `sum by (instance) (rate(node_network_transmit_bytes_total{device!="lo"}[2m]))`,
      },
    ],
  },
  {
    id: "container_cpu",
    title: "Container CPU (cores)",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "cpu",
        expr: `sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[2m]))`,
      },
    ],
  },
  {
    id: "container_mem",
    title: "Container Memory (bytes)",
    unit: "bytes",
    step: "30s",
    queries: [
      {
        legend: "memory",
        expr: `sum by (name) (container_memory_usage_bytes{name!=""})`,
      },
    ],
  },
  {
    id: "http_p95",
    title: "HTTP Request Duration p95 (s)",
    unit: "s",
    step: "30s",
    queries: [
      {
        legend: "p95",
        expr: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`,
      },
    ],
  },
  {
    id: "custom",
    title: "Diagnostic polls (total)",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "polls",
        expr: `sum by (endpoint) (chronicles_diagnostic_polls_total)`,
      },
    ],
  },
  {
    id: "ingress_cpu",
    title: "Ingress controller CPU (cores)",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "cpu",
        expr: `sum(rate(container_cpu_usage_seconds_total{namespace="ingress-nginx",container="controller",pod=~"ingress-nginx-controller-.+"}[5m]))`,
      },
    ],
  },
  {
    id: "ingress_mem",
    title: "Ingress controller memory",
    unit: "bytes",
    step: "30s",
    queries: [
      {
        legend: "memory",
        expr: `sum(container_memory_working_set_bytes{namespace="ingress-nginx",container="controller",pod=~"ingress-nginx-controller-.+"})`,
      },
    ],
  },
  {
    id: "ingress_rps",
    title: "Ingress request rate",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "rps",
        expr: `sum by (status) (rate(nginx_ingress_controller_requests[5m]))`,
      },
    ],
  },
  {
    id: "ingress_p95",
    title: "Ingress latency p95 (s)",
    unit: "s",
    step: "30s",
    queries: [
      {
        legend: "p95",
        expr: `histogram_quantile(0.95, sum by (le) (rate(nginx_ingress_controller_request_duration_seconds_bucket[5m])))`,
      },
    ],
  },
  {
    id: "ingress_4xx",
    title: "Ingress 4xx rate",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "4xx",
        expr: `sum(rate(nginx_ingress_controller_requests{status=~"4.."}[5m])) or vector(0)`,
      },
    ],
  },
  {
    id: "ingress_5xx",
    title: "Ingress 5xx rate",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "5xx",
        expr: `sum(rate(nginx_ingress_controller_requests{status=~"5.."}[5m])) or vector(0)`,
      },
    ],
  },
  {
    id: "ingress_probe",
    title: "Ingress probe success",
    unit: "short",
    step: "30s",
    queries: [
      {
        legend: "probe",
        expr: `probe_success{ingress="chronicles"}`,
      },
    ],
  },
];

const ALERT_PRESETS = {
  high_cpu: {
    title: "CPU above threshold",
    defaultFor: "5m",
    defaultThreshold: 80,
    comparator: "gt",
    expr: `(1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[2m]))) * 100`,
  },
  high_memory: {
    title: "Memory above threshold",
    defaultFor: "5m",
    defaultThreshold: 90,
    comparator: "gt",
    expr: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`,
  },
  low_disk: {
    title: "Disk free below threshold",
    defaultFor: "2m",
    defaultThreshold: 20,
    comparator: "lt",
    expr: `(node_filesystem_avail_bytes{fstype!~"tmpfs|fuse.lxcfs|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|fuse.lxcfs|squashfs"}) * 100`,
  },
  container_restarts: {
    title: "Container restarts above threshold",
    defaultFor: "0m",
    defaultThreshold: 3,
    comparator: "gt",
    expr: `changes(container_start_time_seconds{name!=""}[15m])`,
  },
};

function grafanaAuthHeader() {
  const token = Buffer.from(`${GRAFANA_USER}:${GRAFANA_PASS}`).toString("base64");
  return `Basic ${token}`;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 500) };
      }
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Timed out contacting ${originOf(url)}`);
    }
    const code = err?.cause?.code || "";
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "EHOSTUNREACH"
    ) {
      throw new Error(
        `Unreachable: ${originOf(url)} (${code}). Run ./scripts/host-forwards.sh start`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function escapeLucene(value) {
  return String(value).replace(/([+\-=&|><!(){}[\]^"~*?:\\/])/g, "\\$1");
}

async function prometheusNowMs() {
  try {
    const result = await fetchJson(
      `${PROM_URL}/api/v1/query?${new URLSearchParams({ query: "time()" })}`,
      { timeoutMs: 4000 }
    );
    const pair = result.body?.data?.result;
    // scalar: [timestamp, "value"]
    if (Array.isArray(pair) && pair.length >= 2) {
      const sec = Number(pair[1]);
      if (Number.isFinite(sec) && sec > 1e9) return Math.floor(sec * 1000);
    }
  } catch {
    /* fall back to local clock */
  }
  return Date.now();
}

async function rangeWindow(rangeKey) {
  const ms = RANGE_MS[rangeKey] || RANGE_MS["1h"];
  const end = await prometheusNowMs();
  return { start: end - ms, end, step: ms <= 3600000 ? "15s" : "60s" };
}

async function queryRange(expr, startMs, endMs, step) {
  const params = new URLSearchParams({
    query: expr,
    start: String(startMs / 1000),
    end: String(endMs / 1000),
    step,
  });
  const result = await fetchJson(`${PROM_URL}/api/v1/query_range?${params}`, {
    timeoutMs: 8000,
  });
  if (!result.ok || result.body?.status !== "success") {
    const msg =
      result.body?.error ||
      result.body?.raw ||
      `Prometheus HTTP ${result.status}`;
    throw new Error(String(msg).slice(0, 200));
  }
  return result.body.data?.result || [];
}

function seriesFromResult(result, fallbackLegend) {
  return result.map((series) => {
    const labels = series.metric || {};
    const legendParts = Object.entries(labels)
      .filter(([k]) => k !== "__name__")
      .map(([, v]) => v);
    const name =
      legendParts.length > 0
        ? legendParts.join(" · ")
        : fallbackLegend || "value";
    return {
      name,
      points: (series.values || []).map(([ts, val]) => [
        Number(ts) * 1000,
        Number(val),
      ]),
    };
  });
}

function buildLogQuery({ range, host, source, severity, q, size }) {
  const must = [];
  const filter = [];

  filter.push({
    range: {
      "@timestamp": {
        gte: `now-${range}`,
        lte: "now",
      },
    },
  });

  if (host) {
    filter.push({
      bool: {
        should: [
          { term: { "kubernetes.host": host } },
          { term: { "host.name": host } },
          { term: { "kubernetes.node_name": host } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (severity) {
    must.push({
      bool: {
        should: [
          { term: { severity } },
          { term: { level: severity } },
          { match: { message: severity } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (source === "system") {
    filter.push({
      bool: {
        should: [
          { terms: { "kubernetes.namespace_name": ["kube-system", "logging", "monitoring"] } },
          {
            bool: {
              must: [{ exists: { field: "log.file.path" } }],
              must_not: [
                { exists: { field: "container.name" } },
                { exists: { field: "kubernetes.container_name" } },
              ],
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  } else if (source === "docker") {
    filter.push({
      bool: {
        should: [
          { exists: { field: "kubernetes.container_name" } },
          { exists: { field: "container.name" } },
        ],
        minimum_should_match: 1,
      },
    });
  } else if (source === "app") {
    must.push({
      bool: {
        should: [
          { term: { "kubernetes.namespace_name": "app" } },
          { exists: { field: "service" } },
          { exists: { field: "severity" } },
          { exists: { field: "level" } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (q) {
    must.push({
      query_string: {
        default_field: "message",
        query: `*${escapeLucene(q)}*`,
        analyze_wildcard: true,
      },
    });
  }

  return {
    size,
    sort: [{ "@timestamp": { order: "desc" } }],
    query: {
      bool: {
        must: must.length ? must : [{ match_all: {} }],
        filter,
      },
    },
    _source: [
      "@timestamp",
      "host.name",
      "message",
      "severity",
      "level",
      "container.name",
      "log.file.path",
      "service",
      "kubernetes.host",
      "kubernetes.node_name",
      "kubernetes.pod_name",
      "kubernetes.container_name",
      "kubernetes.namespace_name",
    ],
  };
}

function mapHit(hit) {
  const src = hit._source || {};
  const k8s = src.kubernetes || {};
  return {
    id: hit._id,
    timestamp: src["@timestamp"] || null,
    host:
      k8s.host ||
      k8s.node_name ||
      src["kubernetes.host"] ||
      src["kubernetes.node_name"] ||
      src.host?.name ||
      src["host.name"] ||
      null,
    message: typeof src.message === "string" ? src.message : String(src.message || ""),
    severity: src.severity || src.level || null,
    container:
      k8s.container_name ||
      src["kubernetes.container_name"] ||
      src.container?.name ||
      src["container.name"] ||
      null,
    path: src.log?.file?.path || src["log.file.path"] || null,
    service: src.service || k8s.namespace_name || src["kubernetes.namespace_name"] || null,
  };
}

async function ensureAlertFolder() {
  const list = await fetchJson(`${GRAFANA_URL}/api/folders`, {
    headers: { Authorization: grafanaAuthHeader() },
  });
  if (!list.ok) {
    throw new Error(`Grafana folders HTTP ${list.status}`);
  }
  const folders = Array.isArray(list.body) ? list.body : [];
  const existing = folders.find(
    (f) => f.uid === FOLDER_UID || f.title === FOLDER_TITLE
  );
  if (existing) return existing;

  const created = await fetchJson(`${GRAFANA_URL}/api/folders`, {
    method: "POST",
    headers: {
      Authorization: grafanaAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uid: FOLDER_UID, title: FOLDER_TITLE }),
  });
  if (!created.ok) {
    throw new Error(
      created.body?.message || `Grafana create folder HTTP ${created.status}`
    );
  }
  return created.body;
}

function plainAlertCopy(preset, threshold, forDuration) {
  const wait =
    forDuration === "0m" ? "as soon as it crosses the line" : `for ${forDuration}`;
  if (preset === "high_cpu") {
    return {
      summary: `A machine is using more than ${threshold}% of its CPU`,
      description: `Processor use has stayed above ${threshold}% ${wait}. Open VM Performance and see which program is busy.`,
    };
  }
  if (preset === "high_memory") {
    return {
      summary: `A machine is using more than ${threshold}% of its memory`,
      description: `Memory use has stayed above ${threshold}% ${wait}. See which program is using RAM before the machine starts killing processes.`,
    };
  }
  if (preset === "low_disk") {
    return {
      summary: `A machine has less than ${threshold}% disk space left`,
      description: `Free disk space has dropped below ${threshold}% ${wait}. Free some disk before the machine fills up.`,
    };
  }
  return {
    summary: "restarted",
    description: `A container restarted more than ${threshold} times in 15 minutes. It is crashing in a loop. Read its logs.`,
  };
}

function buildAlertRule({
  uid,
  folderUid,
  title,
  preset,
  threshold,
  forDuration,
  severity,
}) {
  const presetDef = ALERT_PRESETS[preset];
  const comparator = presetDef.comparator === "lt" ? "lt" : "gt";
  const copy = plainAlertCopy(preset, threshold, forDuration);
  return {
    uid,
    title,
    folderUID: folderUid,
    ruleGroup: RULE_GROUP,
    condition: "C",
    noDataState: "NoData",
    execErrState: "Error",
    for: forDuration,
    annotations: {
      summary: copy.summary,
      description: copy.description,
    },
    labels: {
      severity,
      source: "dashboard",
    },
    isPaused: false,
    data: [
      {
        refId: "A",
        relativeTimeRange: { from: 600, to: 0 },
        datasourceUid: "prometheus-ds",
        model: {
          expr: presetDef.expr,
          instant: true,
          refId: "A",
        },
      },
      {
        refId: "C",
        relativeTimeRange: { from: 0, to: 0 },
        datasourceUid: "__expr__",
        model: {
          type: "threshold",
          expression: "A",
          conditions: [
            {
              evaluator: { type: comparator, params: [threshold] },
              operator: { type: "and" },
              reducer: { type: "last" },
            },
          ],
          refId: "C",
        },
      },
    ],
  };
}

function formatFor(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "0s";
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

const CHRONICLES_ALERT_ORDER = [
  "NodeCPUHigh",
  "NodeDiskLow",
  "NodeMemoryHigh",
  "PodRestartingTooOften",
  "ContainerMemoryHigh",
  "PodPendingTooLong",
  "KubernetesAPIServerDown",
  "ElasticsearchUnhealthy",
  "FluentBitErrors",
  "IngressControllerDown",
  "IngressFrontendDown",
  "IngressBackendPathDown",
  "IngressHostnameDown",
  "Ingress5xxHigh",
  "IngressFrontendEndpointsEmpty",
];

function summarizePrometheusRule(group, rule) {
  const query = String(rule.query || "").replace(/\s+/g, " ").trim();
  return {
    uid: `prom:${group.name}:${rule.name}`,
    title: rule.name,
    folderUID: "prometheus",
    ruleGroup: group.name,
    for: formatFor(rule.duration),
    severity: rule.labels?.severity || "warning",
    isPaused: false,
    state: rule.state || "inactive",
    condition: rule.annotations?.summary || query.slice(0, 120),
    expr: query.slice(0, 180),
    deletable: false,
    source: "prometheus",
  };
}

async function prometheusAlertRules() {
  const result = await fetchJson(`${PROM_URL}/api/v1/rules`);
  if (!result.ok) {
    throw new Error(
      result.body?.error || result.body?.raw || `Prometheus HTTP ${result.status}`
    );
  }
  const groups = result.body?.data?.groups || [];
  const rules = [];
  for (const group of groups) {
    if (!String(group.name || "").startsWith("chronicles.")) continue;
    for (const rule of group.rules || []) {
      if (rule.type && rule.type !== "alerting") continue;
      if (!rule.name) continue;
      rules.push(summarizePrometheusRule(group, rule));
    }
  }
  rules.sort((a, b) => {
    const ia = CHRONICLES_ALERT_ORDER.indexOf(a.title);
    const ib = CHRONICLES_ALERT_ORDER.indexOf(b.title);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return rules;
}

function summarizeRule(rule) {
  const severity = rule.labels?.severity || "—";
  const expr =
    rule.data?.find((d) => d.refId === "A")?.model?.expr ||
    rule.data?.[0]?.model?.expr ||
    "";
  const threshold =
    rule.data?.find((d) => d.refId === "C")?.model?.conditions?.[0]?.evaluator
      ?.params?.[0] ?? null;
  return {
    uid: rule.uid,
    title: rule.title,
    folderUID: rule.folderUID,
    ruleGroup: rule.ruleGroup,
    for: rule.for,
    severity,
    isPaused: Boolean(rule.isPaused),
    state: rule.isPaused ? "paused" : "active",
    condition: threshold != null ? `threshold ${threshold}` : "expression",
    expr: String(expr).slice(0, 160),
    deletable: String(rule.uid || "").startsWith("dash-"),
    source: "grafana",
  };
}

export function createObserveRouter() {
  const router = Router();

  /** Ingress controller, route, and end-to-end checks. */
  router.get("/ingress", async (_req, res) => {
    try {
      const facts = await gatherTopologyFacts();
      const ingress = facts.nodes?.ingress || null;
      if (!ingress) {
        res.status(502).json({ error: "Ingress status is not available" });
        return;
      }
      res.json(ingress);
    } catch (err) {
      res.status(502).json({ error: err.message || String(err) });
    }
  });

  /** Dashboard host vitals — free RAM, disk, load. */
  router.get("/host", async (_req, res) => {
    try {
      const stats = await getHostStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  router.get("/metrics", async (req, res) => {
    const range = String(req.query.range || "1h");
    if (!METRIC_RANGES.has(range)) {
      res.status(400).json({ error: "Invalid range. Use 15m|1h|6h|24h" });
      return;
    }

    const { start, end, step } = await rangeWindow(range);
    try {
      const panels = await Promise.all(
        METRIC_PANELS.map(async (panel) => {
          const series = [];
          let panelError = null;
          const results = await Promise.all(
            panel.queries.map(async (q) => {
              try {
                const result = await queryRange(
                  q.expr,
                  start,
                  end,
                  panel.step || step
                );
                return { ok: true, series: seriesFromResult(result, q.legend) };
              } catch (err) {
                return {
                  ok: false,
                  error: err.message || String(err),
                  series: [],
                };
              }
            })
          );
          for (const r of results) {
            series.push(...r.series);
            if (!r.ok && !panelError) panelError = r.error;
          }
          return {
            id: panel.id,
            title: panel.title,
            unit: panel.unit,
            series,
            empty:
              series.length === 0 ||
              series.every((s) => s.points.length === 0),
            error: panelError,
          };
        })
      );
      res.json({ range, from: start, to: end, panels });
    } catch (err) {
      res.status(502).json({ error: err.message || String(err) });
    }
  });

  router.get("/logs", async (req, res) => {
    const range = String(req.query.range || "1h");
    const source = String(req.query.source || "all");
    const host = String(req.query.host || "").trim().slice(0, 64);
    const severity = String(req.query.severity || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim().slice(0, 120);
    const size = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.size || "50"), 10) || 50)
    );

    if (!LOG_RANGES.has(range)) {
      res.status(400).json({ error: "Invalid range. Use 15m|1h|6h|24h" });
      return;
    }
    if (!LOG_SOURCES.has(source)) {
      res.status(400).json({ error: "Invalid source. Use all|system|app|docker" });
      return;
    }
    if (severity && !["info", "warn", "warning", "error", "critical", "debug"].includes(severity)) {
      res.status(400).json({ error: "Invalid severity" });
      return;
    }

    const body = buildLogQuery({
      range,
      host: host || null,
      source,
      severity: severity || null,
      q: q || null,
      size,
    });

    try {
      const result = await fetchJson(`${ES_URL}/chronicles*/_search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: 25000,
      });
      if (!result.ok) {
        const msg =
          result.body?.error?.reason ||
          result.body?.error?.type ||
          result.body?.raw ||
          `Elasticsearch HTTP ${result.status}`;
        res.status(502).json({ error: String(msg).slice(0, 200) });
        return;
      }

      const hits = result.body?.hits?.hits || [];
      const total =
        typeof result.body?.hits?.total === "object"
          ? result.body.hits.total.value
          : result.body?.hits?.total ?? hits.length;

      res.json({
        range,
        source,
        host: host || null,
        severity: severity || null,
        q: q || null,
        total,
        hits: hits.map(mapHit),
      });
    } catch (err) {
      res.status(502).json({ error: err.message || String(err) });
    }
  });

  router.get("/alerts", async (_req, res) => {
    const presets = Object.entries(ALERT_PRESETS).map(([id, p]) => ({
      id,
      title: p.title,
      defaultFor: p.defaultFor,
      defaultThreshold: p.defaultThreshold,
      comparator: p.comparator,
    }));

    let grafanaRules = [];
    let grafanaError = null;
    try {
      const result = await fetchJson(
        `${GRAFANA_URL}/api/v1/provisioning/alert-rules`,
        { headers: { Authorization: grafanaAuthHeader() } }
      );
      if (!result.ok) {
        grafanaError =
          result.body?.message ||
          result.body?.raw ||
          `Grafana HTTP ${result.status}`;
      } else {
        const rules = Array.isArray(result.body) ? result.body : [];
        grafanaRules = rules.map(summarizeRule);
      }
    } catch (err) {
      grafanaError = err.message || String(err);
    }

    let promRules = [];
    let promError = null;
    try {
      promRules = await prometheusAlertRules();
    } catch (err) {
      promError = err.message || String(err);
    }

    if (!promRules.length && !grafanaRules.length && (promError || grafanaError)) {
      res.status(502).json({ error: promError || grafanaError });
      return;
    }

    res.json({
      rules: [...promRules, ...grafanaRules],
      presets,
      warning: [promError, grafanaError].filter(Boolean).join(" ") || null,
    });
  });

  router.post("/alerts", async (req, res) => {
    const preset = String(req.body?.preset || "");
    const presetDef = ALERT_PRESETS[preset];
    if (!presetDef) {
      res.status(400).json({
        error: `Invalid preset. Use ${Object.keys(ALERT_PRESETS).join("|")}`,
      });
      return;
    }

    const title = String(req.body?.title || presetDef.title)
      .trim()
      .slice(0, 120);
    if (!title) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    const threshold = Number(req.body?.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100000) {
      res.status(400).json({ error: "Threshold must be a number" });
      return;
    }

    const forDuration = String(
      req.body?.forDuration || presetDef.defaultFor || "5m"
    );
    if (!FOR_DURATIONS.has(forDuration) && forDuration !== "0m") {
      res.status(400).json({ error: "Invalid forDuration" });
      return;
    }

    const severity = String(req.body?.severity || "warning").toLowerCase();
    if (!SEVERITIES.has(severity)) {
      res.status(400).json({ error: "Invalid severity. Use info|warning|critical" });
      return;
    }

    try {
      const folder = await ensureAlertFolder();
      const uid = `dash-${randomBytes(6).toString("hex")}`;
      const rule = buildAlertRule({
        uid,
        folderUid: folder.uid,
        title,
        preset,
        threshold,
        forDuration,
        severity,
      });

      const created = await fetchJson(
        `${GRAFANA_URL}/api/v1/provisioning/alert-rules`,
        {
          method: "POST",
          headers: {
            Authorization: grafanaAuthHeader(),
            "Content-Type": "application/json",
            "X-Disable-Provenance": "true",
          },
          body: JSON.stringify(rule),
        }
      );

      if (!created.ok) {
        res.status(502).json({
          error: String(
            created.body?.message ||
              created.body?.raw ||
              `Grafana create HTTP ${created.status}`
          ).slice(0, 240),
        });
        return;
      }

      res.status(201).json({ ok: true, rule: summarizeRule(created.body || rule) });
    } catch (err) {
      res.status(502).json({ error: err.message || String(err) });
    }
  });

  router.delete("/alerts/:uid", async (req, res) => {
    const uid = String(req.params.uid || "");
    if (!uid.startsWith("dash-")) {
      res.status(403).json({
        error: "Only dashboard-created alerts (uid dash-*) can be deleted here",
      });
      return;
    }

    try {
      const result = await fetchJson(
        `${GRAFANA_URL}/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: grafanaAuthHeader(),
            "X-Disable-Provenance": "true",
          },
        }
      );
      if (!result.ok && result.status !== 404) {
        res.status(502).json({
          error:
            result.body?.message ||
            result.body?.raw ||
            `Grafana delete HTTP ${result.status}`,
        });
        return;
      }
      res.json({ ok: true, uid });
    } catch (err) {
      res.status(502).json({ error: err.message || String(err) });
    }
  });

  return router;
}
