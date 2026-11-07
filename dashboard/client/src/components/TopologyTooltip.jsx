function Row({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div className="topo-tip-row">
      <span className="topo-tip-k">{label}</span>
      <span className="topo-tip-v">{value}</span>
    </div>
  );
}

export default function TopologyTooltip({
  model,
  pinned,
  style,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}) {
  if (!model) return null;

  const net = model.network || {};
  const healthTone = model.health?.tone || "muted";

  return (
    <div
      className={`topo-tip${pinned ? " pinned" : ""}`}
      style={style}
      role="dialog"
      aria-label={`${model.name} details`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <header className="topo-tip-head">
        <div>
          <strong>{model.name}</strong>
          <span className="topo-tip-type">{model.type}</span>
        </div>
        {pinned && (
          <button
            type="button"
            className="topo-tip-close"
            onClick={onDismiss}
            aria-label="Dismiss tooltip"
          >
            ×
          </button>
        )}
      </header>

      {model.namespace && (
        <p className="topo-tip-ns">Namespace: {model.namespace}</p>
      )}
      <p className="topo-tip-purpose">{model.purpose}</p>

      <section className="topo-tip-section">
        <h4>Status</h4>
        <Row label="Monitoring" value={model.monitoring} />
        <Row
          label="Health"
          value={
            <span className={`topo-tip-health tone-${healthTone}`}>
              {model.health?.label || "Unknown"}
            </span>
          }
        />
        <Row label="Pods" value={model.pods} />
      </section>

      <section className="topo-tip-section">
        <h4>Network</h4>
        <Row
          label="IP"
          value={
            net.ip
              ? net.ip
              : net.podIps
                ? `Pods ${net.podIps}`
                : "Unknown"
          }
        />
        <Row label="Pod IPs" value={net.ip && net.podIps ? net.podIps : null} />
        <Row label="Namespace id" value={net.namespaceId} />
        <Row label="Hostname" value={net.hostname || "Unknown"} />
        <Row label="Ports" value={net.ports || "Not available"} />
        <Row label="Protocol" value={net.protocol} />
        <Row label="Service type" value={net.serviceType} />
        <Row label="Docker API" value={net.dockerApi} />
        <Row label="Containers" value={net.containers} />
        <Row label="Grafana IP" value={net.grafanaIp} />
        <Row label="Scrape" value={net.scrapeSummary} />
        <Row label="Endpoint" value={net.endpoint} />
      </section>

      {Array.isArray(model.details) && model.details.length > 0 && (
        <section className="topo-tip-section">
          <h4>Ingress</h4>
          {model.details.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </section>
      )}

      <section className="topo-tip-section">
        <h4>Role</h4>
        <p>{model.role}</p>
      </section>

      <section className="topo-tip-section">
        <h4>Connections</h4>
        <p>{model.connections}</p>
      </section>

      <section className="topo-tip-section learning">
        <h4>Learning note</h4>
        <p>{model.learning}</p>
      </section>

      <p className="topo-tip-hint">
        {pinned ? "Pinned · Esc or × to close" : "Click to pin · Esc to close"}
      </p>
    </div>
  );
}
