#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

profile="$(cluster_profile)"
echo "=== Minikube (${profile}) ==="
minikube status -p "$profile" || true
echo
echo "=== Nodes ==="
kubectl get nodes -o wide || true
echo
echo "=== Namespaces (app/monitoring/logging/cicd) ==="
kubectl get pods -A --field-selector=metadata.namespace!=kube-system 2>/dev/null | head -80 || true
echo
echo "=== Ingress ==="
kubectl get ingress -A || true
echo
echo "=== PVC ==="
kubectl get pvc -A || true
