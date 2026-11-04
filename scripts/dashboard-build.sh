#!/usr/bin/env bash
# Builds the live dashboard behind the running one, then switches to it (see scripts/dashboard-serve.sh).
#
# There are two build folders, so the one being served is never touched. Nothing switches until the new
# build has started and answered on a spare port. Any failure leaves the current build serving. While
# production is Active the shared services are frozen, so no build starts, and a build that finishes
# after one begins waits for the next restart. A restart stops a running build, and the restart after
# that starts it again.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="${ARCADIA_DASHBOARD_REPO:-$(cd "$SCRIPTS/.." && pwd -P)}"
DASHBOARD="$REPO/apps/dashboard"
NEXT="${ARCADIA_DASHBOARD_NEXT:-$DASHBOARD/node_modules/next/dist/bin/next}"
LIVE="$DASHBOARD/.live"
LOCK="$LIVE/build.lock"
HEAL="$SCRIPTS/lib/dashboard-next-env.sh"
SMOKE_PORT="${ARCADIA_DASHBOARD_SMOKE_PORT:-3023}"
BUILD_DEADLINE="${ARCADIA_DASHBOARD_BUILD_DEADLINE:-1200}"
SMOKE_DEADLINE="${ARCADIA_DASHBOARD_SMOKE_DEADLINE:-60}"
NEXT_ENV="apps/dashboard/next-env.d.ts"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mkdir -p "$LIVE"
# One build at a time. The lock is a symlink naming its owner, so taking it is atomic and a lock left by
# a process that died doesn't count.
# shellcheck source=lib/dashboard-next-env.sh
source "$HEAL"
if ! ln -s "$$" "$LOCK" 2>/dev/null; then
  if build_lock_is_live "$LOCK"; then log "A build is already running (pid $(readlink "$LOCK"))."; exit 0; fi
  rm -f "${LOCK:?}"
  if ! ln -s "$$" "$LOCK" 2>/dev/null; then log "Another build just started."; exit 0; fi
fi

smoke_pid=""
cleanup() {
  [[ -z "$smoke_pid" ]] || kill "$smoke_pid" 2>/dev/null || true
  heal_next_env "$REPO"
  # Another build may have taken over a lock it judged stale, so only remove our own.
  if [[ "$(readlink "$LOCK" 2>/dev/null || true)" == "$$" ]]; then rm -f "${LOCK:?}"; fi
}
trap cleanup EXIT
# A build killed by a restart can't tidy up after itself, so this one does it first.
heal_next_env "$REPO"

# Being frozen is expected. A check that can't run isn't, so the log says which it was.
freeze_output=""
freeze_check() {
  if [[ -n "${ARCADIA_DASHBOARD_FREEZE_CHECK:-}" ]]; then "$ARCADIA_DASHBOARD_FREEZE_CHECK"; return; fi
  freeze_output="$(cd "$REPO" && pnpm -s arcadia production freeze-check services.restart --json 2>&1)"
}
freeze_reason() {
  if [[ "$freeze_output" == *PRODUCTION_ACTIVE_FREEZE* ]]; then echo "Services are frozen because production is Active."; else echo "The freeze check failed, so this needs a look: ${freeze_output:0:200}"; fi
}
if ! freeze_check; then
  log "$(freeze_reason) No build starts, and the next restart tries again."
  exit 0
fi

slot=""
built=""
if [[ -f "$LIVE/current" ]]; then read -r slot built < "$LIVE/current" || true; fi
for attempt in 1 2; do
  head="$(git -C "$REPO" rev-parse HEAD)"
  if [[ "$head" == "$built" && -n "$slot" && -f "$LIVE/$slot/BUILD_ID" ]]; then log "The build is already at $head."; exit 0; fi

  # A build reads the working tree but records a commit, so uncommitted changes would serve under the wrong name.
  uncommitted="$(git -C "$REPO" status --porcelain -- apps/dashboard src package.json pnpm-lock.yaml)"
  if [[ -n "$uncommitted" ]]; then
    log "The checkout has uncommitted changes the build would read, so no build starts: ${uncommitted:0:200}"
    exit 0
  fi

  # Commits that can't change the dashboard don't need a build or a restart.
  if [[ -n "$slot" && -f "$LIVE/$slot/BUILD_ID" ]] && git -C "$REPO" cat-file -e "$built^{commit}" 2>/dev/null &&
    git -C "$REPO" diff --quiet "$built" "$head" -- apps/dashboard src package.json pnpm-lock.yaml; then
    printf '%s %s\n' "$slot" "$head" > "$LIVE/current.tmp"
    mv "$LIVE/current.tmp" "$LIVE/current"
    log "Nothing for the dashboard changed between $built and $head."
    exit 0
  fi

  target="a"
  if [[ "$slot" == "a" && -f "$LIVE/a/BUILD_ID" ]]; then target="b"; fi

  # A build rewrites this tracked file to point at its own folder. It's marked so the checkout reads as clean meanwhile, and git restores it afterwards.
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
  heal_next_env "$REPO"
  if [[ "$build_status" -ne 0 || ! -f "$LIVE/$target/BUILD_ID" ]]; then
    log "The build failed (exit $build_status). The current build keeps serving."
    exit 1
  fi

  # The checkout moved while building, so this build may be a mix. Build again.
  if [[ "$(git -C "$REPO" rev-parse HEAD)" == "$head" ]]; then break; fi
  if [[ "$attempt" == "2" ]]; then log "The checkout kept moving. The current build keeps serving."; exit 1; fi
  log "The checkout moved during the build. Building again."
done

# It has to start and answer before anything switches: a page, and a route that loads the server bundles.
# Something else already answering on this port would make the check meaningless.
if curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$SMOKE_PORT/" 2>/dev/null; then
  log "Port $SMOKE_PORT is already in use, so the new build can't be checked. The current build keeps serving."
  exit 1
fi
(cd "$DASHBOARD" && exec node "$NEXT" start -H 127.0.0.1 -p "$SMOKE_PORT") &
smoke_pid=$!
waited=0
until curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$SMOKE_PORT/workspace" && curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$SMOKE_PORT/api/workspace/status"; do
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

# Production may have started during the build. A freeze refusal or a broken check both leave the switch for the next restart.
if ! freeze_check; then
  log "$(freeze_reason) The next restart serves this build."
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
