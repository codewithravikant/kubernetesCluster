import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopologyTooltip from "./TopologyTooltip.jsx";
import { buildTooltipModel } from "./topoMeta.js";

const PAD = 28;
const NODE_H = 70;
const NODE_W = 200;
const NS_W = 168;
const NS_H = 78;
const GAP = 34;
const SIDE_GAP = 36;
const APP_PAD_X = 18;
const APP_PAD_TOP = 34;
const APP_PAD_BOT = 18;
const WORKLOAD_GAP = 28;

const EDGE_STYLES = {
  http: { className: "topo-edge topo-edge-http", label: "HTTP" },
  scrape: { className: "topo-edge topo-edge-scrape", label: "scrape" },
  logs: { className: "topo-edge topo-edge-logs", label: "logs" },
  deploy: { className: "topo-edge topo-edge-deploy", label: "deploy" },
  membership: { className: "topo-edge topo-edge-member", label: "cluster" },
};

function stateColor(state, reachable) {
  if (state === "running" && reachable) return "var(--ok)";
  if (state === "running") return "var(--warn)";
  if (state === "poweroff" || state === "aborted" || state === "not_created") {
    return "var(--muted)";
  }
  return "var(--warn)";
}

function nsMeta(name) {
  switch (name) {
    case "app":
      return { role: "Application", detail: "frontend · backend" };
    case "monitoring":
      return { role: "Monitoring", detail: "Prom · Grafana · AM" };
    case "logging":
      return { role: "Logging", detail: "Fluent Bit · ES · Kibana" };
    case "cicd":
      return { role: "CI/CD", detail: "Jenkins · registry:5000" };
    default:
      return { role: "Namespace", detail: name };
  }
}

/**
 * Vertical spine + side platforms:
 * Host → Minikube → Ingress → ns:app (frontend → backend)
 * monitoring scrapes the Minikube node, backend, and logging · logging collects everywhere · cicd deploys app
 */
function buildLayout(machines) {
  const nodes = [];
  const edges = [];

  const appInnerW = NODE_W;
  const appFrameW = appInnerW + APP_PAD_X * 2;
  const appFrameH =
    APP_PAD_TOP + NODE_H + WORKLOAD_GAP + NODE_H + APP_PAD_BOT;
  const width = Math.max(
    PAD * 2 + NS_W + SIDE_GAP + appFrameW + SIDE_GAP + NS_W,
    620
  );
  const cx = width / 2;

  let y = PAD;

  const placeCentered = (id, label, sub, kind, w = NODE_W, h = NODE_H) => {
    const node = {
      id,
      label,
      sub,
      kind,
      x: cx - w / 2,
      y,
      w,
      h,
    };
    nodes.push(node);
    y += h + GAP;
    return node;
  };

  placeCentered("host", "Host", "Docker Engine", "infra");
  placeCentered("minikube", "Minikube", "profile chronicles", "infra", NODE_W + 16);
  placeCentered("ingress", "Ingress", "nginx addon", "infra");

  const appTop = y;
  const frontend = {
    id: "frontend",
    label: "frontend",
    sub: "Service :80 · ×2+HPA",
    kind: "workload",
    x: cx - appInnerW / 2,
    y: appTop + APP_PAD_TOP,
    w: appInnerW,
    h: NODE_H,
  };
  const backend = {
    id: "backend",
    label: "backend",
    sub: "Service :3000 · ×1",
    kind: "workload",
    x: frontend.x,
    y: frontend.y + NODE_H + WORKLOAD_GAP,
    w: appInnerW,
    h: NODE_H,
  };
  const appNs = {
    id: "app",
    label: "ns: app",
    sub: nsMeta("app").detail,
    kind: "ns",
    x: cx - appFrameW / 2,
    y: appTop,
    w: appFrameW,
    h: appFrameH,
    frame: true,
  };
  nodes.push(appNs, frontend, backend);

  // Platforms beside / below app so each role's edges stay readable
  const midAppY = appTop + appFrameH / 2 - NS_H / 2;
  const monitoring = {
    id: "monitoring",
    label: "ns: monitoring",
    sub: nsMeta("monitoring").detail,
    kind: "ns",
    selectable: true,
    x: appNs.x - SIDE_GAP - NS_W,
    y: midAppY,
    w: NS_W,
    h: NS_H,
  };
  const logging = {
    id: "logging",
    label: "ns: logging",
    sub: nsMeta("logging").detail,
    kind: "ns",
    selectable: true,
    x: appNs.x + appNs.w + SIDE_GAP,
    y: midAppY,
    w: NS_W,
    h: NS_H,
  };
  const cicd = {
    id: "cicd",
    label: "ns: cicd",
    sub: nsMeta("cicd").detail,
    kind: "ns",
    selectable: true,
    x: cx - NS_W / 2,
    y: appNs.y + appNs.h + GAP,
    w: NS_W,
    h: NS_H,
  };
  nodes.push(monitoring, logging, cicd);

  const placed = new Set(nodes.map((n) => n.id));
  let extraX = PAD;
  let extraY = cicd.y + NS_H + GAP;
  for (const m of machines) {
    if (placed.has(m.name)) continue;
    nodes.push({
      id: m.name,
      label: `ns: ${m.name}`,
      sub: m.role || nsMeta(m.name).detail,
      kind: "ns",
      selectable: true,
      x: extraX,
      y: extraY,
      w: NS_W,
      h: NS_H,
    });
    extraX += NS_W + SIDE_GAP;
  }

  const add = (from, to, type) => {
    edges.push({ from, to, type });
  };

  // Spine
  add("host", "minikube", "membership");
  add("minikube", "ingress", "membership");
  add("ingress", "frontend", "http");
  add("frontend", "backend", "http");

  // Live Prometheus targets. Node/kubelet/API scrapes land on Minikube.
  // Ingress controller metrics and blackbox probes are their own scrape.
  // frontend has no ServiceMonitor; pod metrics come through kubelet on the node.
  add("monitoring", "minikube", "scrape");
  add("monitoring", "ingress", "scrape");
  add("monitoring", "backend", "scrape");
  add("monitoring", "logging", "scrape");

  // Logging (Fluent Bit DaemonSet) collects from every namespace
  add("logging", "frontend", "logs");
  add("logging", "backend", "logs");
  add("logging", "monitoring", "logs");
  add("logging", "cicd", "logs");

  // CI/CD deploys into the app namespace only
  add("cicd", "frontend", "deploy");
  add("cicd", "backend", "deploy");

  const height = Math.max(
    700,
    Math.max(...nodes.map((n) => n.y + n.h)) + PAD
  );

  return { nodes, edges, width, height };
}

function nodeById(nodes, id) {
  return nodes.find((x) => x.id === id) || null;
}

/**
 * Anchor edges on the facing sides of boxes, with separate from/to port
 * offsets so fan-out from monitoring/logging stays readable.
 */
function edgeEnds(nodes, fromId, toId, type, fromPort = 0, fromPorts = 1, toPort = 0, toPorts = 1) {
  const a = nodeById(nodes, fromId);
  const b = nodeById(nodes, toId);
  if (!a || !b || a.frame || b.frame) return null;

  const spread = 14;
  const fromOff = (fromPort - (fromPorts - 1) / 2) * spread;
  const toOff = (toPort - (toPorts - 1) / 2) * spread;
  const aCx = a.x + a.w / 2;
  const bCx = b.x + b.w / 2;
  const aCy = a.y + a.h / 2;
  const bCy = b.y + b.h / 2;

  // Node and Ingress scrapes run up the left margin so they stay off the app box.
  if (type === "scrape" && toId === "minikube") {
    return {
      from: { x: a.x, y: a.y + 18 },
      to: { x: b.x + 28, y: b.y + b.h },
      gutter: true,
      gutterX: 12,
    };
  }
  if (type === "scrape" && toId === "ingress") {
    return {
      from: { x: a.x, y: a.y + 8 },
      to: { x: b.x + 16, y: b.y + b.h },
      gutter: true,
      gutterX: 22,
    };
  }

  // Vertical spine (Host → … → backend)
  if (
    (type === "http" || type === "membership") &&
    Math.abs(aCx - bCx) < 36
  ) {
    if (a.y < b.y) {
      return {
        from: { x: aCx + fromOff, y: a.y + a.h },
        to: { x: bCx + toOff, y: b.y },
      };
    }
    return {
      from: { x: aCx + fromOff, y: a.y },
      to: { x: bCx + toOff, y: b.y + b.h },
    };
  }

  // Prefer side exits when nodes sit left/right of each other
  const mostlyHorizontal = Math.abs(aCx - bCx) >= Math.abs(aCy - bCy) * 0.55;
  if (mostlyHorizontal) {
    if (aCx < bCx) {
      return {
        from: { x: a.x + a.w, y: aCy + fromOff },
        to: { x: b.x, y: bCy + toOff },
      };
    }
    return {
      from: { x: a.x, y: aCy + fromOff },
      to: { x: b.x + b.w, y: bCy + toOff },
    };
  }

  // Vertical (e.g. cicd below workloads, monitoring → cicd)
  if (a.y > b.y) {
    return {
      from: { x: aCx + fromOff, y: a.y },
      to: { x: bCx + toOff, y: b.y + b.h },
    };
  }
  return {
    from: { x: aCx + fromOff, y: a.y + a.h },
    to: { x: bCx + toOff, y: b.y },
  };
}

function edgePath(from, to, type, gutter, gutterX = 12) {
  if (gutter) {
    const left = gutterX;
    return `M ${from.x} ${from.y} L ${left} ${from.y} L ${left} ${to.y} L ${to.x} ${to.y}`;
  }
  if (type === "http" || type === "membership") {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bend =
    type === "scrape" ? -22 : type === "deploy" ? 22 : type === "logs" ? 10 : 0;
  const cx = from.x + dx * 0.5 + bend;
  const cy = from.y + dy * 0.5;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

/** Highlight edges involving the selected namespace (and app HTTP spine). */
function liveEdgeIds(edges, selected) {
  const live = new Set();
  if (!selected) return live;
  const idOf = (e) => `${e.from}-${e.to}-${e.type}`;
  if (selected === "monitoring") {
    for (const e of edges) {
      if (e.type === "scrape" && e.from === "monitoring") live.add(idOf(e));
    }
    return live;
  }
  for (const e of edges) {
    if (e.from === selected || e.to === selected) {
      live.add(idOf(e));
    }
  }
  if (selected === "app") {
    for (const e of edges) {
      if (
        e.type === "http" ||
        (e.from === "host" && e.to === "minikube") ||
        (e.from === "minikube" && e.to === "ingress")
      ) {
        live.add(`${e.from}-${e.to}-${e.type}`);
      }
    }
  }
  return live;
}

function portIndex(edges, edge, key) {
  const siblings = edges.filter(
    (e) => e[key] === edge[key] && e.type === edge.type
  );
  const port = siblings.findIndex(
    (e) => e.from === edge.from && e.to === edge.to && e.type === edge.type
  );
  return { port: Math.max(0, port), ports: siblings.length || 1 };
}

function tipPosition(wrapEl, svgEl, node, layoutW) {
  if (!wrapEl || !svgEl || !node) return { left: 12, top: 12 };
  const wrap = wrapEl.getBoundingClientRect();
  const svg = svgEl.getBoundingClientRect();
  const scale = svg.width / layoutW;
  const tipW = 300;
  const tipH = 340;
  let left = svg.left - wrap.left + (node.x + node.w + 12) * scale;
  let top = svg.top - wrap.top + node.y * scale;

  if (left + tipW > wrap.width - 8) {
    left = svg.left - wrap.left + node.x * scale - tipW - 12;
  }
  if (left < 8) left = 8;
  if (top + tipH > wrap.height - 8) {
    top = Math.max(8, wrap.height - tipH - 8);
  }
  if (top < 8) top = 8;
  return { left, top };
}

export default function Topology({
  machines,
  topology,
  selected,
  onSelect,
  onTopicFocus,
}) {
  const byName = Object.fromEntries(machines.map((m) => [m.name, m]));
  const { nodes, edges, width, height } = useMemo(
    () => buildLayout(machines),
    [machines]
  );
  const live = liveEdgeIds(edges, selected);
  const selectedMachine = byName[selected];
  const liveNodes = topology?.nodes || null;

  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const hideTimer = useRef(null);

  const [hoverId, setHoverId] = useState(null);
  const [pinnedId, setPinnedId] = useState(null);
  const [tipStyle, setTipStyle] = useState({ left: 12, top: 12 });

  const activeId = pinnedId || hoverId;
  const activeNode = activeId ? nodeById(nodes, activeId) : null;
  const tipModel = useMemo(() => {
    if (!activeNode) return null;
    const map = Object.fromEntries(machines.map((m) => [m.name, m]));
    const machine =
      map[activeNode.id] ||
      (activeNode.id === "frontend" || activeNode.id === "backend"
        ? map.app
        : null);
    const liveNode = liveNodes?.[activeNode.id] || null;
    return buildTooltipModel(activeNode, machine, edges, liveNode);
  }, [activeNode, machines, edges, liveNodes]);

  const clearHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const scheduleHide = () => {
    clearHide();
    hideTimer.current = setTimeout(() => {
      if (!pinnedId) setHoverId(null);
    }, 160);
  };

  const placeTip = useCallback(
    (node) => {
      setTipStyle(tipPosition(wrapRef.current, svgRef.current, node, width));
    },
    [width]
  );

  const showNode = useCallback(
    (id, { focusTopic = false } = {}) => {
      clearHide();
      const node = nodeById(nodes, id);
      if (!node) return;
      setHoverId(id);
      placeTip(node);
      if (focusTopic) onTopicFocus?.(id);
    },
    [nodes, onTopicFocus, placeTip]
  );

  const dismiss = useCallback(() => {
    clearHide();
    setPinnedId(null);
    setHoverId(null);
  }, []);

  const togglePin = useCallback(
    (id, e) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      if (pinnedId === id) {
        dismiss();
        return;
      }
      setPinnedId(id);
      showNode(id, { focusTopic: true });
      const n = nodeById(nodes, id);
      if (n?.kind === "ns" || n?.frame) onSelect?.(id);
    },
    [dismiss, nodes, onSelect, pinnedId, showNode]
  );

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  useEffect(() => () => clearHide(), []);

  const nodeHandlers = (id) => ({
    tabIndex: 0,
    role: "button",
    "aria-label": `Details for ${id}`,
    onMouseEnter: () => {
      if (pinnedId) return;
      showNode(id);
    },
    onMouseLeave: () => {
      if (pinnedId) return;
      scheduleHide();
    },
    onFocus: () => showNode(id, { focusTopic: true }),
    onBlur: () => {
      if (pinnedId) return;
      scheduleHide();
    },
    onClick: (e) => togglePin(id, e),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        togglePin(id, e);
      }
    },
  });

  return (
    <div className="topo-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="topo-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cluster Chronicles Kubernetes topology"
      >
        <defs>
          {Object.keys(EDGE_STYLES).map((type) => (
            <marker
              key={type}
              id={`topo-arrow-${type}`}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="3.5"
              orient="auto"
              className={`topo-marker topo-marker-${type}`}
            >
              <path d="M0,0 L7,3.5 L0,7 Z" />
            </marker>
          ))}
          <marker
            id="topo-arrow-live"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--accent)" />
          </marker>
        </defs>

        {nodes
          .filter((n) => n.frame)
          .map((n) => {
            const m = byName[n.id];
            const active = selected === n.id;
            const accent = stateColor(m?.state || "unknown", m?.reachable);
            const tipActive = activeId === n.id;
            return (
              <g
                key={`${n.id}-frame`}
                className={`topo-frame${active ? " active" : ""}${tipActive ? " tip-active" : ""}`}
                style={{ cursor: "pointer" }}
                {...nodeHandlers(n.id)}
              >
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="14" />
                <circle cx={n.x + 20} cy={n.y + 18} r="4.5" fill={accent} />
                <text x={n.x + 32} y={n.y + 22} className="topo-frame-label">
                  {n.label}
                </text>
              </g>
            );
          })}

        {edges.map((e) => {
          const fromP = portIndex(edges, e, "from");
          const toP = portIndex(edges, e, "to");
          const ends = edgeEnds(
            nodes,
            e.from,
            e.to,
            e.type,
            fromP.port,
            fromP.ports,
            toP.port,
            toP.ports
          );
          if (!ends) return null;
          const id = `${e.from}-${e.to}-${e.type}`;
          const isLive = live.has(id);
          const style = EDGE_STYLES[e.type] || EDGE_STYLES.membership;
          return (
            <path
              key={id}
              className={`${style.className}${isLive ? " live" : ""}`}
              d={edgePath(ends.from, ends.to, e.type, ends.gutter, ends.gutterX)}
              fill="none"
              markerEnd={
                isLive ? "url(#topo-arrow-live)" : `url(#topo-arrow-${e.type})`
              }
            />
          );
        })}

        {nodes
          .filter((n) => !n.frame)
          .map((n) => {
            if (n.kind === "infra" || n.kind === "workload") {
              const tipActive = activeId === n.id;
              return (
                <g
                  key={n.id}
                  className={`topo-node topo-${n.kind}${tipActive ? " tip-active" : ""}`}
                  style={{ cursor: "pointer" }}
                  {...nodeHandlers(n.id)}
                >
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="12" />
                  <text x={n.x + n.w / 2} y={n.y + 28} textAnchor="middle">
                    {n.label}
                  </text>
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + 50}
                    textAnchor="middle"
                    className="topo-sub"
                  >
                    {n.sub}
                  </text>
                </g>
              );
            }

            const m = byName[n.id];
            const active = selected === n.id;
            const state = m?.state || "unknown";
            const accent = stateColor(state, m?.reachable);
            const tipActive = activeId === n.id;

            return (
              <g
                key={n.id}
                className={`topo-node topo-ns topo-ns-${n.id}${active ? " active" : ""}${tipActive ? " tip-active" : ""}`}
                style={{ cursor: "pointer" }}
                {...nodeHandlers(n.id)}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx="12"
                  style={{ stroke: active ? "var(--accent)" : undefined }}
                />
                <circle
                  cx={n.x + 18}
                  cy={n.y + 24}
                  r="5"
                  fill={accent}
                  style={{ filter: `drop-shadow(0 0 5px ${accent})` }}
                />
                <text x={n.x + 32} y={n.y + 28}>
                  {n.label}
                </text>
                <text x={n.x + 18} y={n.y + 54} className="topo-sub">
                  {m
                    ? `${String(state).replace("_", " ")}${m.reachable ? " · ready" : ""}`
                    : n.sub}
                </text>
              </g>
            );
          })}
      </svg>

      <TopologyTooltip
        model={tipModel}
        pinned={Boolean(pinnedId)}
        style={{
          position: "absolute",
          left: tipStyle.left,
          top: tipStyle.top,
          zIndex: 20,
        }}
        onDismiss={dismiss}
        onMouseEnter={clearHide}
        onMouseLeave={() => {
          if (!pinnedId) scheduleHide();
        }}
      />

      <div className="topo-legend" aria-hidden="true">
        <span className="topo-legend-item http">HTTP</span>
        <span className="topo-legend-item scrape">scrape</span>
        <span className="topo-legend-item logs">logs</span>
        <span className="topo-legend-item deploy">deploy</span>
        <span className="topo-legend-item member">cluster</span>
      </div>

      <p className="topo-status">
        {selectedMachine ? (
          <>
            Focus: <strong>{selectedMachine.name}</strong>
            {selectedMachine.role ? ` · ${selectedMachine.role}` : ""} ·{" "}
            {String(selectedMachine.state).replace("_", " ")}
            {selectedMachine.reachable ? " · reachable" : ""}
            {selected === "app" && " · HTTP Ingress → frontend → backend"}
            {selected === "monitoring" &&
              " · scrapes Minikube (node, kubelet, API), backend, and logging. Docker host and Ingress are not scrape targets"}
            {selected === "logging" &&
              " · collects logs from frontend · backend · monitoring · cicd"}
            {selected === "cicd" && " · deploys frontend · backend"}
          </>
        ) : (
          <>
            Kubernetes · Host → Minikube → Ingress → app · select a namespace
          </>
        )}
      </p>
    </div>
  );
}
