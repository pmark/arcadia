#!/usr/bin/env bash
# One-press emergency stop for the first supervised production run on Arcadia's
# own repository (the G8 equivalent, without the host-service restart). It turns
# production Off through the governed `arcadia production deactivate` path and
# reads the status back to prove it. Off only removes authority, so it is
# repeatable and does not depend on the Git checkout, the Plan or any Decision:
# the only gate is that it never runs inside an agent sandbox. It never starts,
# restarts or terminates a Session or a service, merges, pushes, deletes or
# resets anything, edits the workspace config or turns production back on. A
# Session that is already running is not terminated: it finishes under the host
# worker, and its work is preserved to a draft PR as usual.
set -Eeuo pipefail

LIBRARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
SCRIPT_ID="restore-off-production-bug-plan-first-supervised-run-2026-10-11"

MODE="${1:-run}"
case "$MODE" in run | --describe) ;; *) echo "usage: $0 [run|--describe]" >&2; exit 2 ;; esac
if [[ "$MODE" == --describe ]]; then cat "$LIBRARY_DIR/$SCRIPT_ID.json"; exit 0; fi

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$LIBRARY_DIR/runs/$RUN_ID"
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$LOG") 2>&1

STAGE=launch_context
REASON=""
EXTRA=""
OFF_STATE=unknown
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"offState":%s%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$(json_string "$OFF_STATE")" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }
fail_out() {
  local code="${1:-1}"
  trap - ERR TERM INT
  set +e
  write_receipt refused
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- observed Off state: $OFF_STATE"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT"
    echo
    echo "Production may still be ACTIVE. Read it with: arcadia production status; then turn it Off from the Terminal panel with: arcadia production deactivate --request-id <fresh-id> --reason <why>. Do not retry blindly: read the log first."
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
on_error() {
  local code=$? command="$BASH_COMMAND"
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  fail_out "$code"
}
on_signal() {
  if (( BASH_SUBSHELL > 0 )); then exit 143; fi
  REASON="interrupted by a signal during stage $STAGE"
  fail_out 143
}
trap on_error ERR
trap on_signal TERM INT

echo "== STOP production: turn Off now (supervised run on Arcadia's seven-bug Plan) =="
[[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only action: an agent sandbox may not run it"
STAGE=parameters
for tool in jq mise timeout; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
[[ -n "${ARCADIA_OPERATOR_SCRIPT_ID:-}" ]] && record_str launchedAs "operator-action library ($ARCADIA_OPERATOR_SCRIPT_ID)" || record_str launchedAs "terminal"

STAGE=read_status
BEFORE="$(arcadia production status --json)" || refuse "production status could not be read; turn it Off with: arcadia production deactivate"
printf '%s\n' "$BEFORE" > "$RUN_DIR/status-before.json"
jq -e '.ok == true and .data.read.status == "ok"' <<<"$BEFORE" >/dev/null || refuse "production status is unreadable; turn it Off from the Terminal panel"
record_str requestIdBefore "$(jq -r '.data.read.policy.authority.requestId // "none"' <<<"$BEFORE")"
record "policyRevisionBefore" "$(jq '.data.read.policy.revision' <<<"$BEFORE")"
record "liveAdmissionsBefore" "$(jq '.data.liveAdmissions // 0' <<<"$BEFORE")"

STAGE=deactivate
if jq -e '.data.read.policy.desiredState == "inactive"' <<<"$BEFORE" >/dev/null; then
  OFF_STATE="already_inactive"
  echo "Production is already Inactive: nothing to turn Off."
else
  arcadia production deactivate --request-id "$SCRIPT_ID-$RUN_ID" --reason 'Operator pressed STOP for the first supervised production run on Arcadia: return production to Off.' --json > "$RUN_DIR/off.json" || true
  STAGE=verify_off
  AFTER="$(arcadia production status --json)" || refuse "production status could not be read after the Off; confirm it with: arcadia production status"
  printf '%s\n' "$AFTER" > "$RUN_DIR/status-after.json"
  jq -e '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive"' <<<"$AFTER" >/dev/null || { OFF_STATE="STILL_ACTIVE_OR_UNKNOWN"; refuse "production did not read back Inactive after the Off; turn it Off from the Terminal panel now"; }
  OFF_STATE="turned_off"
  record "policyRevisionAfter" "$(jq '.data.read.policy.revision' <<<"$AFTER")"
  record "liveAdmissionsAfter" "$(jq '.data.liveAdmissions // 0' <<<"$AFTER")"
fi

STAGE=complete
REASON=""
record_str neverDoes "Start, restart or terminate a Session or service; merge, push, delete or reset anything; edit the workspace config; turn production back on. A Session already running is not terminated and its work is preserved as usual."
write_receipt succeeded
echo "OFF: production is Inactive ($OFF_STATE). A Session already running is not terminated. Receipt: $RECEIPT"
