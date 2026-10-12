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
import math
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
def require(condition, message):
    if not condition:
        raise SystemExit(message)

def is_text(value):
    return isinstance(value, str)

def is_string_list(value):
    return isinstance(value, list) and all(is_text(item) for item in value)

require(isinstance(report, dict), "combined report must be an object")
require(isinstance(report.get("wallMs"), (int, float)) and not isinstance(report.get("wallMs"), bool) and math.isfinite(report["wallMs"]), "combined report wallMs missing")
require(isinstance(report.get("vitestStatus"), int) and not isinstance(report.get("vitestStatus"), bool) and report.get("vitestStatus") == 0, "combined report does not record a passing focused test")
require(is_text(report.get("reportDir")), "combined report reportDir missing")
scenarios = report.get("scenarios")
require(isinstance(scenarios, list), "combined report scenarios missing")
matches = [scenario for scenario in scenarios if isinstance(scenario, dict) and scenario.get("scenario") == "Ask/To-do scout"]
require(len(matches) == 1, "combined report must contain exactly one Ask/To-do scout")
scenario = matches[0]
for field in ("file",):
    require(is_text(scenario.get(field)), f"scenario {field} missing")
require(scenario.get("validator") in {"seatbelt", "unsandboxed"}, "scenario validator invalid")
require(isinstance(scenario.get("wallMs"), (int, float)) and not isinstance(scenario.get("wallMs"), bool) and math.isfinite(scenario["wallMs"]), "scenario wallMs missing")
require(isinstance(scenario.get("ticks"), int) and not isinstance(scenario.get("ticks"), bool), "scenario ticks missing")
for field in ("actions", "tickLog", "errors"):
    require(isinstance(scenario.get(field), list), f"scenario {field} missing")
for field in ("notes", "workerLog"):
    require(is_string_list(scenario.get(field)), f"scenario {field} invalid")

scout = scenario.get("scout")
require(isinstance(scout, dict), "scout object missing")
require(scout.get("outcome") in {"yes", "no"}, "scout outcome must be yes or no")
require(scout.get("firstBlocker") is None or is_text(scout.get("firstBlocker")), "scout firstBlocker invalid")
identifiers = scout.get("identifiers")
require(isinstance(identifiers, dict), "scout identifiers missing")
for field in ("requestId", "captureId", "askId", "reviewId", "approvalRequestId", "approvalCaptureId", "approvalAskId", "runId"):
    require(field in identifiers and (identifiers[field] is None or is_text(identifiers[field])), f"scout identifier {field} invalid")
transcript = scout.get("transcript")
require(isinstance(transcript, list) and len(transcript) > 0, "scout transcript missing")
for entry in transcript:
    require(isinstance(entry, dict) and entry.get("command") in {"ask", "todo"} and is_text(entry.get("input")) and "result" in entry, "scout transcript entry invalid")
require(any(entry.get("command") == "ask" for entry in transcript) and any(entry.get("command") == "todo" for entry in transcript) and any(entry.get("command") == "ask" and entry.get("input", "").startswith("show ") for entry in transcript), "scout transcript must include Ask, Ask show, and To-do")

artifact = scout.get("artifactCheck")
require(isinstance(artifact, dict), "artifactCheck missing")
require(artifact.get("path") == "HelloWorld.txt" and artifact.get("canonicalPath") == "HelloWorld.txt", "artifactCheck path is not canonical HelloWorld.txt")
require(isinstance(artifact.get("expectedSha256"), str) and len(artifact["expectedSha256"]) == 64 and all(c in "0123456789abcdef" for c in artifact["expectedSha256"]), "artifactCheck expectedSha256 invalid")
require("actualSha256" in artifact, "artifactCheck actualSha256 missing")
actual_sha = artifact.get("actualSha256")
require(actual_sha is None or (isinstance(actual_sha, str) and len(actual_sha) == 64 and all(c in "0123456789abcdef" for c in actual_sha)), "artifactCheck actualSha256 invalid")
for field in ("exists", "exactBytes", "acceptedCompletionEvidence"):
    require(isinstance(artifact.get(field), bool), f"artifactCheck {field} invalid")
require((artifact.get("exists") and actual_sha is not None) or (not artifact.get("exists") and actual_sha is None), "artifactCheck existence and actualSha256 disagree")
require(artifact.get("exactBytes") == bool(artifact.get("exists") and actual_sha == artifact.get("expectedSha256")), "artifactCheck exactBytes disagrees with SHA-256")
evidence = artifact.get("evidence")
require(isinstance(evidence, list), "artifactCheck evidence missing")
for item in evidence:
    require(isinstance(item, dict) and is_text(item.get("id")) and (item.get("path") is None or is_text(item.get("path"))) and (item.get("canonicalPath") is None or is_text(item.get("canonicalPath"))) and is_text(item.get("status")) and (item.get("work_item_id") is None or is_text(item.get("work_item_id"))) and is_string_list(item.get("linkedRunIds")), "artifact evidence item invalid")

launched = scout.get("launched")
require(isinstance(launched, dict), "launched state missing")
for field in ("queued", "launched", "executionObserved"):
    require(isinstance(launched.get(field), bool), f"launched {field} invalid")
for field in ("publicRunId", "runId", "runStatus", "workItemId"):
    require(launched.get(field) is None or is_text(launched.get(field)), f"launched {field} invalid")
require(is_string_list(launched.get("linkedArtifactIds")), "launched linkedArtifactIds invalid")
require(launched.get("runId") == identifiers.get("runId"), "scout run identifiers disagree")
require(launched.get("queued") == (launched.get("runStatus") == "pending_execution"), "queued flag disagrees with run status")
require(launched.get("executionObserved") == (launched.get("runId") is not None and launched.get("runStatus") != "pending_execution"), "executionObserved disagrees with run state")
require(launched.get("launched") == launched.get("executionObserved"), "launched flag disagrees with execution state")

usage = scout.get("modelUsage")
require(isinstance(usage, dict) and isinstance(usage.get("calls"), int) and not isinstance(usage.get("calls"), bool) and usage.get("calls") == 0 and isinstance(usage.get("tokens"), int) and not isinstance(usage.get("tokens"), bool) and usage.get("tokens") == 0 and is_string_list(usage.get("guardCalls")) and len(usage["guardCalls"]) == 0 and is_string_list(usage.get("proof")), "zero-model evidence missing or inconsistent")
findings = scout.get("findings")
require(isinstance(findings, list), "scout findings missing")
for finding in findings:
    require(isinstance(finding, dict) and all(is_text(finding.get(field)) for field in ("code", "detail", "fingerprint", "proposedNextStep")), "scout finding invalid")
    require(len(finding["fingerprint"]) == 64 and all(c in "0123456789abcdef" for c in finding["fingerprint"]) and bool(finding["proposedNextStep"]), "scout finding fingerprint or next step invalid")
require(scout.get("outcome") == "yes" or len(findings) > 0, "no outcome must include an actionable finding")

linked_evidence = [item for item in evidence if item.get("canonicalPath") == "HelloWorld.txt" and item.get("status") in {"ready", "published"} and item.get("work_item_id") == launched.get("workItemId") and item.get("id") in launched.get("linkedArtifactIds", []) and launched.get("runId") in item.get("linkedRunIds", [])]
computed_evidence = bool(launched.get("runId") and launched.get("runStatus") == "completed" and launched.get("launched") and launched.get("workItemId") and linked_evidence)
require(artifact.get("acceptedCompletionEvidence") == computed_evidence, "acceptedCompletionEvidence disagrees with the linked Run and Artifact evidence")
computed_yes = bool(artifact.get("exists") and artifact.get("exactBytes") and artifact.get("actualSha256") == artifact.get("expectedSha256") and computed_evidence)
require((scout.get("outcome") == "yes") == computed_yes, "scout outcome contradicts exact file and linked completion evidence")
if scout.get("outcome") == "yes":
    require(scout.get("firstBlocker") is None, "successful scout cannot have a first blocker")
else:
    require(is_text(scout.get("firstBlocker")) and bool(scout.get("firstBlocker")), "no outcome must name its first blocker")

finding = findings[0] if findings else {}
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
