#!/usr/bin/env bash
# Generated operator recovery helper. Its /runs descriptor is beside it.
# It changes only local Arcadia host configuration and services. It never
# fetches, merges, pushes, checks out, deploys, or settles governed work.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
WORKSPACE="/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover"
SCRIPT_ID="recover-arcadia-host-services"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIRECTORY="$SCRIPT_DIR/runs/$RUN_ID"
LOG_PATH="$RUN_DIRECTORY/run.log"
HANDOFF_PATH="$RUN_DIRECTORY/failure-handoff.md"

case "${1:-run}" in
  run) ;;
  --describe)
    cat "$SCRIPT_DIR/$SCRIPT_ID.json"
    exit 0
    ;;
  *)
    echo "usage: $0 [run|--describe]" >&2
    exit 2
    ;;
esac

mkdir -p "$RUN_DIRECTORY"
exec > >(tee -a "$LOG_PATH") 2>&1

write_failure_handoff() {
  local exit_code="$1"
  local line="$2"
  local command="$3"
  trap - ERR
  cat > "$HANDOFF_PATH" <<EOF
# Operator-script failure handoff

## Script

- id: $SCRIPT_ID
- descriptor: $SCRIPT_DIR/$SCRIPT_ID.json
- run log: $LOG_PATH
- failed line: $line
- exit code: $exit_code
- command: \`$command\`

## Problem and desired effect

This recovery attempts to restore an agent-controlled Arcadia worker with a
fresh preservation route and Go route. It must fail rather than report ready
when the broker profile, managed service restart, or transport heartbeat is
unavailable.

## Suggested next step

Do not rerun this script blindly. Attach this handoff and its run log to the
next Arcadia coding-agent request, asking it to diagnose the first failing
command and generate a narrower follow-up operator script if one is safe.
EOF
  echo >&2
  echo "Recovery failed. Give this handoff to Arcadia: $HANDOFF_PATH" >&2
  exit "$exit_code"
}
trap 'write_failure_handoff "$?" "$LINENO" "$BASH_COMMAND"' ERR

cd "$REPOSITORY"

echo "==> Installing or refreshing the fixed Arcadia Go-broker profile"
pnpm arcadia go-broker install

echo
echo "==> Restarting Arcadia's managed local services"
scripts/services.sh restart

echo
echo "==> Checking the managed worker"
pnpm arcadia worker status --workspace "$WORKSPACE"

echo
echo "==> Checking protected preservation and Go routing"
STATUS=""
READY="false"
for attempt in {1..90}; do
  # A newly restarted worker may advertise preservation before its first Go
  # route pass. `busy` is a healthy warm-up state, so wait a bounded 180 seconds
  # rather than making the operator restart a healthy service (Issue #450).
  if STATUS="$(mise exec -- node --import tsx src/cli.ts go-broker status --json)"; then
    READY="$(printf '%s' "$STATUS" | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const status = JSON.parse(input);
  process.stdout.write(String(
    status.ok === true &&
    status.data?.preservationTransport?.ready === true &&
    status.data?.agentGoTransport?.ready === true
  ));
});
')"
    if [[ "$READY" == "true" ]]; then
      break
    fi
  else
    READY="false"
  fi

  if [[ "$attempt" -lt 90 ]]; then
    echo "Go route is still warming up (attempt $attempt/90); waiting two seconds."
    sleep 2
  fi
done

printf '%s\n' "$STATUS"

if [[ "$READY" != "true" ]]; then
  echo >&2
  echo "Recovery is not ready: the worker, preservation route, or Go route did not pass its live check." >&2
  echo "Do not retry blindly. Keep the output above as the diagnostic receipt and use the failure handoff path printed below." >&2
  exit 1
fi

echo
echo "Recovery ready: managed worker, preservation transport, and Go transport are all fresh."
echo "Next: begin a fresh Arcadia continuation with \`arcadia advance\`; it can now use the protected route."
