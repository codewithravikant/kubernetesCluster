import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { ROOT } from "./machines.js";

export const LOGS_DIR = path.join(ROOT, "logs");
export const PROGRESS_JSON = path.join(LOGS_DIR, "lab-progress.json");
export const PROGRESS_PID = path.join(LOGS_DIR, "lab-progress.pid");
export const CHRONICLES_UI_LOG = path.join(LOGS_DIR, "chronicles-ui.log");
export const LAB_POWER_LOG = path.join(LOGS_DIR, "lab-power-ui.log");
const CHRONICLES_SCRIPT = path.join(ROOT, "scripts/chronicles.sh");
const DESTROY_SCRIPT = path.join(ROOT, "scripts/destroy.sh");

const PHASE_PERCENT = {
  tools: 8,
  minikube: 20,
  images: 35,
  secrets: 42,
  manifests: 55,
  monitoring: 70,
  cicd: 85,
  ready: 92,
  start: 40,
  stop: 40,
  destroy: 40,
};

const PHASE_LABEL = {
  tools: "Tools",
  minikube: "Minikube",
  images: "Images",
  secrets: "Secrets",
  manifests: "Manifests",
  monitoring: "Monitoring",
  cicd: "CI/CD",
  ready: "Ready",
  start: "Starting",
  stop: "Stopping",
  destroy: "Destroying",
};

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const raw = fs.readFileSync(PROGRESS_PID, "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Find a live lab script when the PID file is missing (e.g. make chronicles in SSH). */
function discoverLabPid(command) {
  const needles = [];
  if (!command || command === "chronicles") {
    // Prefer the script PID over `make chronicles`.
    needles.push("scripts/chronicles.sh", "make chronicles");
  }
  if (!command || command === "destroy") {
    needles.push("scripts/destroy.sh");
  }
  if (!command || command === "stop") {
    needles.push("minikube-stop.sh", "scripts/stop.sh");
  }
  if (!command || command === "start") {
    needles.push("scripts/start.sh");
  }

  let out = "";
  try {
    out = execSync("ps -eo pid=,args=", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  for (const needle of needles) {
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const space = trimmed.indexOf(" ");
      if (space < 0) continue;
      const pid = Number(trimmed.slice(0, space));
      const args = trimmed.slice(space + 1);
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      if (!args.includes(needle)) continue;
      // Ignore this discovery helper and editor greps.
      if (/\bps -eo\b|\blab-progress\.js\b|\bgrep\b/.test(args)) continue;
      if (pidAlive(pid)) return pid;
    }
  }
  return null;
}

function emptyProgress() {
  return {
    running: false,
    command: null,
    phase: null,
    phaseLabel: null,
    percent: 0,
    message: null,
    machines: {},
    ready: false,
    error: null,
    updatedAt: null,
    pid: null,
    pidAlive: false,
    logLines: [],
  };
}

function labLogPathFor(command) {
  if (command === "stop" || command === "destroy" || command === "start") {
    return LAB_POWER_LOG;
  }
  return CHRONICLES_UI_LOG;
}

/** Last N non-empty lines from a log file (tail, capped read). */
function readLastLines(filePath, maxLines) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const stat = fs.statSync(filePath);
    const readBytes = Math.min(stat.size, 48 * 1024);
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, Math.max(0, stat.size - readBytes));
      const text = buf.toString("utf8");
      const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
      return lines.slice(-maxLines);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

export function readLabLogTail(command, maxLines = 6) {
  const n = Math.max(1, Math.min(40, Number(maxLines) || 6));
  const primary = labLogPathFor(command);
  let lines = readLastLines(primary, n);
  if (lines.length < n) {
    const fallback =
      primary === CHRONICLES_UI_LOG ? LAB_POWER_LOG : CHRONICLES_UI_LOG;
    const extra = readLastLines(fallback, n);
    if (extra.length > lines.length) lines = extra;
  }
  return lines;
}

function inferCommand(parsed) {
  if (parsed.command) return parsed.command;
  const phase = String(parsed.phase || "");
  if (phase === "start" || phase === "stop" || phase === "destroy") return phase;
  return "chronicles";
}

export function readLabProgress() {
  let doc = emptyProgress();
  let parsed = null;

  if (fs.existsSync(PROGRESS_JSON)) {
    try {
      parsed = JSON.parse(fs.readFileSync(PROGRESS_JSON, "utf8"));
      doc = { ...emptyProgress(), ...parsed };
    } catch {
      /* keep empty */
    }
  }

  if (parsed) {
    const status = String(parsed.status || "");
    const command = inferCommand(parsed);
    doc.command = command;
    doc.phase = parsed.phase || doc.phase;
    doc.phaseLabel =
      parsed.phaseLabel || PHASE_LABEL[parsed.phase] || parsed.phase || null;
    doc.message = parsed.message || doc.message;
    doc.updatedAt = parsed.updatedAt || doc.updatedAt;
    doc.machines =
      parsed.machines && typeof parsed.machines === "object"
        ? parsed.machines
        : {};

    if (typeof parsed.percent === "number") {
      doc.percent = parsed.percent;
    } else if (status === "done") {
      doc.percent = 100;
    } else if (parsed.phase && PHASE_PERCENT[parsed.phase] != null) {
      doc.percent = PHASE_PERCENT[parsed.phase];
    }

    if (parsed.ready === true || status === "done") {
      doc.ready = true;
      doc.running = false;
      doc.error = null;
      doc.percent = 100;
    } else if (parsed.error || status === "failed" || status === "error") {
      doc.ready = false;
      doc.running = false;
      doc.error = parsed.error || parsed.message || "Lab setup failed";
    } else if (
      parsed.running === true ||
      status === "running" ||
      status === "pending"
    ) {
      doc.running = true;
      doc.ready = false;
      doc.error = null;
    }
  }

  let pid = readPid();
  if (!pidAlive(pid)) {
    pid = discoverLabPid(doc.command);
  }
  // Prefer pid embedded in progress JSON when alive
  if (!pidAlive(pid) && parsed?.pid && pidAlive(Number(parsed.pid))) {
    pid = Number(parsed.pid);
  }

  const alive = pidAlive(pid);
  doc.pid = pid;
  doc.pidAlive = alive;

  if (doc.running && alive) {
    doc.error = null;
  } else if (doc.running && !alive) {
    // Process gone while status still says running → real failure
    doc.running = false;
    if (!doc.error && !doc.ready) {
      doc.error = "Lab process ended unexpectedly";
      doc.phase = doc.phase || "failed";
      doc.phaseLabel = doc.phaseLabel || "Stopped";
      doc.message = doc.message || doc.error;
    }
  }

  doc.logLines = readLabLogTail(doc.command, 6);
  if (
    doc.logLines.length === 0 &&
    (doc.message || doc.error)
  ) {
    doc.logLines = [String(doc.error || doc.message)];
  }

  return doc;
}

export function isLabRunning() {
  const progress = readLabProgress();
  return Boolean(progress.running && progress.pidAlive);
}

function killPidTree(pid) {
  if (!pid || !Number.isFinite(pid)) return;
  const targets = process.platform === "win32" ? [pid] : [-pid, pid];
  for (const target of targets) {
    try {
      process.kill(target, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    for (const target of targets) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 2000);
}

export function cancelLabProcess() {
  const progress = readLabProgress();
  killPidTree(progress.pid);
  // Also try common script names if PID discovery found a parent/child gap
  try {
    execSync("pkill -f 'scripts/chronicles.sh' || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(PROGRESS_PID);
  } catch {
    /* ignore */
  }
  const doc = {
    ...emptyProgress(),
    running: false,
    error: "Cancelled from dashboard",
    phase: "cancelled",
    phaseLabel: "Cancelled",
    message: "Cancelled from dashboard",
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_JSON, JSON.stringify(doc, null, 2));
  return { ok: true };
}

function spawnDetached(scriptPath, logFile, commandName) {
  if (isLabRunning()) {
    return { ok: false, error: "A lab process is already running" };
  }
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const out = fs.openSync(logFile, "a");
  const child = spawn("bash", [scriptPath], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.writeFileSync(PROGRESS_PID, String(child.pid));
  const doc = {
    running: true,
    command: commandName,
    phase: "starting",
    phaseLabel: "Starting",
    percent: 5,
    message: `Started ${commandName}`,
    machines: {},
    ready: false,
    error: null,
    updatedAt: new Date().toISOString(),
    pid: child.pid,
  };
  fs.writeFileSync(PROGRESS_JSON, JSON.stringify(doc, null, 2));
  return { ok: true, started: true, pid: child.pid };
}

export function startChroniclesDetached() {
  return spawnDetached(CHRONICLES_SCRIPT, CHRONICLES_UI_LOG, "chronicles");
}

export function startLabPowerDetached(action) {
  if (action === "destroy") {
    return spawnDetached(DESTROY_SCRIPT, LAB_POWER_LOG, "destroy");
  }
  if (action === "stop") {
    return spawnDetached(path.join(ROOT, "scripts/stop.sh"), LAB_POWER_LOG, "stop");
  }
  return { ok: false, error: `Unknown lab power action: ${action}` };
}
