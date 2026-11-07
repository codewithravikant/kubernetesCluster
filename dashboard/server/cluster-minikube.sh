#!/bin/bash
# Dashboard cluster shell: minikube status, ip, and version only.
set -eu

REAL="${CHRONICLES_MINIKUBE:-}"
if [[ -z "$REAL" || ! -x "$REAL" ]]; then
  echo "minikube is not available on this host" >&2
  exit 127
fi

if [[ $# -eq 0 ]]; then
  echo "usage: minikube status|ip|version [-p chronicles]" >&2
  exit 1
fi

deny() {
  echo "cluster shell: $*" >&2
  exit 1
}

cmd=""
expect=""
for arg in "$@"; do
  if [[ -n "$expect" ]]; then
    expect=""
    continue
  fi
  case "$arg" in
    -p|--profile|-o|--output)
      expect=value
      ;;
    --profile=*|--output=*)
      ;;
    status|ip|version)
      if [[ -n "$cmd" ]]; then
        deny "unexpected extra command: ${arg}"
      fi
      cmd="$arg"
      ;;
    *)
      deny "minikube ${arg} is not available here. Use status, ip, or version."
      ;;
  esac
done

if [[ -z "$cmd" ]]; then
  deny "use minikube status, ip, or version"
fi

if [[ -n "${CHRONICLES_HOST_PATH:-}" ]]; then
  export PATH="$CHRONICLES_HOST_PATH"
fi
exec "$REAL" "$@"
