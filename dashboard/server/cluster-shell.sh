#!/bin/bash
# Interactive host shell for the dashboard Cluster tab.
# PATH contains kubectl/minikube wrappers plus a few text filters.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

resolve() {
  command -v "$1" 2>/dev/null || true
}

KUBECTL_BIN="$(resolve kubectl)"
MINIKUBE_BIN="$(resolve minikube)"
RM_BIN="$(resolve rm)"
if [[ -z "$KUBECTL_BIN" ]]; then
  echo "kubectl is not on PATH for the dashboard process" >&2
  exit 127
fi

PATHDIR="$(mktemp -d "${TMPDIR:-/tmp}/chronicles-cluster.XXXXXX")"
cleanup() {
  if [[ -n "${RM_BIN:-}" ]]; then
    "$RM_BIN" -rf "$PATHDIR"
  fi
}
trap cleanup EXIT

ln -s "$DIR/cluster-kubectl.sh" "$PATHDIR/kubectl"
ln -s "$DIR/cluster-minikube.sh" "$PATHDIR/minikube"
for tool in head tail grep wc sort uniq cut tr column clear; do
  bin="$(resolve "$tool")"
  if [[ -n "$bin" ]]; then
    ln -s "$bin" "$PATHDIR/$tool"
  fi
done

export CHRONICLES_KUBECTL="$KUBECTL_BIN"
export CHRONICLES_MINIKUBE="$MINIKUBE_BIN"
export CHRONICLES_HOST_PATH="$PATH"
export PATH="$PATHDIR"
export PS1='cluster$ '
export TERM="${TERM:-xterm-256color}"
export BASH_SILENCE_DEPRECATION_WARNING=1
unset BASH_ENV ENV || true
cd "$ROOT"

printf '%s\n' "Cluster shell. Profile checks run on this host."
printf '%s\n' "kubectl get, describe, logs, exec · minikube status, ip, version"
printf '%s\n' "apply, delete, and minikube delete are refused here."

/bin/bash --noprofile --norc -r -i
