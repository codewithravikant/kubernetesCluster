#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Cluster Chronicles — review checklist"
echo
"${ROOT}/scripts/verify.sh"
echo
"${ROOT}/scripts/app-verify.sh"
echo
echo "Oral / dashboard:"
echo "  make dashboard"
echo "  Grafana / Kibana / Jenkins via port-forward (see docs/how-to-run.md)"
echo "  Alert demos: manifests/testing/ + docs/monitoring.md"
