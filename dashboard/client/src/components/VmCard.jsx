import { useEffect, useState } from "react";

const DEFAULT_MEMORY = [256, 512, 768, 1024, 1536, 2048, 3072, 4096];
const DEFAULT_CPUS = [1, 2, 3, 4];

export default function VmCard({
  machine,
  active,
  busy,
  options,
  onSelect,
  onAction,
  onSaveResources,
  onOpenTerminal,
}) {
  const state = machine.state || "unknown";
  const actionKey = (action) => `${machine.name}:${action}`;
  const disabled = busy !== null;
  const memoryOpts = options?.memory || DEFAULT_MEMORY;
  const cpuOpts = options?.cpus || DEFAULT_CPUS;

  const [memory, setMemory] = useState(machine.memory);
  const [cpus, setCpus] = useState(machine.cpus);

  useEffect(() => {
    setMemory(machine.memory);
    setCpus(machine.cpus);
  }, [machine.memory, machine.cpus, machine.name]);

  const dirty = memory !== machine.memory || cpus !== machine.cpus;
  const saving = busy === `${machine.name}:resources`;

  return (
    <article
      className={`vm-card${active ? " active" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div className="vm-head">
        <div className="vm-title">
          <strong>{machine.name}</strong>
          <span>
            {machine.ip} · {machine.role}
          </span>
        </div>
        <span className={`badge ${state}`}>{state.replace("_", " ")}</span>
      </div>

      <div className="meta-row">
        <span>
          Reachable{" "}
          <b style={{ color: machine.reachable ? "var(--ok)" : "var(--muted)" }}>
            {machine.reachable ? "yes" : "no"}
          </b>
        </span>
        <span>
          Config <b>{machine.memory} MB</b> / <b>{machine.cpus} CPU</b>
        </span>
      </div>

      {machine.httpPort ? (
        <div className="meta-row public-row" onClick={(e) => e.stopPropagation()}>
          <span>
            Public{" "}
            {machine.httpOpen && machine.openPath ? (
              <a
                className="public-link"
                href={machine.openPath}
                target="_blank"
                rel="noreferrer"
                title={`Open ${machine.publicUrl} (via dashboard proxy)`}
              >
                {machine.publicUrl}
              </a>
            ) : (
              <b className="public-waiting" title="HTTP not up yet — provision loadbalancer">
                {machine.publicUrl} · waiting
              </b>
            )}
          </span>
        </div>
      ) : null}

      <div className="resource-row" onClick={(e) => e.stopPropagation()}>
        <label className="resource-field">
          <span>RAM</span>
          <select
            value={memory}
            disabled={disabled}
            onChange={(e) => setMemory(Number(e.target.value))}
          >
            {memoryOpts.map((mb) => (
              <option key={mb} value={mb}>
                {mb} MB
              </option>
            ))}
          </select>
        </label>
        <label className="resource-field">
          <span>CPU</span>
          <select
            value={cpus}
            disabled={disabled}
            onChange={(e) => setCpus(Number(e.target.value))}
          >
            {cpuOpts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="resource-actions">
          <button
            className="btn"
            type="button"
            disabled={disabled || !dirty}
            title="Write infrastructure/config/cluster.yml only"
            onClick={() =>
              onSaveResources(machine.name, { memory, cpus, apply: false })
            }
          >
            {saving ? "…" : "Save YAML"}
          </button>
          <button
            className="btn btn-accent"
            type="button"
            disabled={disabled || !dirty}
            title="Write config/cluster.yml and restart Minikube to apply"
            onClick={() =>
              onSaveResources(machine.name, { memory, cpus, apply: true })
            }
          >
            {saving ? "…" : "Save & apply"}
          </button>
        </div>
      </div>

      <div className="actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-accent"
          type="button"
          disabled={disabled}
          title={`SSH as devops@${machine.ip}`}
          onClick={() => onOpenTerminal(machine.name)}
        >
          Terminal
        </button>
        <button
          className="btn"
          type="button"
          disabled={disabled}
          onClick={() => onAction(machine.name, "start")}
        >
          {busy === actionKey("start") ? "…" : "Start"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={disabled}
          onClick={() => onAction(machine.name, "stop")}
        >
          {busy === actionKey("stop") ? "…" : "Stop"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={disabled}
          onClick={() => onAction(machine.name, "restart")}
        >
          {busy === actionKey("restart") ? "…" : "Restart"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={disabled}
          onClick={() => onAction(machine.name, "provision")}
        >
          {busy === actionKey("provision") ? "…" : "Provision"}
        </button>
        <button
          className="btn btn-danger"
          type="button"
          disabled={disabled}
          onClick={() => {
            if (
              window.confirm(
                `Delete Minikube profile? This wipes the cluster (minikube delete).`
              )
            ) {
              onAction(machine.name, "destroy");
            }
          }}
        >
          {busy === actionKey("destroy") ? "…" : "Destroy"}
        </button>
      </div>
    </article>
  );
}
