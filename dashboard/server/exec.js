import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { isAuthenticatedRequest } from "./auth.js";
import { getMachine } from "./machines.js";
import { listNamespacePods } from "./k8s.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(__dirname, "pty_bridge.py");

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

function safeName(value) {
  const name = String(value || "");
  if (!name || name.length > 253 || !NAME_RE.test(name)) return "";
  return name;
}

function rejectSocket(ws, text) {
  ws.send(`\r\n\x1b[31m${text}\x1b[0m\r\n`);
  ws.close();
}

function attachPty(ws, args) {
  let child = null;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    if (child && child.exitCode == null && !child.killed) {
      child.kill("SIGTERM");
    }
    if (ws.readyState === ws.OPEN) ws.close();
  };

  child = spawn("python3", [BRIDGE, ...args], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[31m${chunk.toString("utf8")}\x1b[0m`);
    }
  });
  child.on("error", (err) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
    }
    finish();
  });
  child.on("close", () => {
    finish();
  });

  ws.on("message", (data) => {
    const text = data.toString("utf8");
    if (text.startsWith('{"type":"resize"')) {
      try {
        const msg = JSON.parse(text);
        const cols = Number(msg.cols);
        const rows = Number(msg.rows);
        if (msg.type === "resize" && cols > 0 && rows > 0 && child.stdio[3]) {
          child.stdio[3].write(`${Math.floor(cols)} ${Math.floor(rows)}\n`);
          return;
        }
      } catch {
        /* keystrokes that are not a resize frame fall through */
      }
    }
    if (child.stdin.writable) child.stdin.write(data);
  });
  ws.on("close", finish);
}

function requireAuth(ws, req) {
  if (isAuthenticatedRequest(req)) return true;
  rejectSocket(ws, "Authentication required. Sign in to the dashboard.");
  return false;
}

function onClusterConnection(ws, req) {
    if (!requireAuth(ws, req)) return;
    const script = path.join(__dirname, "cluster-shell.sh");
    attachPty(ws, ["bash", script]);
}

function onExecConnection(ws, req) {
    if (!requireAuth(ws, req)) return;

    const url = new URL(req.url || "", "http://localhost");
    const namespace = safeName(url.searchParams.get("namespace"));
    const pod = safeName(url.searchParams.get("pod"));
    const container = safeName(url.searchParams.get("container"));
    if (!namespace || !getMachine(namespace) || !pod || !container) {
      rejectSocket(ws, "Choose a namespace, pod, and container.");
      return;
    }

    let opened = false;
    const fail = (text) => {
      if (opened) return;
      rejectSocket(ws, text);
    };

    ws.on("close", () => {
      opened = true;
    });

    listNamespacePods(namespace)
      .then((listed) => {
        if (ws.readyState !== ws.OPEN) return;
        if (!listed.ok) {
          fail(listed.error);
          return;
        }
        const match = listed.pods.find((item) => item.name === pod);
        if (!match || match.phase !== "Running" || !match.containers.includes(container)) {
          fail("That pod is not running in this namespace.");
          return;
        }
        opened = true;
        attachPty(ws, [
          "kubectl",
          "exec",
          "-it",
          "-n",
          namespace,
          pod,
          "-c",
          container,
          "--",
          "sh",
        ]);
      })
      .catch((err) => {
        fail(err.message || String(err));
      });
}

export function attachTerminals(server) {
  const clusterWss = new WebSocketServer({ noServer: true });
  const execWss = new WebSocketServer({ noServer: true });
  clusterWss.on("error", () => {});
  execWss.on("error", () => {});
  clusterWss.on("connection", onClusterConnection);
  execWss.on("connection", onExecConnection);

  server.on("upgrade", (req, socket, head) => {
    const raw = req.url || "/";
    const query = raw.indexOf("?");
    const pathname = query === -1 ? raw : raw.slice(0, query);
    const target =
      pathname === "/ws/cluster" ? clusterWss : pathname === "/ws/exec" ? execWss : null;
    if (!target) {
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => {
      target.emit("connection", ws, req);
    });
  });
}
