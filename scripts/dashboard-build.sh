#!/usr/bin/env bash
# Builds the live dashboard behind the running one, then switches to it (see scripts/dashboard-serve.sh).
#
# There are two build folders, so the one being served is never touched. Nothing switches until the new
# build has started and answered on a spare port. Any failure leaves the current build serving. While
# production is Active the shared services are frozen, so a finished build waits for the next restart.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="${ARCADIA_DASHBOARD_REPO:-$(cd "$SCRIPTS/.." && pwd -P)}"
DASHBOARD="$REPO/apps/dashboard"
NEXT="${ARCADIA_DASHBOARD_NEXT:-$DASHBOARD/node_modules/next/dist/bin/next}"
LIVE="$DASHBOARD/.live"
LOCK="$LIVE/build.lock"
SMOKE_PORT="${ARCADIA_DASHBOARD_SMOKE_PORT:-3023}"
BUILD_DEADLINE="${ARCADIA_DASHBOARD_BUILD_DEADLINE:-1200}"
SMOKE_DEADLINE="${ARCADIA_DASHBOARD_SMOKE_DEADLINE:-60}"
NEXT_ENV="apps/dashboard/next-env.d.ts"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mkdir -p "$LIVE"
# One build at a time. A lock left by a process that died doesn't count.
if ! mkdir "$LOCK" 2>/dev/null; then
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then log "A build is already running (pid $holder)."; exit 0; fi
  rm -rf "${LOCK:?}"
  mkdir "$LOCK"
fi
echo "$$" > "$LOCK/pid"

saved_env=""
restore_next_env() {
  [[ -n "$saved_env" ]] || return 0
  cp "$saved_env" "$REPO/$NEXT_ENV"
  git -C "$REPO" update-index --no-skip-worktree "$NEXT_ENV"
  rm -f "${saved_env:?}"
  saved_env=""
}
smoke_pid=""
cleanup() {
  [[ -z "$smoke_pid" ]] || kill "$smoke_pid" 2>/dev/null || true
  restore_next_env
  rm -rf "${LOCK:?}"
}
trap cleanup EXIT

slot=""
built=""
if [[ -f "$LIVE/current" ]]; then read -r slot built < "$LIVE/current" || true; fi
target="a"
[[ "$slot" == "a" ]] && target="b"

for attempt in 1 2; do
  head="$(git -C "$REPO" rev-parse HEAD)"
  [[ "$head" != "$built" ]] || { log "The build is already at $head."; exit 0; }

  # Commits that can't change the dashboard don't need a build or a restart.
  if [[ -n "$slot" && -f "$LIVE/$slot/BUILD_ID" ]] && git -C "$REPO" cat-file -e "$built^{commit}" 2>/dev/null &&
    git -C "$REPO" diff --quiet "$built" "$head" -- apps/dashboard src package.json pnpm-lock.yaml; then
    printf '%s %s\n' "$slot" "$head" > "$LIVE/current.tmp"
    mv "$LIVE/current.tmp" "$LIVE/current"
    log "Nothing for the dashboard changed between $built and $head."
    exit 0
  fi

  # A build rewrites this tracked file to point at its own folder. It's put back afterwards, and marked so the checkout reads as clean meanwhile.
  saved_env="$(mktemp "$LIVE/next-env.XXXXXX")"
  cp "$REPO/$NEXT_ENV" "$saved_env"
  git -C "$REPO" update-index --skip-worktree "$NEXT_ENV"

  log "Building $head into .live/$target."
  export ARCADIA_DASHBOARD_DIST=".live/$target"
  rm -f "${LIVE:?}/${target:?}/BUILD_ID"
  (cd "$DASHBOARD" && exec node "$NEXT" build --no-lint) &
  build_pid=$!
  waited=0
  while kill -0 "$build_pid" 2>/dev/null; do
    if [[ "$waited" -ge "$BUILD_DEADLINE" ]]; then
      kill "$build_pid" 2>/dev/null || true
      log "The build passed its ${BUILD_DEADLINE}s deadline. The current build keeps serving."
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  build_status=0
  wait "$build_pid" || build_status=$?
  restore_next_env
  if [[ "$build_status" -ne 0 || ! -f "$LIVE/$target/BUILD_ID" ]]; then
    log "The build failed (exit $build_status). The current build keeps serving."
    exit 1
  fi

  # The checkout moved while building, so this build may be a mix. Build again.
  if [[ "$(git -C "$REPO" rev-parse HEAD)" == "$head" ]]; then break; fi
  if [[ "$attempt" == "2" ]]; then log "The checkout kept moving. The current build keeps serving."; exit 1; fi
  log "The checkout moved during the build. Building again."
done

# It has to start and answer before anything switches.
(cd "$DASHBOARD" && exec node "$NEXT" start -H 127.0.0.1 -p "$SMOKE_PORT") &
smoke_pid=$!
waited=0
until curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$SMOKE_PORT/workspace"; do
  if [[ "$waited" -ge "$SMOKE_DEADLINE" ]] || ! kill -0 "$smoke_pid" 2>/dev/null; then
    log "The new build didn't answer on port $SMOKE_PORT. The current build keeps serving."
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done
kill "$smoke_pid" 2>/dev/null || true
smoke_pid=""

printf '%s %s\n' "$target" "$head" > "$LIVE/current.tmp"
mv "$LIVE/current.tmp" "$LIVE/current"
log "Build $head is ready in .live/$target."

# A freeze refusal or a broken check both leave the switch for the next restart.
freeze_check() {
  if [[ -n "${ARCADIA_DASHBOARD_FREEZE_CHECK:-}" ]]; then "$ARCADIA_DASHBOARD_FREEZE_CHECK"; return; fi
  (cd "$REPO" && pnpm -s arcadia production freeze-check services.restart --json) >/dev/null 2>&1
}
if ! freeze_check; then
  log "Services are frozen or the check failed. The next restart serves this build."
  exit 0
fi

# launchd names the job in this variable. Outside launchd there's nothing to bounce.
cleanup
trap - EXIT
if [[ -n "${ARCADIA_DASHBOARD_BOUNCE:-}" ]]; then
  "$ARCADIA_DASHBOARD_BOUNCE"
elif [[ -n "${XPC_SERVICE_NAME:-}" && "$XPC_SERVICE_NAME" == com.arcadia.local.* ]]; then
  log "Switching to the new build."
  launchctl kickstart -k "gui/$(id -u)/$XPC_SERVICE_NAME"
fi
