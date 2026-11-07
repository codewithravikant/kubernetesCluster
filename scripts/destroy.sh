#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
lab_ui_log_tee "${ROOT}/logs/lab-power-ui.log"

profile="$(cluster_profile)"
"${ROOT}/scripts/host-forwards.sh" stop || true
write_progress "destroy" "running" "Deleting Minikube profile ${profile}"
log "Deleting Minikube profile ${profile}..."
minikube delete -p "$profile" || true
write_progress "destroy" "done" "Minikube profile deleted"
log "Done."
