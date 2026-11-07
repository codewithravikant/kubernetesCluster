#!/usr/bin/env bash
# Minikube's kubelet pulls images on the node, outside CoreDNS, and the
# in-cluster registry is plain HTTP. Point the node at that registry.
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

profile="$(cluster_profile)"
if ! kubectl -n cicd get svc registry >/dev/null 2>&1; then
  log "registry service is not installed — skip node pull config"
  exit 0
fi
ip="$(kubectl -n cicd get svc registry -o jsonpath='{.spec.clusterIP}')"
if [[ -z "${ip}" ]]; then
  die "registry ClusterIP is empty"
fi

minikube ssh -p "${profile}" --native-ssh=true -- "sudo sh -c '
set -eu
dir=/etc/containerd/certs.d/registry.cicd.svc.cluster.local:5000
mkdir -p \"\$dir\"
cat > \"\$dir/hosts.toml\" <<EOF
server = \"http://registry.cicd.svc.cluster.local:5000\"

[host.\"http://registry.cicd.svc.cluster.local:5000\"]
  capabilities = [\"pull\", \"resolve\"]
EOF
grep -q \"${ip} registry.cicd.svc.cluster.local\" /etc/hosts || echo \"${ip} registry.cicd.svc.cluster.local\" >> /etc/hosts
systemctl restart containerd
'"
log "Node can pull http://registry.cicd.svc.cluster.local:5000 (${ip})"
