/**
 * Educational metadata for Network Topology nodes.
 * Live IPs / scrape / Docker facts come from /api/machines → topology.nodes
 * (server reads Minikube/kubectl/Docker). Tunnel loopbacks are never shown.
 */

export const ASSIGNED_DASHBOARD_HOST = "127.10.10.10";
export const ASSIGNED_INGRESS_HOST = "chronicles.local";

const LEARNING = {
  host: "A host machine provides CPU, memory, storage, and networking. Docker Engine runs on this host and starts containers for Minikube.",
  minikube: "Minikube runs a local single-node Kubernetes cluster. It is great for labs but is not production HA.",
  ingress: "Ingress defines HTTP/HTTPS routing from outside the cluster into Services. This lab uses the nginx ingress addon.",
  app: "A namespace isolates resources and RBAC. The app namespace holds frontend and backend workloads.",
  frontend: "A Deployment manages replica Pods. The frontend Service gives them a stable ClusterIP; Ingress routes external HTTP traffic here.",
  backend: "The backend Deployment runs one replica behind a ClusterIP Service on port 3000. Frontend calls it inside the cluster.",
  monitoring: "Prometheus scrapes time-series metrics; Grafana visualizes them; Alertmanager routes alerts.",
  logging: "The EFK path collects container logs (Fluent Bit), stores them (Elasticsearch), and explores them (Kibana).",
  cicd: "Jenkins automates build, scan, and deploy pipelines that push workloads into the app namespace.",
};

/** Static catalog keyed by topology node id. */
export const TOPO_CATALOG = {
  host: {
    name: "Host",
    type: "Host · Docker Engine",
    namespace: null,
    purpose: "Runs Docker Engine, which builds and manages containers for this lab.",
    role: "Provides the container runtime used by the Minikube Docker driver.",
    learning: LEARNING.host,
    network: {
      ip: null,
      hostname: null,
      ports: null,
      protocol: null,
      endpoint: `Dashboard bind ${ASSIGNED_DASHBOARD_HOST} (assigned loopback alias; not a tunnel)`,
    },
    monitoringHint: "none",
    connections: "Runs Minikube (Docker driver). Containers for the cluster live here.",
  },
  minikube: {
    name: "Minikube",
    type: "Kubernetes node",
    namespace: "kube-system (control plane)",
    purpose: "Single-node Kubernetes cluster (profile: chronicles).",
    role: "Schedules Pods, runs kubelet, and hosts cluster networking.",
    learning: LEARNING.minikube,
    network: {
      ip: null,
      hostname: "chronicles (Minikube profile)",
      ports: "API server (cluster-internal)",
      protocol: "HTTPS (API)",
      endpoint: null,
    },
    monitoringHint: "configured",
    connections: "Hosts Ingress and all namespace workloads. Scraped by Prometheus for node/kubelet/API metrics.",
  },
  ingress: {
    name: "Ingress",
    type: "Ingress controller · nginx addon",
    namespace: "ingress-nginx",
    purpose: "Routes external HTTP traffic into cluster Services.",
    role: "Exposes the frontend Service via host chronicles.local.",
    learning: LEARNING.ingress,
    network: {
      ip: null,
      hostname: ASSIGNED_INGRESS_HOST,
      ports: "80 (HTTP)",
      protocol: "HTTP",
      endpoint: `http://${ASSIGNED_INGRESS_HOST}/`,
    },
    monitoringHint: "none",
    connections:
      "Clients → Ingress → frontend:80. Prometheus scrapes controller :10254 and probes http://chronicles.local/ plus /api/health.",
  },
  app: {
    name: "ns: app",
    type: "Namespace",
    namespace: "app",
    purpose: "Application workloads — frontend and backend.",
    role: "Isolates app Deployments, Services, Ingress, HPA, and ServiceMonitor.",
    learning: LEARNING.app,
    network: {
      ip: null,
      hostname: null,
      ports: null,
      protocol: null,
      endpoint: null,
    },
    monitoringHint: "partial",
    connections: "Contains frontend and backend. Receives deploys from cicd; logs go to logging.",
  },
  frontend: {
    name: "frontend",
    type: "Deployment · Service",
    namespace: "app",
    purpose: "Serves the web UI; scaled with HPA (2+ replicas).",
    role: "Entry workload behind Ingress; talks to backend over HTTP.",
    learning: LEARNING.frontend,
    network: {
      ip: null,
      hostname: "frontend.app.svc.cluster.local",
      ports: "Service :80",
      protocol: "HTTP",
      endpoint: null,
    },
    monitoringHint: "none",
    connections: "Ingress → frontend → backend. Logs collected by Fluent Bit.",
  },
  backend: {
    name: "backend",
    type: "Deployment · Service",
    namespace: "app",
    purpose: "API and app logic; single replica by default.",
    role: "Provides the application API consumed by frontend.",
    learning: LEARNING.backend,
    network: {
      ip: null,
      hostname: "backend.app.svc.cluster.local",
      ports: "Service :3000",
      protocol: "HTTP",
      endpoint: null,
    },
    monitoringHint: "configured",
    connections: "Called by frontend. Scraped by Prometheus. Logs collected by Fluent Bit.",
  },
  monitoring: {
    name: "ns: monitoring",
    type: "Namespace",
    namespace: "monitoring",
    purpose: "Prometheus, Grafana, and Alertmanager.",
    role: "Cluster metrics collection, dashboards, and alerting.",
    learning: LEARNING.monitoring,
    network: {
      ip: null,
      hostname: null,
      ports: null,
      protocol: null,
      endpoint: null,
    },
    monitoringHint: "configured",
    connections: "Scrapes Minikube (node/kubelet/API), Ingress, backend, and logging targets.",
  },
  logging: {
    name: "ns: logging",
    type: "Namespace",
    namespace: "logging",
    purpose: "Fluent Bit, Elasticsearch, and Kibana (EFK).",
    role: "Centralized log collection, storage, and search.",
    learning: LEARNING.logging,
    network: {
      ip: null,
      hostname: null,
      ports: null,
      protocol: null,
      endpoint: null,
    },
    monitoringHint: "configured",
    connections: "Collects logs from app, monitoring, and cicd. Scraped by Prometheus for collector health.",
  },
  cicd: {
    name: "ns: cicd",
    type: "Namespace",
    namespace: "cicd",
    purpose: "Jenkins and the in-cluster registry.",
    role: "Builds, scans images, and deploys to the app namespace.",
    learning: LEARNING.cicd,
    network: {
      ip: null,
      hostname: null,
      ports: "Jenkins Service :8080",
      protocol: "HTTP",
      endpoint: null,
    },
    monitoringHint: "unknown",
    connections: "Deploys frontend and backend. Logs collected by Fluent Bit.",
  },
};

export function monitoringLabel(hint) {
  switch (hint) {
    case "monitored":
    case "configured":
      return "Monitored";
    case "not_monitored":
    case "none":
      return "Not monitored";
    case "monitoring_unavailable":
      return "Monitoring unavailable";
    case "partial":
      return "Partial";
    default:
      return "Unknown";
  }
}

export function healthFromMachine(machine) {
  if (!machine) return { label: "Unknown", tone: "muted" };
  const state = String(machine.state || "unknown");
  if (state === "running" && machine.reachable) {
    return { label: "Healthy", tone: "ok" };
  }
  if (state === "running" && !machine.reachable) {
    return { label: "Degraded", tone: "warn" };
  }
  if (
    state === "poweroff" ||
    state === "aborted" ||
    state === "not_created" ||
    state === "stopped"
  ) {
    return { label: "Unavailable", tone: "bad" };
  }
  return { label: "Unknown", tone: "muted" };
}

function healthFromLive(liveHealth, fallback) {
  if (!liveHealth) return fallback;
  switch (String(liveHealth).toLowerCase()) {
    case "healthy":
      return { label: "Healthy", tone: "ok" };
    case "degraded":
      return { label: "Degraded", tone: "warn" };
    case "unavailable":
      return { label: "Unavailable", tone: "bad" };
    default:
      return fallback;
  }
}

/**
 * Build tooltip view-model for a node.
 * @param {object} node - layout node
 * @param {object|null} machine - matching /api/machines entry when namespace
 * @param {Array} edges - topology edges for connection hints
 * @param {object|null} liveNode - topology.nodes[id] from server
 */
export function buildTooltipModel(node, machine, edges = [], liveNode = null) {
  const base = TOPO_CATALOG[node.id] || {
    name: node.label,
    type: node.kind || "Component",
    namespace: null,
    purpose: node.sub || "Topology component.",
    role: "Part of the Cluster Chronicles lab topology.",
    learning: "Select a known component for a focused learning note.",
    network: {
      ip: null,
      hostname: null,
      ports: null,
      protocol: null,
      endpoint: null,
    },
    monitoringHint: "unknown",
    connections: null,
  };

  const related = edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .map((e) => {
      const other = e.from === node.id ? e.to : e.from;
      return `${other} (${e.type})`;
    });

  const network = { ...base.network };
  if (machine?.ip && machine.ip !== "127.0.0.1") {
    network.namespaceId = machine.ip;
  }

  if (liveNode) {
    if (liveNode.ip) network.ip = liveNode.ip;
    if (liveNode.hostname) network.hostname = liveNode.hostname;
    if (liveNode.ports) network.ports = liveNode.ports;
    if (liveNode.protocol) network.protocol = liveNode.protocol;
    if (liveNode.endpoint) network.endpoint = liveNode.endpoint;
    if (liveNode.podIps?.length) {
      network.podIps = liveNode.podIps.join(", ");
    }
    if (liveNode.type) network.serviceType = liveNode.type;
    if (liveNode.dockerApi) {
      network.dockerApi =
        liveNode.dockerApi === "available"
          ? "Available"
          : liveNode.dockerApi === "unavailable"
            ? "Not available"
            : "Unknown";
    }
    if (liveNode.containers != null) {
      network.containers =
        liveNode.containersRunning != null
          ? `${liveNode.containersRunning} running / ${liveNode.containers} total`
          : String(liveNode.containers);
    }
    if (liveNode.grafanaIp) network.grafanaIp = liveNode.grafanaIp;
    if (liveNode.scrapeSummary) network.scrapeSummary = liveNode.scrapeSummary;
  }

  const monitoring = monitoringLabel(
    liveNode?.monitoring || base.monitoringHint
  );
  const health = healthFromLive(
    liveNode?.health,
    healthFromMachine(machine)
  );

  let extra = null;
  if (node.id === "host" && liveNode?.containers != null) {
    extra = `Docker containers: ${network.containers}`;
  }
  if (liveNode?.pods != null && (node.id === "frontend" || node.id === "backend")) {
    extra = `Workload pods: ${liveNode.pods}`;
  }

  return {
    id: node.id,
    name: base.name,
    type: base.type,
    namespace: base.namespace,
    purpose: base.purpose,
    role: base.role,
    learning: base.learning,
    monitoring,
    health,
    network,
    connections:
      base.connections ||
      (related.length ? related.join(" · ") : "Not available"),
    pods:
      machine && machine.podsTotal != null
        ? `${machine.podsReady ?? 0}/${machine.podsTotal} ready`
        : extra,
    extra,
    details: Array.isArray(liveNode?.details) ? liveNode.details : [],
  };
}
