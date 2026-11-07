#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -f "$ROOT/manifests/app/backend-deployment.yaml"
test -f "$ROOT/cicd/Jenkinsfile"
test -f "$ROOT/config/cluster.yml"
test -f "$ROOT/scripts/chronicles.sh"
test -d "$ROOT/dashboard"
echo "layout OK"
