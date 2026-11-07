/**
 * Live Ingress status for the topology tooltip and Observe page.
 * Uses kubectl on the lab host and Prometheus on 127.0.0.1:9090.
 */

import { spawn } from "node:child_process";
import { profileName } from "./k8s.js";
import { ROOT } from "./machines.js";

const PROM_URL = (
  process.env.OBSERVE_PROM_URL || "http://127.0.0.1:9090"
).replace(/\/$/, "");

const HOST = "chronicles.local";

function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, stdout, stderr: stderr || "timed out" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => finish({ ok: code === 0, stdout, stderr }));
    child.on("error", (err) =>
      finish({ ok: false, stdout, stderr: err.message })
    );
  });
}

async function kubectlJson(args) {
  const r = await run("kubectl", [...args, "-o", "json"], 12000);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

async function promVector(expr) {
  try {
    const res = await fetch(
      `${PROM_URL}/api/v1/query?${new URLSearchParams({ query: expr })}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const body = await res.json();
    return body?.data?.result || [];
  } catch {
    return [];
  }
}

function firstNumber(series) {
  if (!series?.length) return null;
  const n = Number(series[0]?.value?.[1]);
  return Number.isFinite(n) ? n : null;
}

function sumNumbers(series) {
  if (!series?.length) return null;
  let n = 0;
  let any = false;
  for (const s of series) {
    const v = Number(s?.value?.[1]);
    if (!Number.isFinite(v)) continue;
    n += v;
    any = true;
  }
  return any ? n : null;
}

function formatCpu(cores) {
  if (cores == null) return "Unknown";
  const milli = cores * 1000;
  if (milli < 10) return `${milli.toFixed(1)}m`;
  return `${Math.round(milli)}m`;
}

function formatBytes(n) {
  if (n == null) return "Unknown";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.round(n / 1024)} KiB`;
}

function formatRate(n) {
  if (n == null) return "No samples yet";
  return `${n.toFixed(3)} /s`;
}

function formatLatency(n) {
  if (n == null) return "No samples yet";
  if (n < 1) return `${Math.round(n * 1000)} ms`;
  return `${n.toFixed(3)} s`;
}

function httpText(code) {
  if (code == null) return "No response";
  return `HTTP ${code}`;
}

async function externalViaHost() {
  const ipr = await run("minikube", ["ip", "-p", profileName()], 6000);
  const ip = ipr.ok ? ipr.stdout.trim() : "";
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return { ip: null, root: null, api: null };
  }
  const [root, api] = await Promise.all([
    curlHost(ip, "/"),
    curlHost(ip, "/api/health"),
  ]);
  return { ip, root, api };
}

async function curlHost(ip, path) {
  if (!ip) return null;
  const r = await run(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--max-time",
      "5",
      "-H",
      `Host: ${HOST}`,
      `http://${ip}${path}`,
    ],
    7000
  );
  if (!r.ok && !r.stdout.trim()) return null;
  const code = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(code) ? code : null;
}

async function clusterProbe() {
  const r = await run(
    "kubectl",
    [
      "exec",
      "-n",
      "ingress-nginx",
      "deploy/ingress-nginx-controller",
      "--",
      "sh",
      "-c",
      "r=$(wget -q -S -O /dev/null -T 4 http://chronicles.local/ 2>&1 | awk '/^  HTTP/{print $2; exit}'); a=$(wget -q -S -O /dev/null -T 4 http://chronicles.local/api/health 2>&1 | awk '/^  HTTP/{print $2; exit}'); printf '%s %s\n' \"$r\" \"$a\"",
    ],
    15000
  );
  const parts = r.stdout.trim().split(/\s+/);
  const root = Number.parseInt(parts[0], 10);
  const api = Number.parseInt(parts[1], 10);
  return {
    root: Number.isFinite(root) ? root : null,
    api: Number.isFinite(api) ? api : null,
  };
}

function ruleText(spec) {
  const rules = spec?.rules || [];
  if (!rules.length) return "No rules";
  return rules
    .map((rule) => {
      const host = rule.host || "*";
      const paths = (rule.http?.paths || []).map((p) => {
        const svc = p.backend?.service?.name || "?";
        const port =
          p.backend?.service?.port?.number ||
          p.backend?.service?.port?.name ||
          "?";
        return `${p.path || "/"} → ${svc}:${port}`;
      });
      return `${host} ${paths.join(", ") || "(no paths)"}`;
    })
    .join(" · ");
}

function tlsText(spec) {
  const tls = spec?.tls || [];
  if (!tls.length) return "Not enabled";
  return tls
    .map((item) => {
      const hosts = (item.hosts || []).join(", ") || HOST;
      return `${hosts} (secret ${item.secretName || "unset"})`;
    })
    .join("; ");
}

function certText(expireUnix, tlsEnabled) {
  if (!tlsEnabled) return "n/a (TLS is not enabled)";
  if (expireUnix == null) return "Unknown";
  const ms = expireUnix * 1000;
  const days = (ms - Date.now()) / 86400000;
  const when = new Date(ms).toISOString().slice(0, 10);
  if (days < 0) return `Expired ${when}`;
  return `${when} (${Math.round(days)} days left)`;
}

function endpointCounts(doc) {
  let ready = 0;
  let total = 0;
  for (const slice of doc?.items || []) {
    for (const ep of slice.endpoints || []) {
      const n = (ep.addresses || []).length;
      total += n;
      if (ep.conditions?.ready) ready += n;
    }
  }
  return { ready, total };
}

function controllerSummary(doc) {
  const pods = (doc?.items || []).filter((p) =>
    String(p.metadata?.name || "").startsWith("ingress-nginx-controller-")
  );
  let ready = 0;
  let restarts = 0;
  for (const pod of pods) {
    const statuses = pod.status?.containerStatuses || [];
    if (
      pod.status?.phase === "Running" &&
      statuses.length > 0 &&
      statuses.every((s) => s.ready)
    ) {
      ready += 1;
    }
    for (const s of statuses) restarts += Number(s.restartCount || 0);
  }
  return {
    ready,
    total: pods.length,
    restarts,
    text:
      pods.length === 0
        ? "No controller pod"
        : `${ready}/${pods.length} ready · ${restarts} restart${restarts === 1 ? "" : "s"}`,
  };
}

export async function readIngressStatus() {
  const [ingress, slices, pods, monitor, external, cluster, prom] =
    await Promise.all([
      kubectlJson(["get", "ingress", "chronicles", "-n", "app"]),
      kubectlJson([
        "get",
        "endpointslices",
        "-n",
        "app",
        "-l",
        "kubernetes.io/service-name=frontend",
      ]),
      kubectlJson([
        "get",
        "pods",
        "-n",
        "ingress-nginx",
        "-l",
        "app.kubernetes.io/component=controller",
      ]),
      run(
        "kubectl",
        [
          "get",
          "servicemonitor",
          "ingress-nginx-controller",
          "-n",
          "ingress-nginx",
        ],
        8000
      ),
      externalViaHost(),
      clusterProbe(),
      Promise.all([
        promVector(
          'sum(rate(container_cpu_usage_seconds_total{namespace="ingress-nginx",container="controller",pod=~"ingress-nginx-controller-.+"}[5m]))'
        ),
        promVector(
          'sum(container_memory_working_set_bytes{namespace="ingress-nginx",container="controller",pod=~"ingress-nginx-controller-.+"})'
        ),
        promVector("sum(rate(nginx_ingress_controller_requests[5m]))"),
        promVector(
          'sum(rate(nginx_ingress_controller_requests{status=~"4.."}[5m])) or vector(0)'
        ),
        promVector(
          'sum(rate(nginx_ingress_controller_requests{status=~"5.."}[5m])) or vector(0)'
        ),
        promVector(
          "histogram_quantile(0.95, sum by (le) (rate(nginx_ingress_controller_request_duration_seconds_bucket[5m])))"
        ),
        promVector('max(up{namespace="ingress-nginx"})'),
        promVector('probe_success{ingress="chronicles"}'),
        promVector("nginx_ingress_controller_ssl_expire_time_seconds"),
      ]),
    ]);

  const spec = ingress?.spec || {};
  const address =
    ingress?.status?.loadBalancer?.ingress?.[0]?.ip ||
    ingress?.status?.loadBalancer?.ingress?.[0]?.hostname ||
    null;
  const published = address || external.ip;
  const tlsEnabled = Array.isArray(spec.tls) && spec.tls.length > 0;
  const eps = endpointCounts(slices);
  const ctrl = controllerSummary(pods);
  const [
    cpuSeries,
    memSeries,
    rpsSeries,
    s4Series,
    s5Series,
    p95Series,
    upSeries,
    probeSeries,
    certSeries,
  ] = prom;

  const probes = {};
  for (const s of probeSeries) {
    const check = s.metric?.check;
    if (!check) continue;
    probes[check] = firstNumber([s]);
  }

  const extRoot = external.root;
  const extApi = external.api;

  const clusterRoot = cluster.root;
  const clusterApi = cluster.api;
  const dnsOk = clusterRoot != null;
  const frontendCode = clusterRoot ?? extRoot;
  const backendCode = clusterApi ?? extApi;
  const scrapeUp = firstNumber(upSeries) === 1;
  const monitorExists = monitor.ok;

  let monitoring = "not_monitored";
  if (scrapeUp) monitoring = "monitored";
  else if (monitorExists) monitoring = "partial";

  let health = "unknown";
  if (ctrl.total === 0 || ctrl.ready === 0) health = "unavailable";
  else if (
    frontendCode === 200 &&
    backendCode === 200 &&
    eps.ready > 0 &&
    dnsOk
  ) {
    health = "healthy";
  } else if (ctrl.ready > 0) health = "degraded";

  const reach =
    frontendCode == null
      ? "No response"
      : clusterRoot != null
        ? `${httpText(clusterRoot)} via http://${HOST}/`
        : `${httpText(extRoot)} via ${published || "ingress address"} (Host header)`;

  const backendPath =
    backendCode == null
      ? "No response"
      : clusterApi != null
        ? `${httpText(clusterApi)} via http://${HOST}/api/health`
        : `${httpText(extApi)} via ${published || "ingress address"}/api/health`;

  const dns =
    dnsOk
      ? `Resolves in the cluster (${httpText(clusterRoot)})`
      : "Does not resolve in the cluster";

  const https = tlsEnabled
    ? "Enabled"
    : "Not enabled";

  const details = [
    { label: "Class", value: spec.ingressClassName || "Unknown" },
    { label: "Address", value: published || "Unknown" },
    { label: "Rules", value: ruleText(spec) },
    { label: "Backend", value: "frontend:80" },
    {
      label: "Endpoints",
      value: slices ? `${eps.ready}/${eps.total} ready` : "Unknown",
    },
    { label: "TLS", value: tlsText(spec) },
    { label: "Certificate", value: certText(firstNumber(certSeries), tlsEnabled) },
    { label: "Controller", value: ctrl.text },
    { label: "CPU", value: formatCpu(firstNumber(cpuSeries)) },
    { label: "Memory", value: formatBytes(firstNumber(memSeries)) },
    { label: "Request rate", value: formatRate(sumNumbers(rpsSeries)) },
    { label: "Latency p95", value: formatLatency(firstNumber(p95Series)) },
    { label: "4xx", value: formatRate(sumNumbers(s4Series)) },
    { label: "5xx", value: formatRate(sumNumbers(s5Series)) },
    { label: "Frontend via Ingress", value: reach },
    { label: "Hostname", value: dns },
    { label: "HTTPS", value: https },
    { label: "Frontend → backend", value: backendPath },
  ];

  return {
    ip: published,
    hostname: spec.rules?.find((r) => r.host)?.host || HOST,
    ports: tlsEnabled ? "443 (HTTPS)" : "80 (HTTP)",
    protocol: tlsEnabled ? "HTTPS" : "HTTP",
    endpoint: `http://${HOST}/`,
    monitoring,
    health,
    metricsUp: scrapeUp,
    probes,
    details,
  };
}
