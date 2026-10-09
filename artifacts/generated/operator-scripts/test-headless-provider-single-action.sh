#!/usr/bin/env bash
# Test whether each headless coding agent (Codex, OpenCode and Claude Code, each
# independently on its own fresh fixture) can complete one trivial governed
# Action with no human input, and report every one of them.
#
# Everything runs in a fresh Decision 0082 experiment workspace and a one-Action
# fixture repository with no remote, both under a temporary directory. The live
# workspace, production, services, GitHub and provider configuration are never
# touched. The logic lives in scripts/headless-provider-test.ts (unit-tested with
# stub providers); this launcher owns the run directory, the log and the failure
# handoff. Its entrypoints are `run [--keep] [--providers codex,opencode,claude]
# [--model-codex M] [--model-opencode M] [--model-claude M]` and `--describe`.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
SCRIPT_ID="test-headless-provider-single-action"
USAGE="usage: $0 [run [--keep] [--providers codex,opencode,claude] [--model-codex M] [--model-opencode M] [--model-claude M]|--describe]"

case "${1:-run}" in
  run) ;;
  --describe)
    cat "$SCRIPT_DIR/$SCRIPT_ID.json"
    exit 0
    ;;
  *)
    echo "$USAGE" >&2
    exit 2
    ;;
esac

# Options are forwarded to the helper in the order given; it validates their values.
KEEP=()
ARGUMENTS=("${@:2}")
INDEX=0
while [[ "$INDEX" -lt "${#ARGUMENTS[@]}" ]]; do
  argument="${ARGUMENTS[$INDEX]}"
  case "$argument" in
    --keep) KEEP+=(--keep) ;;
    --providers=* | --model-codex=* | --model-opencode=* | --model-claude=*) KEEP+=("$argument") ;;
    --providers | --model-codex | --model-opencode | --model-claude)
      INDEX=$((INDEX + 1))
      if [[ "$INDEX" -ge "${#ARGUMENTS[@]}" ]]; then
        echo "$argument needs a value" >&2
        echo "$USAGE" >&2
        exit 2
      fi
      KEEP+=("$argument" "${ARGUMENTS[$INDEX]}")
      ;;
    *)
      echo "$USAGE" >&2
      exit 2
      ;;
  esac
  INDEX=$((INDEX + 1))
done

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIRECTORY="$SCRIPT_DIR/runs/$RUN_ID"
LOG_PATH="$RUN_DIRECTORY/run.log"
HANDOFF_PATH="$RUN_DIRECTORY/failure-handoff.md"
RECEIPT_PATH="$RUN_DIRECTORY/receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIRECTORY"

json_string() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\t'/\\t}
  value=${value//$'\r'/}
  printf '"%s"' "$value"
}

# The dashboard can be started by launchd with a minimal PATH; add the usual tool directories after it.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.opencode/bin"

cd "$REPOSITORY"

# Run the helper in the background and forward SIGINT/SIGTERM to it, so a /runs stop or a closed terminal reaches the helper
# (which stops the provider's whole process group and still writes a receipt) instead of orphaning a running provider.
STATUS=0
mise exec -- node --import tsx scripts/headless-provider-test.ts "$RUN_DIRECTORY" "$RUN_ID" "$SCRIPT_ID" ${KEEP[@]+"${KEEP[@]}"} &
CHILD=$!
forward_signal() { kill -TERM "$CHILD" 2>/dev/null || true; }
trap forward_signal INT TERM
wait "$CHILD" || STATUS=$?
while kill -0 "$CHILD" 2>/dev/null; do
  wait "$CHILD" || STATUS=$?
done
trap - INT TERM

# The helper writes its own receipt and handoff; cover only the case where it died before it could.
if [[ ! -s "$RECEIPT_PATH" ]]; then
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":"failed","stage":"launcher","reason":%s,"runLog":%s,"liveWorkspaceAddressed":false}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "the test helper exited $STATUS before writing a receipt")" "$(json_string "$LOG_PATH")" > "$RECEIPT_PATH"
fi
if [[ "$STATUS" -ne 0 && ! -s "$HANDOFF_PATH" ]]; then
  cat > "$HANDOFF_PATH" <<EOF
# Operator-script failure handoff

- id: $SCRIPT_ID
- run: $RUN_ID
- helper exit code: $STATUS
- run log: $LOG_PATH
- receipt: $RECEIPT_PATH

The helper stopped before it could write its own handoff. Give this file and the run log to a coding agent and ask it to diagnose
the first failing command. The live workspace, production, services, GitHub and provider configuration were not touched.
EOF
fi

echo
if [[ "$STATUS" -eq 0 ]]; then
  echo "Headless provider test PASSED. Receipt: $RECEIPT_PATH"
else
  echo "Headless provider test did not pass (exit $STATUS). Failure handoff: $HANDOFF_PATH" >&2
fi
exit "$STATUS"
