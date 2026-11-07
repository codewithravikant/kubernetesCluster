#!/usr/bin/env bash
# Start an existing Minikube profile (no full reinstall).
# First-time / blank slate: use make chronicles instead.
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

need_cmd minikube
validate_cluster_yml
profile="$(cluster_profile)"
cpus="$(cluster_cpus)"
mem="$(cluster_memory_mb)"
disk="$(cluster_disk_gb)g"
driver="$(cluster_driver)"

docker_cpus="$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "$cpus")"
if [[ "$docker_cpus" =~ ^[0-9]+$ ]] && (( cpus > docker_cpus )); then
  log "Clamping cpus ${cpus} → ${docker_cpus} (Docker available CPUs)"
  cpus="$docker_cpus"
fi

write_progress "start" "running" "Starting Minikube profile ${profile}"
log "Starting Minikube profile ${profile} (${cpus} CPU, ${mem} MB)..."
minikube start \
  -p "$profile" \
  --driver="$driver" \
  --cpus="$cpus" \
  --memory="$mem" \
  --disk-size="$disk"
minikube profile "$profile"
"${ROOT}/scripts/configure-registry-pull.sh" || log "Registry pull config was not applied"
if ! "${ROOT}/scripts/host-forwards.sh" start; then
  log "Host forwards are still starting — Observe charts need them"
fi
write_progress "start" "done" "Minikube started"
log "Done. Run make status to check pods."
