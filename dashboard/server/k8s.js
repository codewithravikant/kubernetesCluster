import { spawn } from "node:child_process";
import { ROOT, loadClusterDoc } from "./machines.js";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
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
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          finish({
            ok: false,
            code: 1,
            stdout,
            stderr: stderr || `timed out after ${opts.timeoutMs}ms`,
          });
        }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, code, stdout, stderr });
    });
    child.on("error", (err) => {
      finish({ ok: false, code: 1, stdout, stderr: err.message });
    });
  });
}

export function profileName() {
  try {
    return loadClusterDoc().profile || "chronicles";
  } catch {
    return "chronicles";
  }
}

export async function minikubeStatusMap() {
  const profile = profileName();
  const st = await run("minikube", ["status", "-p", profile, "-o", "json"]);
  let running = false;
  if (st.ok) {
    try {
      const parsed = JSON.parse(st.stdout);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      running = items.some((i) => String(i.Host || i.host || "").toLowerCase() === "running");
    } catch {
      running = /Running/i.test(st.stdout);
    }
  }

  const map = {};
  for (const ns of ["app", "monitoring", "logging", "cicd"]) {
    map[ns] = running ? "running" : "stopped";
  }
  return { map, running, profile };
}

export async function namespacePodSummary(ns) {
  const r = await run("kubectl", [
    "get",
    "pods",
    "-n",
    ns,
    "-o",
    "jsonpath={range .items[*]}{.metadata.name}{.status.phase} {end}",
  ]);
  if (!r.ok) return { ready: 0, total: 0, detail: r.stderr || "unavailable" };
  const tokens = r.stdout.trim().split(/\s+/).filter(Boolean);
  // jsonpath without separators is awkward; fall back to get pods --no-headers
  const list = await run("kubectl", ["get", "pods", "-n", ns, "--no-headers"]);
  if (!list.ok) return { ready: 0, total: 0, detail: list.stderr };
  const lines = list.stdout.trim() ? list.stdout.trim().split("\n") : [];
  let ready = 0;
  for (const line of lines) {
    if (/\sRunning\s/.test(line) || /\sCompleted\s/.test(line)) ready += 1;
  }
  return { ready, total: lines.length, detail: list.stdout.trim(), tokens };
}

export async function listNamespacePods(ns) {
  const r = await run("kubectl", ["get", "pods", "-n", ns, "-o", "json"], {
    timeoutMs: 20000,
  });
  if (!r.ok) {
    const error = (r.stderr || r.stdout || "kubectl failed").trim();
    return { ok: false, error, pods: [] };
  }
  let doc;
  try {
    doc = JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: "kubectl returned invalid JSON", pods: [] };
  }
  const pods = (doc.items || []).map((item) => {
    const containers = (item.spec?.containers || []).map((c) => c.name);
    const statuses = item.status?.containerStatuses || [];
    const readyCount = statuses.filter((s) => s.ready).length;
    return {
      name: item.metadata?.name || "",
      phase: item.status?.phase || "Unknown",
      ready: `${readyCount}/${containers.length || 0}`,
      containers,
    };
  });
  return { ok: true, pods };
}

export async function runVerify() {
  return run("bash", ["scripts/verify.sh"], { cwd: ROOT });
}

export async function runKubectl(args) {
  return run("kubectl", args);
}

export async function applyClusterResources() {
  // Restart Minikube with new CPU/RAM from config/cluster.yml
  const doc = loadClusterDoc();
  const profile = doc.profile || "chronicles";
  await run("minikube", ["stop", "-p", profile]);
  return run("minikube", [
    "start",
    "-p",
    profile,
    `--cpus=${doc.cpus}`,
    `--memory=${doc.memory_mb}`,
    `--disk-size=${doc.disk_size_gb}g`,
    `--driver=${doc.driver || "docker"}`,
  ]);
}

export async function runClusterAction(action, name) {
  if (action === "reload") return applyClusterResources();
  if (action === "halt") return run("minikube", ["stop", "-p", profileName()]);
  if (action === "destroy") return run("minikube", ["delete", "-p", profileName()]);
  if (action === "up") return run("bash", ["scripts/chronicles.sh"], { cwd: ROOT });
  return { ok: false, code: 1, stdout: "", stderr: `Unsupported action ${action} for ${name}` };
}

export async function pingHost() {
  return { ok: true };
}

export async function checkHttp() {
  return { ok: false };
}
