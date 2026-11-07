import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const CLUSTER_YML = path.join(ROOT, "config/cluster.yml");

const MAX_CPUS = 8;
const MAX_MEMORY_MB = 18432;

export const MEMORY_OPTIONS = [8192, 10240, 12288, 14336, 16384, 18432];
export const CPU_OPTIONS = [2, 3, 4, 6, 8];

const NAMESPACES = [
  { name: "app", role: "Application", httpPort: null },
  { name: "monitoring", role: "Monitoring", httpPort: null },
  { name: "logging", role: "Logging", httpPort: null },
  { name: "cicd", role: "CI/CD", httpPort: 8080 },
];

export function loadClusterDoc() {
  const raw = fs.readFileSync(CLUSTER_YML, "utf8");
  return YAML.parse(raw);
}

export function loadMachines() {
  const doc = loadClusterDoc();
  return NAMESPACES.map((ns) => ({
    name: ns.name,
    ip: ns.name,
    memory: doc.memory_mb,
    cpus: doc.cpus,
    role: ns.role,
    httpPort: ns.httpPort,
    kind: "namespace",
  }));
}

export function getMachine(name) {
  return loadMachines().find((m) => m.name === name) || null;
}

export function hasPrivateKey() {
  return false;
}

export function updateMachineResources(name, { memory, cpus }) {
  // Cluster-wide sizing — name is ignored (kept for API compat).
  const doc = loadClusterDoc();
  if (memory != null) {
    const m = Number(memory);
    if (!MEMORY_OPTIONS.includes(m) || m > MAX_MEMORY_MB) {
      throw new Error(`memory must be one of ${MEMORY_OPTIONS.join(", ")} (cap ${MAX_MEMORY_MB})`);
    }
    doc.memory_mb = m;
  }
  if (cpus != null) {
    const c = Number(cpus);
    if (!CPU_OPTIONS.includes(c) || c > MAX_CPUS) {
      throw new Error(`cpus must be one of ${CPU_OPTIONS.join(", ")} (cap ${MAX_CPUS})`);
    }
    doc.cpus = c;
  }
  fs.writeFileSync(CLUSTER_YML, YAML.stringify(doc));
  return {
    name: name || "cluster",
    memory: doc.memory_mb,
    cpus: doc.cpus,
    role: "Minikube",
    profile: doc.profile,
  };
}

export function getClusterConfig() {
  return loadClusterDoc();
}
