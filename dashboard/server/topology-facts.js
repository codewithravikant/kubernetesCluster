/**
 * Live topology facts for dashboard tooltips.
 * Reads Minikube / kubectl / Docker / Prometheus on the lab host.
 * Never reports SSH-tunnel laptop addresses — only cluster and host facts.
 */

import { spawn } from "node:child_process";
import { profileName } from "./k8s.js";
import { readIngressStatus } from "./ingress-status.js";
import { ROOT } from "./machines.js";

const PROM_URL = (
  process.env.OBSERVE_PROM_URL || "http://127.0.0.1:9090"
).replace(/\/$/, "");

const CACHE_MS = 20_000;
let cache = { at: 0, value: null };

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        stdout,
        stderr: stderr || `timed out`,
      });
    }, opts.timeoutMs || 8000);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (err) => {
      finish({ ok: false, stdout, stderr: err.message });
    });
  });
}

function emptyFacts() {
  return {
    updatedAt: new Date().toISOString(),
    minikubeIp: null,
    nodeName: null,
    docker: {
      api: "unknown",
      containers: null,
      images: null,
    },
    services: {},
    pods: {},
    scrape: {
      status: "unavailable",
      up: 0,
      total: 0,
      byNode: {},
    },
  };
}

async function readMinikubeIp(profile) {
  const r = await run("minikube", ["ip", "-p", profile], { timeoutMs: 6000 });
  if (!r.ok) return null;
  const ip = r.stdout.trim();
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null;
}

async function readNodeMeta() {
  const r = await run(
    "kubectl",
    ["get", "nodes", "-o", "json"],
    { timeoutMs: 10000 }
  );
  if (!r.ok) return { name: null, internalIp: null };
  try {
    const doc = JSON.parse(r.stdout);
    const node = doc.items?.[0];
    if (!node) return { name: null, internalIp: null };
    const addrs = node.status?.addresses || [];
    const internal =
      addrs.find((a) => a.type === "InternalIP")?.address || null;
    return { name: node.metadata?.name || null, internalIp: internal };
  } catch {
    return { name: null, internalIp: null };
  }
}

async function readServices() {
  const r = await run(
    "kubectl",
    ["get", "svc", "-A", "-o", "json"],
    { timeoutMs: 12000 }
  );
  const out = {};
  if (!r.ok) return out;
  try {
    const doc = JSON.parse(r.stdout);
    for (const svc of doc.items || []) {
      const ns = svc.metadata?.namespace;
      const name = svc.metadata?.name;
      if (!ns || !name) continue;
      const ports = (svc.spec?.ports || [])
        .map((p) => {
          const port = p.port;
          const proto = p.protocol || "TCP";
          const target = p.targetPort != null ? `→${p.targetPort}` : "";
          return `${port}/${proto}${target}`;
        })
        .join(", ");
      out[`${ns}/${name}`] = {
        clusterIP: svc.spec?.clusterIP || null,
        type: svc.spec?.type || null,
        ports: ports || null,
        externalIPs: svc.spec?.externalIPs || [],
      };
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function readPodIps() {
  const r = await run(
    "kubectl",
    ["get", "pods", "-A", "-o", "json"],
    { timeoutMs: 12000 }
  );
  const out = {};
  if (!r.ok) return out;
  try {
    const doc = JSON.parse(r.stdout);
    for (const pod of doc.items || []) {
      const ns = pod.metadata?.namespace;
      const name = pod.metadata?.name;
      if (!ns || !name) continue;
      const labels = pod.metadata?.labels || {};
      const app =
        labels.app ||
        labels["app.kubernetes.io/name"] ||
        labels["app.kubernetes.io/component"] ||
        null;
      out[`${ns}/${name}`] = {
        ip: pod.status?.podIP || null,
        node: pod.spec?.nodeName || null,
        phase: pod.status?.phase || null,
        app,
      };
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function readDocker() {
  const info = await run("docker", ["info", "--format", "{{json .}}"], {
    timeoutMs: 6000,
  });
  if (!info.ok) {
    return { api: "unavailable", containers: null, images: null };
  }
  try {
    const j = JSON.parse(info.stdout);
    return {
      api: "available",
      containers: Number(j.Containers ?? j.ContainersRunning ?? null),
      containersRunning: Number(j.ContainersRunning ?? null),
      images: Number(j.Images ?? null),
    };
  } catch {
    const ps = await run("docker", ["ps", "-q"], { timeoutMs: 5000 });
    if (!ps.ok) return { api: "available", containers: null, images: null };
    const n = ps.stdout
      .trim()
      .split("\n")
      .filter(Boolean).length;
    return { api: "available", containers: n, images: null };
  }
}

function classifyTarget(scrapeUrl, labels = {}) {
  const job = String(labels.job || "");
  const u = String(scrapeUrl || "");
  if (
    labels.namespace === "ingress-nginx" ||
    labels.ingress === "chronicles" ||
    /ingress-nginx/i.test(job)
  ) {
    return "ingress";
  }
  if (/kubelet|node|kubernetes-nodes|apiserver|cadvisor/i.test(job + u)) {
    return "minikube";
  }
  if (/backend/i.test(job + u) || labels.namespace === "app") {
    if (/frontend/i.test(job + u)) return "frontend";
    return "backend";
  }
  if (/logging|elasticsearch|fluent|kibana/i.test(job + u + (labels.namespace || ""))) {
    return "logging";
  }
  if (/jenkins|cicd/i.test(job + u + (labels.namespace || ""))) {
    return "cicd";
  }
  if (/prometheus|grafana|alertmanager|monitoring/i.test(job + u + (labels.namespace || ""))) {
    return "monitoring";
  }
  return null;
}

async function readScrapeHealth() {
  const byNode = {};
  try {
    const res = await fetch(`${PROM_URL}/api/v1/targets?state=active`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { status: "unavailable", up: 0, total: 0, byNode };
    }
    const body = await res.json();
    const active = body?.data?.activeTargets || [];
    let up = 0;
    for (const t of active) {
      const health = String(t.health || "").toLowerCase();
      if (health === "up") up += 1;
      const nodeId = classifyTarget(t.scrapeUrl, t.labels || {});
      if (!nodeId) continue;
      if (!byNode[nodeId]) byNode[nodeId] = { up: 0, total: 0, health: "unknown" };
      byNode[nodeId].total += 1;
      if (health === "up") byNode[nodeId].up += 1;
    }
    for (const id of Object.keys(byNode)) {
      const s = byNode[id];
      if (s.total === 0) s.health = "unknown";
      else if (s.up === s.total) s.health = "healthy";
      else if (s.up === 0) s.health = "unavailable";
      else s.health = "degraded";
    }
    return {
      status: active.length ? "monitored" : "unavailable",
      up,
      total: active.length,
      byNode,
    };
  } catch {
    return { status: "unavailable", up: 0, total: 0, byNode };
  }
}

function pickService(services, ...keys) {
  for (const k of keys) {
    if (services[k]) return { key: k, ...services[k] };
  }
  return null;
}

function podsForApp(pods, ns, appNeedle) {
  const list = [];
  for (const [key, p] of Object.entries(pods)) {
    if (!key.startsWith(`${ns}/`)) continue;
    if (
      appNeedle &&
      !(
        (p.app && String(p.app).includes(appNeedle)) ||
        key.includes(appNeedle)
      )
    ) {
      continue;
    }
    list.push({ name: key.slice(ns.length + 1), ...p });
  }
  return list;
}

/**
 * Compact per-node payload for the topology tooltip UI.
 */
function projectNodes(facts) {
  const svcFrontend = pickService(facts.services, "app/frontend");
  const svcBackend = pickService(facts.services, "app/backend");
  const svcJenkins = pickService(
    facts.services,
    "cicd/jenkins",
    "cicd/cicd-jenkins",
    "cicd/jenkins-operator-http"
  );
  const svcIngress = pickService(
    facts.services,
    "ingress-nginx/ingress-nginx-controller"
  );
  const svcProm = pickService(
    facts.services,
    "monitoring/kps-prometheus",
    "monitoring/prometheus-operated",
    "monitoring/prometheus-kube-prometheus-prometheus"
  );
  const svcGrafana = pickService(
    facts.services,
    "monitoring/kps-grafana",
    "monitoring/prometheus-grafana"
  );

  const fePods = podsForApp(facts.pods, "app", "frontend");
  const bePods = podsForApp(facts.pods, "app", "backend");

  const scrapeOf = (id) => facts.scrape.byNode[id] || null;

  return {
    host: {
      ip: null,
      hostname: null,
      dockerApi: facts.docker.api,
      containers: facts.docker.containers,
      containersRunning: facts.docker.containersRunning ?? null,
      images: facts.docker.images,
      monitoring: "not_monitored",
      health:
        facts.docker.api === "available"
          ? "healthy"
          : facts.docker.api === "unavailable"
            ? "unavailable"
            : "unknown",
    },
    minikube: {
      ip: facts.minikubeIp || facts.nodeInternalIp || null,
      hostname: facts.nodeName || "chronicles",
      monitoring: scrapeOf("minikube")
        ? "monitored"
        : facts.scrape.status === "monitored"
          ? "monitored"
          : facts.scrape.status === "unavailable"
            ? "monitoring_unavailable"
            : "unknown",
      health:
        scrapeOf("minikube")?.health ||
        (facts.minikubeIp ? "healthy" : "unknown"),
      scrape: scrapeOf("minikube"),
    },
    ingress: {
      ip: facts.ingressStatus?.ip || svcIngress?.clusterIP || null,
      hostname: facts.ingressStatus?.hostname || "chronicles.local",
      ports: facts.ingressStatus?.ports || svcIngress?.ports || "80/TCP",
      protocol: facts.ingressStatus?.protocol || "HTTP",
      endpoint: facts.ingressStatus?.endpoint || "http://chronicles.local/",
      type: svcIngress?.type || null,
      monitoring:
        facts.ingressStatus?.monitoring ||
        (scrapeOf("ingress")?.up > 0 ? "monitored" : "not_monitored"),
      health:
        facts.ingressStatus?.health ||
        scrapeOf("ingress")?.health ||
        (svcIngress ? "healthy" : "unknown"),
      details: facts.ingressStatus?.details || [],
    },
    frontend: {
      ip: svcFrontend?.clusterIP || null,
      podIps: fePods.map((p) => p.ip).filter(Boolean),
      hostname: "frontend.app.svc.cluster.local",
      ports: svcFrontend?.ports || "80/TCP",
      monitoring: scrapeOf("frontend") ? "monitored" : "not_monitored",
      health: scrapeOf("frontend")?.health || (svcFrontend ? "healthy" : "unknown"),
      pods: fePods.length,
    },
    backend: {
      ip: svcBackend?.clusterIP || null,
      podIps: bePods.map((p) => p.ip).filter(Boolean),
      hostname: "backend.app.svc.cluster.local",
      ports: svcBackend?.ports || "3000/TCP",
      monitoring: scrapeOf("backend") ? "monitored" : "not_monitored",
      health: scrapeOf("backend")?.health || (svcBackend ? "healthy" : "unknown"),
      pods: bePods.length,
      scrape: scrapeOf("backend"),
    },
    app: {
      ip: null,
      services: [svcFrontend, svcBackend].filter(Boolean).map((s) => s.clusterIP),
      monitoring: "partial",
      health:
        svcFrontend && svcBackend
          ? "healthy"
          : svcFrontend || svcBackend
            ? "degraded"
            : "unknown",
    },
    monitoring: {
      ip: svcProm?.clusterIP || null,
      grafanaIp: svcGrafana?.clusterIP || null,
      ports: svcProm?.ports || null,
      monitoring: "monitored",
      health:
        facts.scrape.status === "monitored"
          ? "healthy"
          : facts.scrape.status === "unavailable"
            ? "unavailable"
            : "unknown",
      scrapeSummary:
        facts.scrape.total > 0
          ? `${facts.scrape.up}/${facts.scrape.total} targets up`
          : null,
    },
    logging: {
      ip:
        pickService(
          facts.services,
          "logging/elasticsearch-http",
          "logging/elasticsearch"
        )?.clusterIP || null,
      monitoring: scrapeOf("logging") ? "monitored" : "unknown",
      health: scrapeOf("logging")?.health || "unknown",
      scrape: scrapeOf("logging"),
    },
    cicd: {
      ip: svcJenkins?.clusterIP || null,
      ports: svcJenkins?.ports || "8080/TCP",
      hostname: svcJenkins
        ? `${svcJenkins.key.split("/")[1]}.cicd.svc.cluster.local`
        : null,
      monitoring: scrapeOf("cicd") ? "monitored" : "unknown",
      health: svcJenkins ? "healthy" : "unknown",
    },
  };
}

export async function gatherTopologyFacts({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < CACHE_MS) {
    return cache.value;
  }

  const profile = profileName();
  const base = emptyFacts();

  const [minikubeIp, nodeMeta, services, pods, docker, scrape, ingressStatus] =
    await Promise.all([
      readMinikubeIp(profile),
      readNodeMeta(),
      readServices(),
      readPodIps(),
      readDocker(),
      readScrapeHealth(),
      readIngressStatus().catch(() => null),
    ]);

  base.minikubeIp = minikubeIp;
  base.nodeName = nodeMeta.name;
  base.nodeInternalIp = nodeMeta.internalIp;
  base.services = services;
  base.pods = pods;
  base.docker = docker;
  base.scrape = scrape;
  base.ingressStatus = ingressStatus;
  base.nodes = projectNodes(base);

  cache = { at: now, value: base };
  return base;
}
