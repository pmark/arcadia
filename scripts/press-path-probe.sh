#!/usr/bin/env bash
#
# Read-only probe of the operator's Tailnet press path (Issue 2633).
#
#   scripts/press-path-probe.sh http://<tailnet-host>:3020/api/operator-script/press-path
#
# Sends one GET (never a POST) and prints one line: ACCEPT, REFUSE or UNREACHABLE.
# Exit 0 on accept, 1 on refuse, 2 on unreachable or a missing URL. It presses nothing
# and writes nothing; it is not wired into START preflight.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO"
ARCADIA_PRESS_PATH_URL="${1:-${ARCADIA_PRESS_PATH_URL:-}}" exec pnpm -s tsx -e \
  "import('./src/operatorActions/pressPathProbe.ts').then(async (m) => { process.exitCode = await m.runPressPathProbeCli(process.env.ARCADIA_PRESS_PATH_URL || undefined); })"
