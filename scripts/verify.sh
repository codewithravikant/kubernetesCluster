#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

need_cmd kubectl
ROOT_DIR="$ROOT"

pass=0
fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    printf 'OK   %s\n' "$name"
    pass=$((pass + 1))
  else
    printf 'FAIL %s\n' "$name"
    fail=$((fail + 1))
  fi
}

echo "=== Cluster Chronicles verify ==="

check "minikube running" minikube status -p "$(cluster_profile)" >/dev/null
check "namespace app" kubectl get ns app >/dev/null
check "namespace monitoring" kubectl get ns monitoring >/dev/null
check "namespace logging" kubectl get ns logging >/dev/null
check "namespace cicd" kubectl get ns cicd >/dev/null

be="$(kubectl get deploy backend -n app -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
fe="$(kubectl get deploy frontend -n app -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
check "backend desired replicas 1" test "${be}" = "1"
check "frontend desired replicas 2" test "${fe}" = "2"

check "backend service ClusterIP" kubectl get svc backend -n app -o jsonpath='{.spec.type}' | grep -q ClusterIP
check "frontend service ClusterIP" kubectl get svc frontend -n app -o jsonpath='{.spec.type}' | grep -q ClusterIP
check "ingress exists" kubectl get ingress chronicles -n app >/dev/null
check "ingress metrics ServiceMonitor" kubectl get servicemonitor ingress-nginx-controller -n ingress-nginx >/dev/null
check "ingress blackbox exporter" kubectl get deploy blackbox-exporter -n monitoring >/dev/null
check "HPA frontend" kubectl get hpa frontend -n app >/dev/null

check "backend PVC Bound" kubectl get pvc backend-data -n app -o jsonpath='{.status.phase}' | grep -q Bound
check "NetworkPolicy default-deny" kubectl get networkpolicy default-deny-ingress -n app >/dev/null
check "Secret app-secrets" kubectl get secret app-secrets -n app >/dev/null

check "PrometheusRule chronicles-alerts" kubectl get prometheusrule chronicles-alerts -n monitoring >/dev/null 2>&1 || true
check "Fluent Bit DaemonSet" kubectl get ds fluent-bit -n logging >/dev/null
check "Elasticsearch StatefulSet" kubectl get sts elasticsearch -n logging >/dev/null
check "elasticsearch-exporter Deployment" kubectl get deploy elasticsearch-exporter -n logging >/dev/null 2>&1 || true
check "Kibana dashboards ConfigMap" kubectl get cm kibana-dashboards -n logging >/dev/null 2>&1 || true
check "Jenkins or registry in cicd" bash -c 'kubectl get deploy -n cicd 2>/dev/null | grep -Eq "jenkins|registry"'

# Legacy codenames from prior labs — constructed so this file never contains them literally.
legacy_pat() { printf '%s%s|%s%s' 'she' 'rlock' 'al' 'chemy'; }
check "no legacy lab codenames in app/manifests/cicd/config" bash -c "
  ! grep -riE \"\$(printf '%s%s|%s%s' she rlock al chemy)\" \
    --include='*.md' --include='*.yml' --include='*.yaml' --include='*.js' --include='*.jsx' --include='*.groovy' \
    '${ROOT_DIR}/app' '${ROOT_DIR}/manifests' '${ROOT_DIR}/cicd' '${ROOT_DIR}/config' 2>/dev/null \
    | grep -v node_modules | head -1 | grep .
"

check "Trivy stage in Jenkinsfile" grep -q 'Trivy' "${ROOT_DIR}/cicd/Jenkinsfile"
check "no plaintext API keys in manifests" bash -c "! grep -RInE 'AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH )?PRIVATE KEY' '${ROOT_DIR}/manifests' '${ROOT_DIR}/cicd' 2>/dev/null | head -1 | grep ."

echo
echo "Passed: ${pass}  Failed: ${fail}"
test "$fail" -eq 0
