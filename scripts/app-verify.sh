#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

need_cmd kubectl

pass=0
fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "OK  ${name}"
    pass=$((pass + 1))
  else
    echo "FAIL ${name}"
    fail=$((fail + 1))
  fi
}

contains_ok() {
  printf '%s' "$1" | grep -q '"ok":true'
}

contains_metric() {
  printf '%s' "$1" | grep -q chronicles_diagnostic_polls_total
}

# Smoke curls must run from cicd: app NetworkPolicy default-denies ingress and
# allow-dns applies egress to every pod, so unlabeled pods in app can only do DNS.
smoke_curl() {
  local name="$1"
  shift
  kubectl run "${name}" --rm -i --restart=Never -n cicd \
    --image=curlimages/curl:8.10.1 --command -- \
    curl -sf --max-time 15 "$@"
}

be="$(kubectl get deploy backend -n app -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)"
fe="$(kubectl get deploy frontend -n app -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)"
check "backend replicas == 1" test "${be:-0}" -eq 1
check "frontend replicas >= 2" test "${fe:-0}" -ge 2

check "frontend serves /" smoke_curl app-verify-fe \
  -o /dev/null http://frontend.app.svc.cluster.local/

be_health="$(smoke_curl app-verify-be http://backend.app.svc.cluster.local:3000/health 2>/dev/null || true)"
check "backend /health" contains_ok "$be_health"

fe_to_be="$(kubectl exec -n app deploy/frontend -- \
  curl -sf --max-time 15 http://backend:3000/health 2>/dev/null || true)"
check "frontend reaches backend" contains_ok "$fe_to_be"

metric="$(smoke_curl app-verify-metric \
  http://backend.app.svc.cluster.local:3000/metrics/prom 2>/dev/null || true)"
check "custom metric chronicles_diagnostic_polls_total" contains_metric "$metric"

echo "Passed: ${pass}  Failed: ${fail}"
test "$fail" -eq 0
