#!/usr/bin/env bash
# Shared helpers for Cluster Chronicles Make targets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT

CLUSTER_YML="${ROOT}/config/cluster.yml"
PROGRESS_JSON="${ROOT}/logs/lab-progress.json"
PROGRESS_PID="${ROOT}/logs/lab-progress.pid"
MAX_CPUS=8
MAX_MEMORY_MB=18432

# Ordered phases for make chronicles (shown in the dashboard overlay).
CHRONICLES_PHASES=(tools minikube images secrets manifests monitoring cicd ready)

log() { printf '[chronicles] %s\n' "$*"; }
die() { printf '[chronicles] ERROR: %s\n' "$*" >&2; exit 1; }

# Mirror stdout/stderr into the dashboard overlay terminal when run from a TTY.
# Skipped when the dashboard already redirected stdio to the same log file.
lab_ui_log_tee() {
  local logfile="${1:?}"
  mkdir -p "$(dirname "$logfile")"
  if [[ -t 1 ]]; then
    exec > >(tee -a "$logfile") 2>&1
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

phase_label() {
  case "$1" in
    tools) echo "Tools" ;;
    minikube) echo "Minikube" ;;
    images) echo "Images" ;;
    secrets) echo "Secrets" ;;
    manifests) echo "Manifests" ;;
    monitoring) echo "Monitoring" ;;
    cicd) echo "CI/CD" ;;
    ready) echo "Ready" ;;
    start) echo "Starting" ;;
    stop) echo "Stopping" ;;
    destroy) echo "Destroying" ;;
    *) printf '%s' "$1" ;;
  esac
}

phase_percent() {
  local phase="$1" status="$2"
  if [[ "$status" == "done" ]]; then
    echo 100
    return
  fi
  case "$phase" in
    tools) echo 8 ;;
    minikube) echo 20 ;;
    images) echo 35 ;;
    secrets) echo 42 ;;
    manifests) echo 55 ;;
    monitoring) echo 70 ;;
    cicd) echo 85 ;;
    ready) echo 92 ;;
    start|stop|destroy) echo 40 ;;
    *) echo 15 ;;
  esac
}

progress_command_for() {
  case "$1" in
    start|stop|destroy) printf '%s' "$1" ;;
    *) echo chronicles ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

yaml_get() {
  # yaml_get <key> — reads simple key: value from config/cluster.yml
  local key="$1"
  awk -F': *' -v k="$key" '$1 == k { gsub(/["'\'']/,"",$2); print $2; exit }' "$CLUSTER_YML"
}

cluster_profile() { yaml_get profile; }
cluster_cpus() { yaml_get cpus; }
cluster_memory_mb() { yaml_get memory_mb; }
cluster_disk_gb() { yaml_get disk_size_gb; }
cluster_driver() { yaml_get driver; }

validate_cluster_yml() {
  local cpus mem
  cpus="$(cluster_cpus)"
  mem="$(cluster_memory_mb)"
  [[ "$cpus" =~ ^[0-9]+$ ]] || die "config/cluster.yml: cpus must be an integer"
  [[ "$mem" =~ ^[0-9]+$ ]] || die "config/cluster.yml: memory_mb must be an integer"
  if (( cpus > MAX_CPUS )); then
    die "cpus=${cpus} exceeds hard cap ${MAX_CPUS} (edit config/cluster.yml)"
  fi
  if (( mem > MAX_MEMORY_MB )); then
    die "memory_mb=${mem} exceeds hard cap ${MAX_MEMORY_MB} (edit config/cluster.yml)"
  fi
}

write_progress() {
  mkdir -p "$(dirname "$PROGRESS_JSON")"
  local phase="$1"
  local status="$2"
  local message="${3:-}"
  local command label percent running ready error_json
  local machines_json="" sep="" p st hit=0

  command="$(progress_command_for "$phase")"
  label="$(phase_label "$phase")"
  percent="$(phase_percent "$phase" "$status")"

  # Keep a live PID so the dashboard can tell running from failed.
  printf '%s\n' "$$" >"$PROGRESS_PID"

  if [[ "$status" == "done" ]]; then
    running=false
    ready=true
    error_json=null
  elif [[ "$status" == "failed" || "$status" == "error" ]]; then
    running=false
    ready=false
    error_json="\"$(json_escape "$message")\""
  else
    running=true
    ready=false
    error_json=null
  fi

  if [[ "$command" == "chronicles" ]]; then
    for p in "${CHRONICLES_PHASES[@]}"; do
      if [[ "$status" == "done" ]]; then
        st=done
      elif [[ "$p" == "$phase" ]]; then
        st=running
        [[ "$status" == "running" ]] || st="$status"
        hit=1
      elif [[ "$hit" -eq 0 ]]; then
        st=done
      else
        st=pending
      fi
      machines_json+="${sep}\"${p}\":{\"status\":\"${st}\",\"label\":\"$(phase_label "$p")\"}"
      sep=","
    done
  else
    local row_status=running
    [[ "$status" == "done" ]] && row_status=done
    machines_json="\"${phase}\":{\"status\":\"${row_status}\",\"label\":\"$(phase_label "$phase")\"}"
  fi

  cat >"$PROGRESS_JSON" <<EOF
{
  "running": ${running},
  "ready": ${ready},
  "error": ${error_json},
  "command": "$(json_escape "$command")",
  "phase": "$(json_escape "$phase")",
  "phaseLabel": "$(json_escape "$label")",
  "status": "$(json_escape "$status")",
  "percent": ${percent},
  "message": "$(json_escape "$message")",
  "machines": {${machines_json}},
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pid": $$
}
EOF
}
