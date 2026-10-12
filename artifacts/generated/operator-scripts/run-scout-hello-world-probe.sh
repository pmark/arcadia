#!/usr/bin/env bash
# Run the bounded zero-model Ask/To-do scout and retain its logs and exact report path.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
SCRIPT_ID="run-scout-hello-world-probe"
USAGE="usage: $0 [run|--describe]"

case "${1:-run}" in
  run) [[ "$#" -le 1 ]] || { echo "$USAGE" >&2; exit 2; } ;;
  --describe)
    [[ "$#" -eq 1 ]] || { echo "$USAGE" >&2; exit 2; }
    cat "$SCRIPT_DIR/$SCRIPT_ID.json"
    exit 0
    ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIRECTORY="$SCRIPT_DIR/runs/$RUN_ID"
LOG_PATH="$RUN_DIRECTORY/run.log"
RECEIPT_PATH="$RUN_DIRECTORY/receipt.json"
HANDOFF_PATH="$RUN_DIRECTORY/failure-handoff.md"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIRECTORY"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/share/mise/shims:$HOME/.local/bin"
cd "$REPOSITORY"

STATUS=0
if python3 - "$LOG_PATH" <<'PY'
import os
import signal
import subprocess
import sys

log_path = sys.argv[1]
command = ["mise", "exec", "--", "pnpm", "fast-rehearsal", "-t", "Ask/To-do scout"]
try:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
except OSError as error:
    with open(log_path, "w", encoding="utf-8") as log:
        log.write(f"could not start scout command: {error}\n")
    print(f"could not start scout command: {error}")
    sys.exit(127)
try:
    try:
        output, _ = process.communicate(timeout=300)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        output += "\nscout probe exceeded its five-minute cap\n"
        status = 124
    else:
        status = process.returncode
    with open(log_path, "w", encoding="utf-8") as log:
        log.write(output)
    sys.stdout.write(output)
    sys.stdout.flush()
    sys.exit(status)
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait()
PY
then
  :
else
  STATUS=$?
fi
if [[ ! -e "$LOG_PATH" ]]; then
  printf 'launcher could not start Python runner\n' > "$LOG_PATH"
fi

REPORT_PATH=""
if [[ -s "$LOG_PATH" ]]; then
  REPORT_PATH="$(sed -n 's/^Fast rehearsal report path: //p' "$LOG_PATH" | tail -n 1 || true)"
fi
RETAINED_REPORT_PATH=""
if [[ -n "$REPORT_PATH" && -f "$REPORT_PATH" ]]; then
  RETAINED_REPORT_PATH="$RUN_DIRECTORY/report.json"
  cp -- "$REPORT_PATH" "$RETAINED_REPORT_PATH" || { RETAINED_REPORT_PATH=""; STATUS=1; }
fi
SCOUT_OUTCOME="unavailable"
FIRST_BLOCKER="Report was not produced or could not be parsed."
FINDING_FINGERPRINT=""
NEXT_STEP="Inspect the handoff and report before retrying."
if [[ -n "$RETAINED_REPORT_PATH" ]]; then
  if SCOUT_FIELDS="$(python3 - "$RETAINED_REPORT_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
scouts = [scenario.get("scout") for scenario in report.get("scenarios", []) if scenario.get("scenario") == "Ask/To-do scout"]
if not scouts or not scouts[0]:
    raise SystemExit("Ask/To-do scout scenario missing")
scout = scouts[0]
if scout.get("outcome") not in {"yes", "no"}:
    raise SystemExit("Ask/To-do scout outcome must be yes or no")
finding = scout.get("findings", [{}])[0] if scout.get("findings") else {}
values = [scout.get("outcome"), scout.get("firstBlocker", ""), finding.get("fingerprint", ""), finding.get("proposedNextStep", "")]
for value in values:
    print(str(value).replace("\t", " ").replace("\n", " ").replace("\r", " "))
PY
)"; then
    SCOUT_OUTCOME="$(sed -n '1p' <<< "$SCOUT_FIELDS")"
    FIRST_BLOCKER="$(sed -n '2p' <<< "$SCOUT_FIELDS")"
    FINDING_FINGERPRINT="$(sed -n '3p' <<< "$SCOUT_FIELDS")"
    NEXT_STEP="$(sed -n '4p' <<< "$SCOUT_FIELDS")"
  else
    STATUS=1
    FIRST_BLOCKER="Report exists but is malformed or lacks the scout scenario."
  fi
fi
if [[ "$SCOUT_OUTCOME" == "unavailable" ]]; then
  STATUS=1
fi

json_string() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\t'/\\t}
  value=${value//$'\r'/}
  printf '"%s"' "$value"
}
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  printf '{\n  "schema": "arcadia-operator-run-receipt-v1",\n  "id": "run-scout-hello-world-probe",\n  "runId": '; json_string "$RUN_ID"
  printf ',\n  "startedAt": '; json_string "$STARTED_AT"
  printf ',\n  "finishedAt": '; json_string "$FINISHED_AT"
  printf ',\n  "outcome": '; if [[ "$STATUS" -eq 0 ]]; then json_string succeeded; else json_string failed; fi
  printf ',\n  "exitCode": %s,\n  "scoutOutcome": ' "$STATUS"; json_string "$SCOUT_OUTCOME"
  printf ',\n  "reportPath": '; json_string "$REPORT_PATH"
  printf ',\n  "retainedReportPath": '; json_string "$RETAINED_REPORT_PATH"
  printf ',\n  "runLog": '; json_string "$LOG_PATH"
  printf ',\n  "modelCalls": 0,\n  "tokens": 0,\n  "liveWorkspaceAddressed": false\n}\n'
} > "$RECEIPT_PATH"

echo "Ask/To-do scout: outcome=$SCOUT_OUTCOME; first blocker=$FIRST_BLOCKER; finding=${FINDING_FINGERPRINT:-unavailable}; next step=${NEXT_STEP:-unavailable}; report=${RETAINED_REPORT_PATH:-not retained}; harness-report=${REPORT_PATH:-not produced}"

if [[ "$STATUS" -ne 0 ]]; then
  cat > "$HANDOFF_PATH" <<EOF
# Ask/To-do scout failure handoff

- Run: $RUN_ID
- Exit code: $STATUS
- Scout outcome: $SCOUT_OUTCOME
- Harness report: ${REPORT_PATH:-not produced}
- Retained report: ${RETAINED_REPORT_PATH:-not retained}
- First blocker: $FIRST_BLOCKER
- Finding fingerprint: ${FINDING_FINGERPRINT:-unavailable}
- Proposed next step: ${NEXT_STEP:-unavailable}
- Log: $LOG_PATH
- Receipt: $RECEIPT_PATH

The bounded runner failed or did not produce a parseable scout report. Review the report and log before retrying. The scout uses only a disposable workspace and deterministic Ask/To-do paths; it does not use providers, GitHub, production, or the live workspace.
EOF
  echo "Ask/To-do scout runner failed (exit $STATUS). Receipt: $RECEIPT_PATH. Handoff: $HANDOFF_PATH" >&2
  exit "$STATUS"
fi

echo "Ask/To-do scout journey captured. Product outcome: $SCOUT_OUTCOME. Report: $RETAINED_REPORT_PATH (harness report: $REPORT_PATH). Receipt: $RECEIPT_PATH"
exit 0
