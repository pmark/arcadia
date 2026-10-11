#!/usr/bin/env bash
# Apply the /todo bulk disposition the operator accepted on 2026-10-10 (Ask "Dismiss 286
# superseded/off-path items"): reject the pinned pending Agent Asks and open review items
# and mark the 8 rehearsal fixture Projects completed, only through Arcadia's canonical
# writers. The logic lives in the tracked, tested scripts/apply-todo-bulk-disposition.ts;
# this launcher pins the execution context so settlement enforces the descriptor's
# rejection-only scope, and keeps the receipt and failure handoff.
# `--dry-run` reads everything and previews every settlement, and writes nothing to the
# workspace, any checkout's branch or GitHub (it adds and removes one temporary detached
# worktree in $TMPDIR).
set -Eeuo pipefail

LIBRARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
SCRIPT_ID="apply-todo-bulk-disposition-20261010"
DESCRIPTOR="$LIBRARY_DIR/$SCRIPT_ID.json"
USAGE="usage: $SCRIPT_ID.sh [run|--dry-run|--describe]"

MODE="${1:-run}"
case "$MODE" in
  run | --dry-run) ;;
  --describe) cat "$DESCRIPTOR"; exit 0 ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo "$USAGE" >&2; exit 2; }
DRY_RUN=false
[[ "$MODE" == --dry-run ]] && DRY_RUN=true

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [[ "$DRY_RUN" == true ]]; then
  RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/todo-bulk-disposition-dry-run.XXXXXX")"
else
  RUN_DIR="$LIBRARY_DIR/runs/$RUN_ID"
  mkdir -p "$RUN_DIR"
fi
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
DETAIL="$RUN_DIR/disposition-receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exec > >(tee -a "$LOG") 2>&1

STAGE=context
REASON=""
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"mode":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"dispositionReceipt":%s,"productionPreviewedOrActivated":false,"grantsTouched":false}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$MODE")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$(json_string "$DETAIL")" > "$RECEIPT"
}
on_error() {
  local code=$? command="$BASH_COMMAND"
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  trap - ERR
  set +e
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  write_receipt "$([[ "$DRY_RUN" == true ]] && echo dry_run_stopped || echo failed)"
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID ($MODE)"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- run log: $LOG"
    echo "- per-item receipt: $DETAIL"
    echo
    echo "Each item is applied on its own through a canonical writer; the per-item receipt lists what was rejected,"
    echo "completed, skipped (and why) or failed. Nothing was force-pushed, reset or deleted, and production, the"
    echo "broker and Grants were not touched."
    echo
    echo "## Recovery"
    echo
    echo "Correct the named cause and press the button again (or run this script with run). A rerun re-checks every"
    echo "item: anything already rejected or completed is skipped, Asks resume under the same settlement request ids"
    echo "(bulk-20261010-<proposal>), and an existing archive worktree ~/tmp/arcadia-todo-bulk-disposition-20261010 on"
    echo "branch operator/todo-bulk-disposition-archives-20261010 is reused. Do not edit the list, the descriptor or the"
    echo "workspace database by hand."
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
trap on_error ERR

echo "== /todo bulk disposition 2026-10-10 ($MODE) =="
[[ "$DRY_RUN" == false ]] || echo "Dry run: evidence in $RUN_DIR; nothing is written to the workspace, any branch or GitHub."
# The settlement guard reads this context and admits only the descriptor's pinned rejections.
if [[ -n "${ARCADIA_OPERATOR_SCRIPT_ID:-}" && "$ARCADIA_OPERATOR_SCRIPT_ID" != "$SCRIPT_ID" ]]; then
  REASON="launched under another operator action's context ($ARCADIA_OPERATOR_SCRIPT_ID)"; false
fi
if [[ -n "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" && "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR" != "$DESCRIPTOR" ]]; then
  REASON="launched with a different descriptor ($ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR)"; false
fi
export ARCADIA_OPERATOR_SCRIPT_ID="$SCRIPT_ID"
export ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR="$DESCRIPTOR"

STAGE=apply
HELPER_MODE="--apply"
[[ "$DRY_RUN" == false ]] || HELPER_MODE="--dry-run"
set +e
(cd "$ARCADIA_REPO" && timeout 7200 mise exec -- node --import tsx scripts/apply-todo-bulk-disposition.ts "$DESCRIPTOR" "$RUN_DIR" "$HELPER_MODE")
HELPER_EXIT=$?
set -e
OUTCOME="$(jq -r '.outcome // empty' "$DETAIL" 2>/dev/null || true)"
STAGE="$(jq -r '.stage // "apply"' "$DETAIL" 2>/dev/null || echo apply)"
REASON="$(jq -r '.reason // empty' "$DETAIL" 2>/dev/null || true)"
if [[ "$HELPER_EXIT" -ne 0 || -z "$OUTCOME" ]]; then
  [[ -n "$REASON" ]] || REASON="helper exited $HELPER_EXIT without a per-item receipt"
  false
fi
write_receipt "$([[ "$OUTCOME" == dry_run ]] && echo dry_run || echo succeeded)"
echo "Receipt: $RECEIPT"
echo "Per-item receipt: $DETAIL"
