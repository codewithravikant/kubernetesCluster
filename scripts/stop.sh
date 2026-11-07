#!/usr/bin/env bash
# Power off Minikube (disks kept). Does not delete the profile.
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
lab_ui_log_tee "${ROOT}/logs/lab-power-ui.log"

need_cmd minikube
profile="$(cluster_profile)"
"${ROOT}/scripts/host-forwards.sh" stop || true
write_progress "stop" "running" "Stopping Minikube profile ${profile}"
log "Stopping Minikube profile ${profile}..."
minikube stop -p "$profile"
write_progress "stop" "done" "Minikube stopped"
log "Done. Disks kept — use make start to bring it back."
