#!/usr/bin/env bash
# Restart Minikube: stop then start (disks kept; no re-provision).
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

"${ROOT}/scripts/stop.sh"
"${ROOT}/scripts/start.sh"
