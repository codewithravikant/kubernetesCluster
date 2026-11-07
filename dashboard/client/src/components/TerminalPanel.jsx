import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function wsUrl(namespace, pod, container) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ namespace, pod, container });
  return `${proto}//${window.location.host}/ws/exec?${params}`;
}

function clusterWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/cluster`;
}

export default function TerminalPanel({ machine, sessionKey, mode = "pod" }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const socketRef = useRef(null);
  const [pods, setPods] = useState([]);
  const [podError, setPodError] = useState("");
  const [loadingPods, setLoadingPods] = useState(false);
  const [target, setTarget] = useState(null);
  const cluster = mode === "cluster";
  const namespace = machine?.name || "";
  const [seenNamespace, setSeenNamespace] = useState(namespace);
  if (namespace !== seenNamespace) {
    setSeenNamespace(namespace);
    setTarget(null);
  }

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#070d18",
        foreground: "#d7e2f5",
        cursor: "#2ec4b6",
        selectionBackground: "rgba(46,196,182,0.35)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => {
      fit.fit();
      const sock = socketRef.current;
      if (sock?.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      socketRef.current?.close();
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const namespace = machine?.name;
    if (cluster || !namespace) {
      setPods([]);
      setPodError("");
      return undefined;
    }

    const ctrl = new AbortController();
    setLoadingPods(true);
    setPodError("");
    fetch(`/api/namespaces/${encodeURIComponent(namespace)}/pods`, {
      credentials: "same-origin",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        setPods(Array.isArray(data.pods) ? data.pods : []);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setPods([]);
        setPodError(err.message || "Could not list pods");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingPods(false);
      });

    return () => ctrl.abort();
  }, [cluster, machine?.name, sessionKey]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return undefined;

    socketRef.current?.close();
    socketRef.current = null;
    term.reset();

    let socketUrl = "";
    if (cluster) {
      term.writeln("\x1b[36mConnecting to the cluster shell…\x1b[0m");
      socketUrl = clusterWsUrl();
    } else if (!machine) {
      term.writeln("\x1b[90mSelect a namespace to list its pods.\x1b[0m");
      return undefined;
    } else if (!target) {
      term.writeln(
        `\x1b[90mNamespace ${machine.name}. Pick a Running pod below to open a shell.\x1b[0m`
      );
      return undefined;
    } else {
      term.writeln(
        `\x1b[36mConnecting to ${target.pod} / ${target.container} in ${machine.name}…\x1b[0m`
      );
      socketUrl = wsUrl(machine.name, target.pod, target.container);
    }

    const sock = new WebSocket(socketUrl);
    socketRef.current = sock;

    sock.onopen = () => {
      fitRef.current?.fit();
      sock.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    sock.onmessage = (ev) => {
      term.write(typeof ev.data === "string" ? ev.data : "");
    };
    sock.onerror = () => {
      term.writeln("\r\n\x1b[31mWebSocket error.\x1b[0m");
    };
    sock.onclose = () => {
      term.writeln("\r\n\x1b[33mDisconnected.\x1b[0m");
    };

    const disposable = term.onData((data) => {
      if (sock.readyState === WebSocket.OPEN) sock.send(data);
    });

    return () => {
      disposable.dispose();
      sock.close();
      if (socketRef.current === sock) socketRef.current = null;
    };
  }, [cluster, machine?.name, target]);

  const connect = (pod, container) => {
    const name = container || pod.containers[0];
    if (!name || pod.phase !== "Running") return;
    setTarget({ pod: pod.name, container: name });
  };

  return (
    <div className="term-body">
      {cluster ? (
        <p className="pod-meta cluster-hint">
          Host shell for this cluster. Try <code>minikube status -p chronicles</code>,{" "}
          <code>kubectl get nodes</code>, <code>kubectl get pods -A</code>,{" "}
          <code>kubectl logs</code>, or <code>kubectl describe</code>.
        </p>
      ) : null}
      {!cluster ? (
      <div className="pod-picker">
        <div className="pod-picker-head">
          <span>{machine ? `Pods in ${machine.name}` : "Pods"}</span>
          {loadingPods ? <span className="pod-meta">Loading…</span> : null}
        </div>
        {podError ? <p className="pod-error">{podError}</p> : null}
        {!loadingPods && machine && !podError && pods.length === 0 ? (
          <p className="pod-meta">No pods in this namespace.</p>
        ) : null}
        <div className="pod-list">
          {pods.map((pod) => {
            const container = pod.containers[0] || "";
            const active = target?.pod === pod.name;
            const canShell = pod.phase === "Running" && Boolean(container);
            return (
              <button
                key={pod.name}
                type="button"
                className={`btn pod-chip${active ? " btn-accent" : ""}`}
                disabled={!canShell}
                onClick={() => connect(pod, container)}
                title={canShell ? `kubectl exec -n ${machine.name} -it ${pod.name} -c ${container} -- sh` : pod.phase}
              >
                <strong>{pod.name}</strong>
                <span>
                  {pod.ready} · {pod.phase}
                  {pod.containers.length > 1 ? ` · ${container}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      ) : null}
      <div className="xterm-wrap" ref={hostRef} id="ssh-terminal" />
    </div>
  );
}
