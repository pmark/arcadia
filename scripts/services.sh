#!/usr/bin/env bash
#
# Arcadia's own implementation of the service contract.
# See docs/service-contract.md for what the three verbs must do.
#
#   scripts/services.sh [status|restart|stop]
#
# This is deliberately a thin adapter. The real work — pinning the toolchain,
# writing LaunchAgents that start through `mise exec`, managing logs — already
# lives in the restart-services script and is not reimplemented here. What this
# adds is the standard interface, so Arcadia can control this project the same
# way it controls any other, without knowing anything about launchd.
#
# It never touches git. Bringing the checkout to its base branch is Arcadia's
# job, under a safety contract a shell script has no way to honour.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ACTION="${1:-status}"

case "$ACTION" in
  status | restart | stop) ;;
  *)
    echo "usage: $0 [status|restart|stop]" >&2
    exit 2
    ;;
esac

# Decision 0082: the restart script points the live worker and Intelligence
# launchd services at ARCADIA_WORKSPACE, so restarting or stopping with an
# experiment workspace there would repoint or stop production. The CLI's
# experiment guard decides; status is read-only and never refused. Only a
# workspace whose config carries an experiment block is sent to the guard, so
# an ordinary restart never depends on the CLI being runnable (a recovery
# restart is often exactly when it is not).
EXPERIMENT_CONFIG="${ARCADIA_WORKSPACE:-}/config/arcadia.json"
if [[ "$ACTION" != "status" && -n "${ARCADIA_WORKSPACE:-}" && -f "$EXPERIMENT_CONFIG" ]] &&
  grep -q '"experiment"' "$EXPERIMENT_CONFIG"; then
  if ! (cd "$REPO" && pnpm -s arcadia workspace guard "services.$ACTION" --workspace "$ARCADIA_WORKSPACE") >&2; then
    echo "Refused: the experiment guard did not allow services.$ACTION for ARCADIA_WORKSPACE=$ARCADIA_WORKSPACE (see above)." >&2
    exit 3
  fi
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  # Honest refusal rather than a confusing launchctl error. The contract is
  # portable; this particular implementation is not, which is exactly why the
  # script belongs to the project rather than to Arcadia.
  echo "Arcadia's services are managed by launchd and only run on macOS." >&2
  echo "On another platform, run the dashboard, worker, and Intelligence processes directly." >&2
  exit 2
fi

# The operator-installed implementation. Kept in one place so its location is a
# single line to change rather than a search.
IMPL="${ARCADIA_RESTART_SCRIPT:-$HOME/.codex/skills/restart-arcadia-services/scripts/restart-services.sh}"

if [[ ! -x "$IMPL" ]]; then
  echo "Service control script not found or not executable: $IMPL" >&2
  echo "Set ARCADIA_RESTART_SCRIPT to its location, or install the restart-arcadia-services skill." >&2
  exit 2
fi

# That script takes <action> <repo>; Rebuster's takes them the other way round.
# Normalizing the argument order is the whole point of this adapter existing.
if [[ "$ACTION" != "restart" ]]; then
  exec "$IMPL" "$ACTION" "$REPO"
fi

# The implementation's final readiness probes use a single 2s curl, and when one
# times out on a cold start it rolls the whole restart back and leaves every
# service stopped, although an immediate second restart succeeds (Issue #430).
# That script lives outside this repo, so the adapter bounds the damage: a
# failed restart is retried, up to ARCADIA_RESTART_ATTEMPTS attempts in total
# (default 2), instead of stopping at a full outage on one slow probe.
ATTEMPTS="${ARCADIA_RESTART_ATTEMPTS:-2}"
# Reject anything but a plain decimal 1-10 (a leading zero would read as octal
# in the comparison below and silently defeat the limit).
if [[ ! "$ATTEMPTS" =~ ^([1-9]|10)$ ]]; then
  echo "ARCADIA_RESTART_ATTEMPTS must be an integer from 1 to 10, got: $ATTEMPTS" >&2
  exit 2
fi
attempt=1
until "$IMPL" "$ACTION" "$REPO"; do
  status=$?
  if [[ "$attempt" -ge "$ATTEMPTS" ]]; then
    echo "Restart failed after $attempt attempt(s)." >&2
    exit "$status"
  fi
  echo "Restart attempt $attempt failed (exit $status); retrying ($((attempt + 1))/$ATTEMPTS)." >&2
  attempt=$((attempt + 1))
  sleep "${ARCADIA_RESTART_RETRY_DELAY:-3}"
done

# A restarted worker only starts reading correctly again the moment it is
# restarted; the fixed go-broker executables a coding agent's `arcadia go`
# talks to are a separate, compiled artifact that `go-broker install` alone
# refreshes, and nothing else does it automatically. Piggyback on this
# restart rather than adding a second trigger (a git hook, a timer): a
# restart already means "runtime code changed, services are catching up",
# which is exactly when the broker can also be behind. `go-broker ensure` is
# a cheap no-op when the installed broker already matches HEAD, so this costs
# nothing on the common restart that has nothing to do with the broker.
# Failure here must never fail the restart the operator actually asked for.
ENSURE_LOG="$HOME/.local/share/arcadia/go-broker/ensure.log"
if ! mkdir -p "$(dirname "$ENSURE_LOG")" 2>&1; then
  echo "warning: could not create $(dirname "$ENSURE_LOG"); skipping go-broker ensure" >&2
elif ! (cd "$REPO" && pnpm arcadia go-broker ensure) >>"$ENSURE_LOG" 2>&1; then
  echo "warning: go-broker ensure failed after restart; run 'pnpm arcadia go-broker install' manually in $REPO (see $ENSURE_LOG)" >&2
fi
