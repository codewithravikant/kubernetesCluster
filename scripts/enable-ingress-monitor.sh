#!/usr/bin/env bash
# Turn on Ingress monitoring without changing the app's HTTP routes.
# - controller flag --enable-metrics=true (off by default since ingress-nginx 1.12)
# - CoreDNS name chronicles.local → ingress controller (in-cluster only)
# - metrics Service, ServiceMonitor, blackbox probes, Grafana board, alert rules
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NS="ingress-nginx"
DEPLOY="ingress-nginx-controller"
REWRITE="rewrite name chronicles.local ingress-nginx-controller.ingress-nginx.svc.cluster.local"

log() { printf '[ingress-monitor] %s\n' "$*"; }

need() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing $1"
    exit 1
  }
}

need kubectl
need python3

if ! kubectl get deploy "$DEPLOY" -n "$NS" >/dev/null 2>&1; then
  log "controller deployment ${NS}/${DEPLOY} is not installed yet"
  exit 1
fi

enable_metrics() {
  local has
  has="$(kubectl get deploy "$DEPLOY" -n "$NS" -o json | python3 -c '
import json, sys
doc = json.load(sys.stdin)
args = doc["spec"]["template"]["spec"]["containers"][0].get("args") or []
print("yes" if "--enable-metrics=true" in args else "no")
')"
  if [[ "$has" == "yes" ]]; then
    log "controller metrics already enabled"
    return 0
  fi
  log "enabling controller metrics (rolls the addon controller once)"
  kubectl patch deploy "$DEPLOY" -n "$NS" --type json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--enable-metrics=true"}]'
  kubectl rollout status "deploy/${DEPLOY}" -n "$NS" --timeout=180s
}

ensure_dns() {
  local src dst patch rc
  src="$(mktemp)"
  dst="$(mktemp)"
  patch="$(mktemp)"
  kubectl get cm coredns -n kube-system -o json >"$src"
  set +e
  python3 - "$REWRITE" "$src" "$dst" "$patch" <<'PY'
import json, sys
needle, src, dst, patch = sys.argv[1:]
doc = json.load(open(src))
core = doc.get("data", {}).get("Corefile", "")
if needle in core:
    sys.exit(0)
lines = core.splitlines()
out = []
inserted = False
for line in lines:
    out.append(line)
    if not inserted and line.strip() == ".:53 {":
        out.append("    " + needle)
        inserted = True
if not inserted:
    sys.stderr.write("CoreDNS Corefile has no .:53 server block\n")
    sys.exit(2)
text = "\n".join(out) + "\n"
with open(dst, "w", encoding="utf-8") as fh:
    fh.write(text)
with open(patch, "w", encoding="utf-8") as fh:
    json.dump({"data": {"Corefile": text}}, fh)
sys.exit(10)
PY
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    log "CoreDNS already resolves chronicles.local to the ingress controller"
    rm -f "$src" "$dst" "$patch"
    return 0
  fi
  if [[ "$rc" -ne 10 ]]; then
    log "failed to update CoreDNS (status ${rc})"
    rm -f "$src" "$dst" "$patch"
    exit 1
  fi
  kubectl patch cm coredns -n kube-system --type merge --patch-file "$patch"
  rm -f "$src" "$dst" "$patch"
  log "restarting CoreDNS so chronicles.local resolves in the cluster"
  kubectl rollout restart deploy/coredns -n kube-system
  kubectl rollout status deploy/coredns -n kube-system --timeout=120s
}

enable_metrics
ensure_dns

log "applying ingress metrics Service, probes, dashboard, and alerts"
kubectl apply -f "${ROOT}/manifests/monitoring/ingress-nginx-metrics.yaml"
kubectl apply -f "${ROOT}/manifests/monitoring/ingress-blackbox.yaml"
kubectl apply -f "${ROOT}/manifests/monitoring/ingress-dashboard.yaml"
kubectl apply -f "${ROOT}/manifests/monitoring/prometheus-rules.yaml"
kubectl rollout status deploy/blackbox-exporter -n monitoring --timeout=180s
ip="$(minikube ip -p chronicles 2>/dev/null || true)"
if [[ -n "$ip" ]]; then
  curl -fsS -o /dev/null --max-time 8 -H "Host: chronicles.local" "http://${ip}/" || true
  curl -fsS -o /dev/null --max-time 8 -H "Host: chronicles.local" "http://${ip}/api/health" || true
fi
log "ingress monitoring is applied"
