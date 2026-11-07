#!/bin/bash
# Dashboard cluster shell: inspect and pod checks only.
# Mutating kubectl verbs, secret reads, and local manifest files are refused.
set -eu

REAL="${CHRONICLES_KUBECTL:-}"
if [[ -z "$REAL" || ! -x "$REAL" ]]; then
  echo "kubectl is not available on this host" >&2
  exit 127
fi

if [[ $# -eq 0 ]]; then
  echo "usage: kubectl get|describe|logs|exec|top|cluster-info|version ..." >&2
  exit 1
fi

deny() {
  echo "cluster shell: $*" >&2
  exit 1
}

is_denied_word() {
  case "$1" in
    delete|apply|create|patch|replace|edit|scale|drain|cordon|uncordon|taint|run|debug|cp|port-forward|proxy|attach|set|label|annotate|expose|autoscale|certificate|plugin|alpha|convert|kustomize|wait|undo|restart|pause|resume|retry|approve|deny|secret|secrets|dump)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

takes_value() {
  case "$1" in
    -n|--namespace|-c|--container|-l|--selector|-o|--output|--tail|--since|--since-time|--context|--cluster|--user|--as|--as-group|--as-uid|--field-selector|--request-timeout|--chunk-size|--cache-dir|--log-file|--sort-by|--address|--namespaces|-v|--v)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_allowed_flag() {
  case "$1" in
    -n|--namespace|-c|--container|-l|--selector|-o|--output|--tail|--since|--since-time|--context|--cluster|--user|--as|--as-group|--as-uid|--field-selector|--request-timeout|--chunk-size|--cache-dir|--log-file|--sort-by|--address|--namespaces|-v|--v|--namespace=*|--container=*|--selector=*|--output=*|--tail=*|--since=*|--since-time=*|--context=*|--cluster=*|--user=*|--as=*|--as-group=*|--field-selector=*|--request-timeout=*|--sort-by=*|--address=*|--namespaces=*|-A|--all-namespaces|--raw|--watch|-w|--timestamps|--prefix|--previous|-p|--show-labels|--show-kind|--no-headers|--ignore-not-found|--follow|-i|--stdin|-t|--tty|-it|-ti|--quiet|-q)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

verb=""
expect=""
for arg in "$@"; do
  if [[ -n "$expect" ]]; then
    expect=""
    continue
  fi
  case "$arg" in
    --)
      break
      ;;
    -*)
      if takes_value "$arg"; then
        expect=value
      fi
      ;;
    *)
      if [[ -z "$verb" ]]; then
        verb="$arg"
      fi
      ;;
  esac
done

case "$verb" in
  get|describe|logs|exec|top|cluster-info|api-resources|api-versions|version|explain|diff|options|help|auth|rollout|config)
    ;;
  "")
    deny "pick a command: get, describe, logs, exec, top, cluster-info, or version"
    ;;
  *)
    deny "'${verb}' is not available here. Use get, describe, logs, exec, top, cluster-info, or version."
    ;;
esac

expect=""
seen_can_i=0
seen_rollout=0
seen_config=0
past_dd=0
for arg in "$@"; do
  if [[ "$past_dd" -eq 1 ]]; then
    if [[ "$verb" != "exec" ]]; then
      deny "only kubectl exec accepts a command after --"
    fi
    continue
  fi
  if [[ -n "$expect" ]]; then
    case "$expect" in
      rollout)
        if [[ "$arg" != "status" && "$arg" != "history" ]]; then
          deny "rollout status or rollout history only"
        fi
        seen_rollout=1
        ;;
      config)
        if [[ "$arg" != "current-context" && "$arg" != "get-contexts" ]]; then
          deny "config current-context or config get-contexts only"
        fi
        seen_config=1
        ;;
      auth)
        if [[ "$arg" != "can-i" ]]; then
          deny "auth can-i only"
        fi
        seen_can_i=1
        ;;
      value)
        ;;
    esac
    expect=""
    continue
  fi
  case "$arg" in
    --)
      past_dd=1
      ;;
    -f)
      if [[ "$verb" != "logs" ]]; then
        deny "local files are not opened here. logs -f follows a log stream."
      fi
      ;;
    --kubeconfig|--kubeconfig=*|--filename|--filename=*|--kustomize|-k|--recursive|-R|--force|--prune|--save-config|--record|--cascade|--cascade=*|--now|--wait|--grace-period|--grace-period=*|--rm|--privileged|--token|--token=*|--server|--server=*|--client-key|--client-key=*|--client-certificate|--client-certificate=*|--certificate-authority|--certificate-authority=*)
      deny "flag ${arg} is not allowed"
      ;;
    -*)
      if ! is_allowed_flag "$arg"; then
        deny "flag ${arg} is not allowed"
      fi
      if takes_value "$arg"; then
        expect=value
      fi
      ;;
    auth)
      expect=auth
      ;;
    rollout)
      expect=rollout
      ;;
    config)
      expect=config
      ;;
    *)
      if is_denied_word "$arg"; then
        deny "'${arg}' is not available in this shell"
      fi
      ;;
  esac
done

if [[ "$verb" == "auth" && "$seen_can_i" -ne 1 ]]; then
  deny "auth can-i only"
fi
if [[ "$verb" == "rollout" && "$seen_rollout" -ne 1 ]]; then
  deny "rollout status or rollout history only"
fi
if [[ "$verb" == "config" && "$seen_config" -ne 1 ]]; then
  deny "config current-context or config get-contexts only"
fi

if [[ -n "${CHRONICLES_HOST_PATH:-}" ]]; then
  export PATH="$CHRONICLES_HOST_PATH"
fi
exec "$REAL" "$@"
