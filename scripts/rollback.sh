#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

need_cmd kubectl
log "Rolling back backend and frontend deployments..."
kubectl rollout undo deployment/backend -n app
kubectl rollout undo deployment/frontend -n app
kubectl rollout status deployment/backend -n app --timeout=180s
kubectl rollout status deployment/frontend -n app --timeout=180s
log "Rollback complete."
