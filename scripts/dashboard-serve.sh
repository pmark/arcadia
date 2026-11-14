#!/usr/bin/env bash
# Starts the live dashboard (port 3020). The services script runs this under launchd.
#
# It serves the newest production build, because `next dev` compiles pages on demand and sent a phone
# about 8 MB of unoptimized script (docs/design/relay/workspace-layers.md). The commit this checkout is
# on may be newer than that build, so a build starts behind the running dashboard, and
# scripts/dashboard-build.sh switches over when it passes. With no build yet this falls back to
# `next dev`, so a restart never depends on a build.
# To force `next dev`, create apps/dashboard/.live/use-next-dev, then restart.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="${ARCADIA_DASHBOARD_REPO:-$(cd "$SCRIPTS/.." && pwd -P)}"
DASHBOARD="$REPO/apps/dashboard"
NEXT="${ARCADIA_DASHBOARD_NEXT:-$DASHBOARD/node_modules/next/dist/bin/next}"
LIVE="$DASHBOARD/.live"
PORT="${ARCADIA_DASHBOARD_PORT:-3020}"

# shellcheck source=lib/dashboard-next-env.sh
source "$SCRIPTS/lib/dashboard-next-env.sh"
# The build switches by restarting this launchd job, so it needs the job's name. launchd names the job in
# this variable, but macOS resets it to "0" in any process the job forks, so it's passed on under another name.
export ARCADIA_DASHBOARD_JOB="${XPC_SERVICE_NAME:-}"
# A build killed by the last restart can't tidy up after itself. A build that's still running needs its mark, so it's left alone.
if ! build_lock_is_live "$LIVE/build.lock"; then
  heal_next_env "$REPO"
fi

cd "$DASHBOARD"

if [[ "${ARCADIA_DASHBOARD_MODE:-build}" == "dev" || -f "$LIVE/use-next-dev" ]]; then
  exec node "$NEXT" dev -H 127.0.0.1 -p "$PORT"
fi

slot=""
commit=""
if [[ -f "$LIVE/current" ]]; then read -r slot commit < "$LIVE/current" || true; fi

head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
if [[ "$commit" != "$head" || -z "$slot" || ! -f "$LIVE/$slot/BUILD_ID" ]]; then
  mkdir -p "$LIVE"
  "$SCRIPTS/dashboard-build.sh" >> "$LIVE/build.log" 2>&1 &
fi

if [[ -n "$slot" && -f "$LIVE/$slot/BUILD_ID" ]]; then
  export ARCADIA_DASHBOARD_DIST=".live/$slot"
  exec node "$NEXT" start -H 127.0.0.1 -p "$PORT"
fi
exec node "$NEXT" dev -H 127.0.0.1 -p "$PORT"
