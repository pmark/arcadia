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
# The path is resolved once, here, so the file test and the guard see the same
# directory: a relative ARCADIA_WORKSPACE would otherwise be tested against the
# caller's directory and handed to the CLI relative to $REPO.
if [[ "$ACTION" != "status" && -n "${ARCADIA_WORKSPACE:-}" ]]; then
  if ! WS_ABS="$(cd -- "$ARCADIA_WORKSPACE" 2>/dev/null && pwd -P)"; then
    echo "Refused: ARCADIA_WORKSPACE=$ARCADIA_WORKSPACE is not a directory; services.$ACTION will not guess which workspace it meant." >&2
    exit 3
  fi
  EXPERIMENT_CONFIG="$WS_ABS/config/arcadia.json"
  if [[ -f "$EXPERIMENT_CONFIG" ]] && grep -q '"experiment"' "$EXPERIMENT_CONFIG"; then
    if ! (cd "$REPO" && pnpm -s arcadia workspace guard "services.$ACTION" --workspace "$WS_ABS") >&2; then
      echo "Refused: the experiment guard did not allow services.$ACTION for ARCADIA_WORKSPACE=$WS_ABS (see above)." >&2
      exit 3
    fi
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

# Rehearsal freeze window (docs/agent-guidance/rehearsal-freeze-window.md):
# restarting or stopping services under a live managed-production run unloads
# the worker it depends on, so the CLI's read-only freeze check refuses while
# production is Active. ARCADIA_FREEZE_OVERRIDE=<reason> bypasses it, and the
# reason is printed with the check's receipt. The run's own Off-first terminal
# step turns production Off before it restarts, so it passes.
# Any structured refusal from the CLI refuses here too (PRODUCTION_ACTIVE_FREEZE,
# INLINE_WORKSPACE_REQUIRED, ...). As with the guard above, a recovery restart
# must not depend on the CLI being runnable, so it fails open with a warning
# only when the CLI is missing or broken (no structured error, or
# UNEXPECTED_ERROR, SQLITE_NATIVE_ABI_MISMATCH, USAGE_ERROR) or reports that
# production status itself cannot be read (PRODUCTION_FREEZE_UNVERIFIED).
if [[ "$ACTION" != "status" ]]; then
  FREEZE_STATUS=0
  FREEZE_OUTPUT="$(cd "$REPO" && pnpm -s arcadia production freeze-check "services.$ACTION" --json 2>&1)" || FREEZE_STATUS=$?
  FREEZE_CODE=""
  if [[ "$FREEZE_STATUS" -ne 0 ]]; then
    FREEZE_CODE="$(printf '%s\n' "$FREEZE_OUTPUT" | grep -o '"code": *"[A-Z_]*"' | head -n 1 | sed 's/.*"\([A-Z_]*\)"$/\1/' || true)"
  fi
  if [[ "$FREEZE_STATUS" -eq 0 ]]; then
    if [[ -n "${ARCADIA_FREEZE_OVERRIDE:-}" ]]; then
      printf '%s\n' "$FREEZE_OUTPUT" >&2
      echo "warning: rehearsal freeze override recorded for services.$ACTION: ARCADIA_FREEZE_OVERRIDE=$ARCADIA_FREEZE_OVERRIDE" >&2
    fi
  elif [[ "$FREEZE_CODE" == "PRODUCTION_ACTIVE_FREEZE" ]]; then
    printf '%s\n' "$FREEZE_OUTPUT" >&2
    echo "Refused (production_active_freeze): managed production is Active, so services.$ACTION would disrupt the live run." >&2
    echo "Read-only instead: scripts/services.sh status. After the terminal production Off receipt the release-manager or orchestrator session runs recover-arcadia-host-services.sh. Override only with ARCADIA_FREEZE_OVERRIDE=<reason>." >&2
    exit 3
  elif [[ -n "$FREEZE_CODE" && ! "$FREEZE_CODE" =~ ^(PRODUCTION_FREEZE_UNVERIFIED|UNEXPECTED_ERROR|SQLITE_NATIVE_ABI_MISMATCH|USAGE_ERROR)$ ]]; then
    printf '%s\n' "$FREEZE_OUTPUT" >&2
    echo "Refused ($FREEZE_CODE): the rehearsal freeze check refused services.$ACTION; fix the cause above and retry (see docs/agent-guidance/rehearsal-freeze-window.md)." >&2
    exit 3
  else
    echo "warning: could not read managed production status (freeze check exit $FREEZE_STATUS${FREEZE_CODE:+, $FREEZE_CODE}); proceeding with services.$ACTION (fail open). Check with: pnpm arcadia production status" >&2
    if [[ -n "${ARCADIA_FREEZE_OVERRIDE:-}" ]]; then
      echo "warning: rehearsal freeze override recorded for services.$ACTION: ARCADIA_FREEZE_OVERRIDE=$ARCADIA_FREEZE_OVERRIDE" >&2
    fi
  fi
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

# Warm the development dashboard's slowest reads so the operator's first visit
# after a restart is not a cold page compile plus a cold CLI projection (the
# /production queue took 14 s cold). Detached and bounded: it never delays or
# fails the restart. ARCADIA_DASHBOARD_WARM=0 turns it off.
if [[ "${ARCADIA_DASHBOARD_WARM:-1}" != "0" ]]; then
  DASHBOARD_URL="${ARCADIA_DASHBOARD_URL:-http://127.0.0.1:3020}"
  (
    for path in /production "/api/production-console?part=core" "/api/production-console?part=queue"; do
      curl -fsS -o /dev/null --max-time 90 "$DASHBOARD_URL$path" || true
    done
  ) </dev/null >/dev/null 2>&1 &
fi

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
# A rehearsal freeze override covers only the step it was given for: the
# ensure runs without ARCADIA_FREEZE_OVERRIDE, so an override that let this
# restart through under an Active policy never also reinstalls the broker the
# live run's Sessions use. That ensure then refuses, which leaves the broker
# at its installed revision and only warns here; the restart stays complete.
ENSURE_LOG="$HOME/.local/share/arcadia/go-broker/ensure.log"
if ! mkdir -p "$(dirname "$ENSURE_LOG")" 2>&1; then
  echo "warning: could not create $(dirname "$ENSURE_LOG"); skipping go-broker ensure" >&2
elif ! (cd "$REPO" && env -u ARCADIA_FREEZE_OVERRIDE pnpm arcadia go-broker ensure) >>"$ENSURE_LOG" 2>&1; then
  if [[ -n "${ARCADIA_FREEZE_OVERRIDE:-}" ]]; then
    # A plain manual install would refuse too, so name only the two real routes.
    echo "note: the restart's ARCADIA_FREEZE_OVERRIDE does not extend to go-broker ensure, which did not reinstall the broker (see $ENSURE_LOG). Either run it with its own override, ARCADIA_FREEZE_OVERRIDE=<reason> pnpm arcadia go-broker ensure, or leave it to the batched install (reinstall-go-broker.sh) after the terminal production Off receipt." >&2
  else
    echo "warning: go-broker ensure failed after restart; run 'pnpm arcadia go-broker install' manually in $REPO (see $ENSURE_LOG)" >&2
  fi
fi
