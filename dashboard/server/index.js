import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import {
  CPU_OPTIONS,
  getMachine,
  hasPrivateKey,
  loadMachines,
  MEMORY_OPTIONS,
  ROOT,
  updateMachineResources,
} from "./machines.js";
import { attachTerminals } from "./exec.js";
import {
  listNamespacePods,
  minikubeStatusMap,
  namespacePodSummary,
  runClusterAction,
  runVerify,
} from "./k8s.js";
import { gatherTopologyFacts } from "./topology-facts.js";
import {
  cancelLabProcess,
  readLabProgress,
  startLabPowerDetached,
  startChroniclesDetached,
} from "./lab-progress.js";
import {
  authenticateUser,
  createSessionToken,
  DASHBOARD_USER,
  readSession,
  requireAuth,
  sessionCookieHeader,
} from "./auth.js";
import { createObserveRouter } from "./observe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "127.10.10.10";
// Prefer 3030 so we do not collide with Open WebUI / other apps on :3000
const PREFERRED_PORT = Number(process.env.PORT || 3030);
const MAX_PORT_TRIES = 20;
const isProd = process.env.NODE_ENV === "production";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cluster-chronicles-dashboard" });
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: session.username });
});

app.post("/api/login", async (req, res) => {
  try {
    const user = await authenticateUser(req.body?.username, req.body?.password);
    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const token = createSessionToken(user.username);
    res.setHeader("Set-Cookie", sessionCookieHeader(token));
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", sessionCookieHeader("", { clear: true }));
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  if (
    req.path === "/health" ||
    req.path === "/login" ||
    req.path === "/logout" ||
    req.path === "/auth/me"
  ) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

app.get("/api/namespaces/:name/pods", async (req, res) => {
  const name = req.params.name;
  if (!getMachine(name)) {
    res.status(404).json({ error: "Unknown namespace" });
    return;
  }
  try {
    const result = await listNamespacePods(name);
    if (!result.ok) {
      res.status(502).json({ error: result.error, pods: [] });
      return;
    }
    res.json({ namespace: name, pods: result.pods });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get("/api/machines", async (_req, res) => {
  try {
    const machines = loadMachines();
    const { map, running } = await minikubeStatusMap();
    const enriched = await Promise.all(
      machines.map(async (m) => {
        const state = map[m.name] || "unknown";
        let pods = { ready: 0, total: 0 };
        if (running) {
          try {
            pods = await namespacePodSummary(m.name);
          } catch {
            /* ignore */
          }
        }
        return {
          ...m,
          state,
          reachable: running && pods.total > 0,
          httpOpen: false,
          publicUrl: null,
          openPath: null,
          sshReady: false,
          podsReady: pods.ready,
          podsTotal: pods.total,
        };
      })
    );
    let topology = null;
    try {
      topology = await gatherTopologyFacts();
    } catch {
      topology = null;
    }
    res.json({
      machines: enriched,
      topology,
      keyPresent: hasPrivateKey(),
      root: ROOT,
      options: { memory: MEMORY_OPTIONS, cpus: CPU_OPTIONS },
      cluster: running ? "running" : "stopped",
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.patch("/api/machines/:name/resources", async (req, res) => {
  const name = req.params.name;
  const machine = getMachine(name);
  if (!machine) {
    res.status(404).json({ error: "Unknown machine" });
    return;
  }

  const apply = Boolean(req.body?.apply);
  try {
    const updated = updateMachineResources(name, {
      memory: req.body?.memory,
      cpus: req.body?.cpus,
    });

    let reload = null;
    if (apply) {
      // config/cluster.yml → minikube start with new cpus/memory
      reload = await runClusterAction("reload", name);
    }

    res.json({
      ok: apply ? Boolean(reload?.ok) : true,
      machine: updated,
      file: "config/cluster.yml",
      applied: apply,
      reload: reload
        ? {
            ok: reload.ok,
            code: reload.code,
            stdout: reload.stdout.slice(-8000),
            stderr: reload.stderr.slice(-4000),
          }
        : null,
      note: apply
        ? "Wrote config/cluster.yml and restarted Minikube"
        : "Wrote config/cluster.yml — Apply to restart Minikube with new size",
    });
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.post("/api/machines/:name/action", async (req, res) => {
  const action = String(req.body?.action || "");
  const alias = {
    start: "up",
    stop: "halt",
    restart: "reload",
    destroy: "destroy",
  };
  const mapped = alias[action];
  if (!mapped) {
    res.status(400).json({
      error: "Invalid action. Use start|stop|restart|destroy (cluster-wide)",
    });
    return;
  }

  try {
    const result = await runClusterAction(mapped, req.params.name);
    res.json({
      ok: result.ok,
      code: result.code,
      stdout: result.stdout.slice(-8000),
      stderr: result.stderr.slice(-4000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/verify", async (_req, res) => {
  try {
    const result = await runVerify();
    res.json({
      ok: result.ok,
      code: result.code,
      stdout: result.stdout.slice(-12000),
      stderr: result.stderr.slice(-4000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get("/api/lab-progress", (_req, res) => {
  try {
    res.json(readLabProgress());
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/lab/chronicles", (_req, res) => {
  try {
    const result = startChroniclesDetached();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/lab/stop", (_req, res) => {
  try {
    const result = startLabPowerDetached("stop");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/lab/destroy", (_req, res) => {
  try {
    const result = startLabPowerDetached("destroy");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/lab/kill", (_req, res) => {
  try {
    const result = cancelLabProcess();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.use("/api/observe", createObserveRouter());

app.use("/api/stretch", (_req, res) => {
  res.status(410).json({
    error: "Stretch (Netdata/Fail2Ban/WireGuard) is not part of Cluster Chronicles",
  });
});

if (isProd) {
  const dist = path.join(__dirname, "../dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

const server = http.createServer(app);
attachTerminals(server);

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

async function start() {
  let port = PREFERRED_PORT;
  for (let i = 0; i < MAX_PORT_TRIES; i += 1) {
    try {
      await listenOnPort(port);
      console.log("Cluster Chronicles dashboard ready");
      console.log(`  → http://${HOST}:${port}`);
      console.log(`Mode: ${isProd ? "production" : "development"}`);
      console.log(`Login: ${DASHBOARD_USER} / (lab password — hashed at rest)`);
      return;
    } catch (err) {
      if (err?.code === "EADDRNOTAVAIL") {
        throw new Error(
          `Address ${HOST} is not available. Run: ./scripts/ensure-dashboard-host.sh`
        );
      }
      if (err?.code !== "EADDRINUSE") {
        throw err;
      }
      if (process.env.DASHBOARD_STRICT_PORT === "1") {
        throw new Error(
          `Port ${port} is already in use on ${HOST}. Stop the other dashboard process and retry.`
        );
      }
      const next = port + 1;
      console.log(`Port ${port} busy on ${HOST} — trying ${next}…`);
      port = next;
    }
  }
  throw new Error(
    `No free port found on ${HOST} from ${PREFERRED_PORT} to ${PREFERRED_PORT + MAX_PORT_TRIES - 1}`
  );
}

start().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
