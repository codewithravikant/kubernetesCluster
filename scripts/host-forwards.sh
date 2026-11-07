#!/usr/bin/env bash
# Keep loopback listeners for cluster UIs.
# The dashboard Observe API reads Prometheus, Elasticsearch, and Grafana on
# 127.0.0.1 for the local dashboard Observe page.
# Prometheus is the Helm service kps-prometheus (fullnameOverride: kps).
# Jenkins is on 18080 so it does not share port 8080 with the app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="${ROOT}/logs/forwards"
mkdir -p "${PID_DIR}"

# name|namespace|service|local_port|service_port
FORWARDS=(
  "prometheus|monitoring|kps-prometheus|9090|9090"
  "grafana|monitoring|kube-prometheus-stack-grafana|3001|80"
  "blackbox|monitoring|blackbox-exporter|9115|9115"
  "elasticsearch|logging|elasticsearch-http|9200|9200"
  "kibana|logging|kibana|5601|5601"
  "app|app|frontend|8080|80"
  "jenkins|cicd|jenkins|18080|8080"
)

log() { printf '[forwards] %s\n' "$*"; }

port_open() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn | grep -E -q "127\\.0\\.0\\.1:${port}([^0-9]|$)"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

alive() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

kill_pid() {
  local pid="${1:-}"
  alive "${pid}" || return 0
  kill "${pid}" 2>/dev/null || true
  local _
  for _ in 1 2 3 4 5; do
    alive "${pid}" || return 0
    sleep 0.2
  done
  kill -9 "${pid}" 2>/dev/null || true
}

# Our supervisor and its kubectl child. Skip the pgrep process itself.
matching_pids() {
  local pattern="$1"
  local pid comm
  while read -r pid; do
    [[ -n "${pid}" ]] || continue
    comm="$(ps -p "${pid}" -o comm= 2>/dev/null || true)"
    [[ "${comm}" == "pgrep" ]] && continue
    printf '%s\n' "${pid}"
  done < <(pgrep -f "${pattern}" 2>/dev/null || true)
}

stop_one() {
  local name="$1" ns="$2" svc="$3" local_port="$4" remote_port="$5"
  local pidfile="${PID_DIR}/${name}.pid"
  local pid="" child
  if [[ -f "${pidfile}" ]]; then
    pid="$(tr -d '[:space:]' <"${pidfile}" 2>/dev/null || true)"
    rm -f "${pidfile}"
  fi
  if [[ -n "${pid}" ]]; then
    while read -r child; do
      kill_pid "${child}"
    done < <(pgrep -P "${pid}" 2>/dev/null || true)
    kill_pid "${pid}"
  fi
  while read -r child; do
    kill_pid "${child}"
  done < <(matching_pids "host-forwards.sh supervise ${ns} ${svc} ${local_port} ${remote_port}")
  while read -r child; do
    kill_pid "${child}"
  done < <(matching_pids "port-forward --address 127.0.0.1 svc/${svc} ${local_port}:${remote_port}")
}

supervise() {
  local ns="$1" svc="$2" local_port="$3" remote_port="$4"
  while true; do
    kubectl -n "${ns}" port-forward --address 127.0.0.1 \
      "svc/${svc}" "${local_port}:${remote_port}" || true
    sleep 2
  done
}

start_one() {
  local name="$1" ns="$2" svc="$3" local_port="$4" remote_port="$5"
  local pidfile="${PID_DIR}/${name}.pid"
  local logfile="${PID_DIR}/${name}.log"
  local pid="" existing=""
  if [[ -f "${pidfile}" ]]; then
    pid="$(tr -d '[:space:]' <"${pidfile}" 2>/dev/null || true)"
  fi
  if alive "${pid}" && port_open "${local_port}"; then
    log "${name} already listening on 127.0.0.1:${local_port}"
    return 0
  fi
  if alive "${pid}"; then
    log "${name} has no listener — restarting"
    stop_one "${name}" "${ns}" "${svc}" "${local_port}" "${remote_port}"
  fi
  existing="$(matching_pids "host-forwards.sh supervise ${ns} ${svc} ${local_port} ${remote_port}" | head -n 1 || true)"
  if [[ -n "${existing}" ]] && port_open "${local_port}"; then
    printf '%s\n' "${existing}" >"${pidfile}"
    log "${name} already listening on 127.0.0.1:${local_port}"
    return 0
  fi
  if port_open "${local_port}"; then
    log "${name} 127.0.0.1:${local_port} is already in use"
    return 0
  fi

  nohup bash "${BASH_SOURCE[0]}" supervise "${ns}" "${svc}" "${local_port}" "${remote_port}" \
    >>"${logfile}" 2>&1 </dev/null &
  echo $! >"${pidfile}"
  log "started ${name} pid $(cat "${pidfile}")  127.0.0.1:${local_port} -> ${ns}/${svc}:${remote_port}"
}

wait_one() {
  local name="$1" port="$2" logfile="${PID_DIR}/${name}.log"
  local _
  for _ in $(seq 1 25); do
    if port_open "${port}"; then
      return 0
    fi
    sleep 0.2
  done
  log "WARNING ${name} is not listening on 127.0.0.1:${port} yet"
  if [[ -f "${logfile}" ]]; then
    tail -n 5 "${logfile}" | sed 's/^/[forwards]   /'
  fi
  return 1
}

cmd_start() {
  if ! kubectl get --raw=/readyz --request-timeout=8s >/dev/null 2>&1; then
    log "API server not reachable — skipped"
    exit 0
  fi
  local spec name ns svc lp rp failed=0
  for spec in "${FORWARDS[@]}"; do
    IFS='|' read -r name ns svc lp rp <<<"${spec}"
    start_one "${name}" "${ns}" "${svc}" "${lp}" "${rp}"
  done
  for spec in "${FORWARDS[@]}"; do
    IFS='|' read -r name ns svc lp rp <<<"${spec}"
    wait_one "${name}" "${lp}" || failed=1
  done
  if [[ "${failed}" -ne 0 ]]; then
    log "one or more forwards are still starting"
    exit 1
  fi
  log "ready"
}

cmd_stop() {
  local spec name ns svc lp rp
  for spec in "${FORWARDS[@]}"; do
    IFS='|' read -r name ns svc lp rp <<<"${spec}"
    stop_one "${name}" "${ns}" "${svc}" "${lp}" "${rp}"
    log "stopped ${name}"
  done
}

cmd_status() {
  local spec name ns svc lp rp
  for spec in "${FORWARDS[@]}"; do
    IFS='|' read -r name ns svc lp rp <<<"${spec}"
    if port_open "${lp}"; then
      log "${name} up  127.0.0.1:${lp} -> ${ns}/${svc}:${rp}"
    else
      log "${name} down (expected 127.0.0.1:${lp})"
    fi
  done
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  supervise) supervise "$2" "$3" "$4" "$5" ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
