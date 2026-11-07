#!/usr/bin/env bash
# Ensure dashboard/node_modules matches this host OS/arch.
# Fixes Mac→Linux copies that leave @rollup/rollup-darwin-* and break vite build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$(cd "${SCRIPT_DIR}/../dashboard" && pwd)"

cd "${DASHBOARD_DIR}"

need_reinstall=0

if [[ ! -d node_modules ]]; then
  need_reinstall=1
elif ! node -e "
const { platform, arch } = process;
const names = [
  \`@rollup/rollup-\${platform}-\${arch}-gnu\`,
  \`@rollup/rollup-\${platform}-\${arch}-musl\`,
  \`@rollup/rollup-\${platform}-\${arch}\`,
];
for (const n of names) {
  try { require(n); process.exit(0); } catch (_) {}
}
process.exit(1);
" 2>/dev/null; then
  echo "Dashboard deps look wrong for $(uname -s)/$(uname -m) (missing native Rollup). Reinstalling..."
  need_reinstall=1
fi

if [[ "${need_reinstall}" -eq 1 ]]; then
  rm -rf node_modules
  npm_config_update_notifier=false npm install
fi
