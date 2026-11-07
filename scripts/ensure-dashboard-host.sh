#!/usr/bin/env bash
# Ensure the dashboard loopback IP exists (macOS needs an lo0 alias).
set -euo pipefail

HOST="${DASHBOARD_HOST:-127.10.10.10}"

# Linux: entire 127.0.0.0/8 is loopback — nothing to do.
# macOS: only 127.0.0.1 is present unless we add an alias.
if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

if ifconfig lo0 2>/dev/null | grep -Fq "${HOST}"; then
  exit 0
fi

echo "Adding loopback alias ${HOST} on lo0 (may ask for password)…"
if ifconfig lo0 alias "${HOST}" up 2>/dev/null; then
  exit 0
fi

if sudo ifconfig lo0 alias "${HOST}" up; then
  echo "Loopback alias ${HOST} ready."
  exit 0
fi

echo "Could not add ${HOST}. Run: sudo ifconfig lo0 alias ${HOST} up" >&2
exit 1
