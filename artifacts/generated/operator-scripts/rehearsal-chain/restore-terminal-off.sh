#!/usr/bin/env bash
# Rehearsal chain G8: restore and prove terminal Off after one run of the
# N-Action serial chain, driven only by that run's reviewed parameter file. It
# is the run-5 G8 with three changes: it owns only this run's G7 policy
# (request id grant-production-rehearsal-chain-<run-id>, with the fixture
# Project and Plan and the Actions that G7's receipt recorded), and turns it Off
# before it reads the parameter file or checks its launcher binding, so a drifted
# launcher or parameter file cannot block the emergency stop; it copies the worker logs
# into its evidence folder before the reviewed restart (the restart recreates
# them); and its receipt names the run's Actions. It uses only governed paths:
# `arcadia production deactivate` for Off and the reviewed, hash-pinned
# recover-arcadia-host-services action (and its pinned restart implementation)
# for the restart. This script sends no signal itself except the SIGTERM a
# bounded `timeout` sends on expiry; that reviewed restart path unloads
# Arcadia's launchd services and may SIGTERM Arcadia's own service processes.
# It never removes a worktree or branch, resets Git, or turns production back
# on. Committed work is observed, never discarded. Run it from the Terminal
# panel or /runs: a non-interactive shell refuses at its launch guard.
set -Eeuo pipefail

IMPL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LIBRARY_DIR="$(cd "$IMPL_DIR/.." && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
KIND_PREFIX="restore-terminal-off-rehearsal-chain"
IMPL_FILE="restore-terminal-off.sh"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST="$FIXTURE_REPO/.arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
RECOVER_ID="recover-arcadia-host-services"
# The reviewed host-service path, pinned to its exact reviewed bytes.
RECOVER_SCRIPT_SHA256="d48ad928b578010f6de10f51bf971168db21713f2a99daf22354559afb500a63"
RECOVER_DESCRIPTOR_SHA256="4e6186613c03c86a67f8ee8cccdeb6adaf1a979e677ab621d07cc15fb3f1c0f1"
# scripts/services.sh (tracked, clean main) delegates to this implementation.
RESTART_IMPL="$HOME/.codex/skills/restart-arcadia-services/scripts/restart-services.sh"
RESTART_IMPL_SHA256="ac0c60a1d8282f9413e92e77066f44f58257cc6a8d979f1d1e4fe8097b8b53b6"
WORKER_LOG_GLOB="$HOME/Library/Logs/arcadia-services-*"
DRAIN_DEADLINE_SECONDS=1800
OBSERVATION_INTERVAL_SECONDS=15
REQUIRED_CONSECUTIVE_OBSERVATIONS=3
RESTART_TIMEOUT_SECONDS=900
RUN_PARAM_PATTERN='^run[0-9]{1,3}-[0-9]{4}-[0-9]{2}-[0-9]{2}$'

# --- Launcher binding. G8 is the emergency stop: only a launch that does not even name a run
# (a wrong parameter path) stops before turning anything Off. A drifted launcher or descriptor
# and a broken parameter file are refused only AFTER this run's own Grant is Off.
PARAMS_FILE="${1:-}"
MODE="${2:-run}"
case "$MODE" in run | --describe) ;; *) echo "usage: <launcher> [run|--describe]" >&2; exit 2 ;; esac
RUN_PARAM_ID="$(basename "$PARAMS_FILE" .json)"
LAUNCH_NAMES_RUN=true
if [[ ! "$RUN_PARAM_ID" =~ $RUN_PARAM_PATTERN || "$PARAMS_FILE" != "$IMPL_DIR/params/$RUN_PARAM_ID.json" ]]; then
  if [[ "$MODE" == --describe ]]; then echo "REFUSED: run this through its per-run library launcher ($KIND_PREFIX-<run-id>.sh), which passes rehearsal-chain/params/<run-id>.json" >&2; exit 2; fi
  LAUNCH_NAMES_RUN=false
  RUN_PARAM_ID="unnamed-run"
fi
SCRIPT_ID="$KIND_PREFIX-$RUN_PARAM_ID"
canonical_launcher() {
  printf '%s\n' '#!/usr/bin/env bash' \
    "# Rehearsal chain $RUN_PARAM_ID: runs the shared $IMPL_FILE with this run's reviewed parameter file and nothing else." \
    'set -euo pipefail' \
    'library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"' \
    "exec \"\$library_dir/rehearsal-chain/$IMPL_FILE\" \"\$library_dir/rehearsal-chain/params/$RUN_PARAM_ID.json\" \"\${1:-run}\""
}
launcher_published() { [[ -f "$LIBRARY_DIR/$SCRIPT_ID.json" && "$(cat "$LIBRARY_DIR/$SCRIPT_ID.sh" 2>/dev/null)" == "$(canonical_launcher)" ]]; }
if [[ "$MODE" == --describe ]]; then
  launcher_published || { echo "REFUSED: $SCRIPT_ID is not published in this library with its exact launcher and descriptor" >&2; exit 2; }
  cat "$LIBRARY_DIR/$SCRIPT_ID.json"; exit 0
fi
# G8 owns only the policy this run's G7 Grant activated.
GRANT_ID="grant-production-rehearsal-chain-$RUN_PARAM_ID"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$LIBRARY_DIR/runs/$RUN_ID"
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
LEDGER="$RUN_DIR/intervention-ledger.jsonl"
RESTART_RECEIPT="$RUN_DIR/restart-receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIR"
: > "$LEDGER"
exec > >(tee -a "$LOG") 2>&1

STAGE=launch_context
REASON=""
EXTRA=""
OFF_STATE=unknown
RESTARTED=false
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
ledger() { printf '{"at":%s,"intervention":%s,"detail":%s}\n' "$(json_string "$(now)")" "$(json_string "$1")" "$(json_string "$2")" >> "$LEDGER"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"offState":%s,"restarted":%s,"interventionLedger":%s%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(now)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$(json_string "$OFF_STATE")" "$RESTARTED" "$(json_string "$LEDGER")" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
on_error() {
  local code=$? command="$BASH_COMMAND"
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  trap - ERR
  set +e
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  ledger stopped "stage $STAGE: $REASON"
  write_receipt refused
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- production Off: $OFF_STATE"
    echo "- services restarted by this run: $RESTARTED"
    echo "- intervention ledger: $LEDGER"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT"
    echo
    echo "This script sent no signal except a bounded timeout's SIGTERM on expiry, removed no worktree, branch or candidate, and did not turn production back on."
    if [[ "$STAGE" == restart && "${RESTART_EXIT:-0}" == 124 ]]; then echo "The 15-minute restart bound expired mid-restart: Arcadia services may be left STOPPED. Check scripts/services.sh status and rerun this action from a terminal."; fi
    if [[ "$RESTARTED" == true ]]; then echo "The reviewed restart path ran: it unloads Arcadia's launchd services and may SIGTERM Arcadia's own service processes."; fi
    if [[ "$OFF_STATE" == not_owned ]]; then
      echo "Production is Active under a policy G8 does not own (not request id $GRANT_ID with this run's exact fixture scope). G8 did NOT turn it Off."
      echo "If it should stop, turn it Off through its own governed path: the dashboard production Off switch, or run"
      echo "  arcadia production deactivate --request-id <your-request-id> --reason '<why>'"
      echo "yourself after reading arcadia production status. Rerun G8 afterwards to prove the rehearsal's terminal Off."
    elif [[ "$OFF_STATE" != confirmed ]]; then
      echo "Off is NOT confirmed. Rerun this action, or turn production Off from the dashboard switch, before anything else."
    fi
    echo "Live work still draining or unreconciled candidates are retained exactly as observed; give this handoff to a coding agent"
    echo "to diagnose through the reviewed paths. Rerunning this repeatable action is safe."
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
trap on_error ERR

arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }
probe() { (cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$@"); }
sha256_of() { if command -v shasum >/dev/null; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

echo "== G8 (rehearsal chain $RUN_PARAM_ID): restore and prove terminal Off =="
# Launch guards: the main-library /runs launcher (exact id and descriptor), or an
# interactive host terminal, which is preferred because the restart also restarts
# the dashboard that runs /runs actions. Never an agent sandbox.
[[ "$LAUNCH_NAMES_RUN" == true ]] || refuse "this launch names no rehearsal-chain run (the parameter path must be rehearsal-chain/params/<run-id>.json beside this implementation), so G8 owns no policy and turned nothing Off; run this run's G8 launcher, or turn production Off from the dashboard switch"
DESCRIPTOR_PATH="${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}"
if [[ -n "${ARCADIA_OPERATOR_SCRIPT_ID:-}" || -n "$DESCRIPTOR_PATH" ]]; then
  [[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$SCRIPT_ID" && -n "$DESCRIPTOR_PATH" && -f "$DESCRIPTOR_PATH" ]] || refuse "launched by another operator action; run this one from /runs or a terminal"
  [[ "$(cd "$(dirname "$DESCRIPTOR_PATH")" && pwd -P)/$(basename "$DESCRIPTOR_PATH")" == "$LIBRARY_DIR/$SCRIPT_ID.json" ]] || refuse "the launching descriptor is not this action's descriptor"
else
  [[ -t 0 ]] || refuse "launch this action through /runs or from an interactive host terminal"
fi
[[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only action: an agent sandbox may not run it"
STAGE=preconditions
for tool in jq mise timeout; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
record_str chainRunId "$RUN_PARAM_ID"
# Ownership comes from this run's own G7, never from the parameter file (which may have drifted
# since the press): its request id, the fixture Project and Plan, and the Actions its latest
# receipt recorded (G7 records them before any preview or activation). With no such receipt (a G7
# that vanished after activating), the request id, Project and Plan plus a scope made only of this
# fixture's chain Action ids.
# The latest receipt of a G7 attempt that activated (activated true, also on a refused run whose
# cleanup observed its own policy Active) or succeeded is preferred: a later refused attempt also
# records actionIds before it refuses, and must not displace the scope that was actually activated.
# Only when no attempt activated or succeeded does the latest receipt with actionIds decide.
G7_RECEIPT=""
G7_ANY_RECEIPT=""
for candidate in "$LIBRARY_DIR"/runs/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$GRANT_ID" '.id == $id and (.actionIds | type == "array" and length >= 3 and all(.[]; type == "string"))' "$candidate" >/dev/null 2>&1; then
    G7_ANY_RECEIPT="$candidate"
    if jq -e '.activated == true or .outcome == "succeeded"' "$candidate" >/dev/null 2>&1; then G7_RECEIPT="$candidate"; fi
  fi
done
[[ -n "$G7_RECEIPT" ]] || G7_RECEIPT="$G7_ANY_RECEIPT"
if [[ -n "$G7_RECEIPT" ]]; then
  OWNED_ACTIONS_JSON="$(jq -c --arg p "$FIXTURE_PROJECT" '[.actionIds[] | "\($p)/\(.)"]' "$G7_RECEIPT")"
  record_str ownershipBasis "G7 receipt $G7_RECEIPT"
else
  OWNED_ACTIONS_JSON=null
  record_str ownershipBasis "request id, Project and Plan (no G7 receipt with actionIds)"
fi
record ownedActions "$OWNED_ACTIONS_JSON"

cat > "$RUN_DIR/probe-sessions.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { listActiveAgentSessions } from "./src/sessions/index.ts";
const [workspace, project] = process.argv.slice(2);
const result = withReadOnlyDatabase(workspace, (db) => {
  const table = (name) => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  const active = listActiveAgentSessions(db).map((s) => ({ id: s.id, project: s.project_slug, action: s.action_id, status: s.status }));
  const sessions = table("agent_sessions")
    ? db.prepare("SELECT id, action_id, status, branch, worktree_path, base_revision FROM agent_sessions WHERE project_slug = ? ORDER BY prepared_at").all(project)
    : [];
  const preserved = table("candidate_preservation_receipts")
    ? db.prepare("SELECT commit_sha, preservation_state, pull_request_url FROM candidate_preservation_receipts WHERE request_id = ?")
    : null;
  return {
    active,
    fixtureSessions: sessions.map((s) => ({ ...s, preservation: preserved ? preserved.get(`worker-tick-preserve-${s.id}`) ?? null : null }))
  };
});
console.log(JSON.stringify(result));
NODE

# A preserved candidate whose tip moved past its receipt commit is reconciled only
# by the tested read-only helper: exactly one genuine accepted-completion
# settlement of its Action on top of the receipt commit, clean, and remotely
# preserved at that exact tip on the same branch and pull request.
cat > "$RUN_DIR/classify-candidate.mjs" <<'NODE'
import { classifyPreservedCandidate } from "./src/operatorActions/preservedCandidateReconciliation.ts";
console.log(JSON.stringify(classifyPreservedCandidate(JSON.parse(process.argv[2]))));
NODE

read_status() { arcadia production status --json; }

# 1. Governed Off is the first Arcadia command (the CLI resolves its own default
# workspace); workspace and every other check come after it.
STAGE=production_off
STATUS="$(read_status)"
printf '%s\n' "$STATUS" > "$RUN_DIR/status-before.json"
jq -e '.ok == true and .data.read.status == "ok"' <<<"$STATUS" >/dev/null || refuse "production status is unreadable; an unreadable store is not a confirmed Off (use the dashboard Off switch)"
if jq -e '.data.read.policy.desiredState == "inactive"' <<<"$STATUS" >/dev/null; then
  ledger none "production was already Inactive at revision $(jq -r '.data.read.policy.revision' <<<"$STATUS"); no Off issued"
else
  # Only this run's own G7 policy, with exactly the fixture scope, is turned Off here.
  REVOKED="$(jq -r '.data.read.policy.authority.requestId // "unknown"' <<<"$STATUS")"
  if ! jq -e --arg id "$GRANT_ID" --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PROJECT/$FIXTURE_PLAN" --argjson owned "$OWNED_ACTIONS_JSON" \
      'def same_set($x; $y): ($x | type == "array") and ($x | length) == ($y | length) and ($x | unique | length) == ($x | length) and ($x | sort) == ($y | sort);
       .data.read.policy.authority.requestId == $id and .data.read.policy.scope.projects == [$p] and .data.read.policy.scope.plans == [$plan]
       and (if $owned != null then same_set(.data.read.policy.scope.actions; $owned)
            else (.data.read.policy.scope.actions | type == "array" and length > 0 and all(.[]; type == "string" and test("^three-action-rehearsal/(write-start-marker|transform-start-marker|verify-final-rehearsal|chain-step-(0[4-9]|1[0-2]))$"))) end)' <<<"$STATUS" >/dev/null; then
    OFF_STATE=not_owned
    refuse "production is Active under request id $REVOKED, which is not this run's $GRANT_ID with the fixture Project, Plan and the Actions its G7 recorded; G8 does not own it and did not turn it Off"
  fi
  REVOKED_SCOPE="$(jq -c '.data.read.policy.scope | if . == null then null else {projects, actions, providers} end' <<<"$STATUS")"
  arcadia production deactivate --request-id "$SCRIPT_ID-$RUN_ID" --reason 'Terminal Off after the rehearsal chain; let committed work finish and preserve every candidate.' --json > "$RUN_DIR/off.json" || refuse "production deactivate failed"
  jq -e '.ok == true and .data.result.policy.desiredState == "inactive"' "$RUN_DIR/off.json" >/dev/null || refuse "the Off acknowledgement did not report Inactive"
  ledger production_off "revoked active policy $REVOKED (scope $REVOKED_SCOPE) at revision $(jq -r '.data.read.policy.revision' <<<"$STATUS") with request id $SCRIPT_ID-$RUN_ID"
fi
STATUS="$(read_status)"
jq -e '.data.read.policy.desiredState == "inactive"' <<<"$STATUS" >/dev/null || refuse "production is not Inactive after Off"
OFF_STATE=confirmed
printf '%s\n' "$STATUS" > "$RUN_DIR/inactive-receipt.json"
OFF_REVISION="$(jq -r '.data.read.policy.revision' <<<"$STATUS")"
OFF_EPOCH="$(jq -r '.data.read.policy.epoch' <<<"$STATUS")"
record offRevision "$OFF_REVISION"
record offEpoch "$OFF_EPOCH"

# Only now, with this run's Grant Off: the launcher binding and the parameter file.
STAGE=parameters
launcher_published || refuse "$SCRIPT_ID is not published in this library with its exact launcher and descriptor; production is Off (confirmed), but the observations, restart and reconciliation did not run"
RUN_N="$(jq -er --arg run "$RUN_PARAM_ID" 'select(.schema == "arcadia-rehearsal-chain-run-v1" and .runId == $run) | .actionCount | select(type == "number" and . >= 3 and . <= 12 and . == floor)' "$PARAMS_FILE" 2>/dev/null)" \
  || refuse "the parameter file $PARAMS_FILE does not name run $RUN_PARAM_ID with an Action count from 3 to 12; production is Off (confirmed), but the observations, restart and reconciliation did not run"
FIXTURE_ACTIONS_JSON="$(jq -nc --arg p "$FIXTURE_PROJECT" --argjson n "$RUN_N" '["write-start-marker","transform-start-marker","verify-final-rehearsal"] + [range(4; $n + 1) | "chain-step-\(if . < 10 then "0" else "" end)\(.)"] | map("\($p)/\(.)")')"
record actionIds "$(jq -c 'map(sub("^[^/]+/"; ""))' <<<"$FIXTURE_ACTIONS_JSON")"
record scopedActions "$FIXTURE_ACTIONS_JSON"

STAGE=preconditions
for tool in git node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the configured default workspace is not martianrover"
record_str workspace "$WORKSPACE"

# Repeated observations: Inactive at the Off revision and epoch, zero live
# admissions and zero prepared or running Sessions host-wide.
observe_quiet() {
  local label="$1" deadline="$2" consecutive=0 started elapsed status sessions
  started="$(date -u +%s)"
  : > "$RUN_DIR/observations-$label.jsonl"
  while :; do
    status="$(read_status)" || status='{}'
    sessions="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" < "$RUN_DIR/probe-sessions.mjs")" || sessions='{}'
    jq -nc --arg at "$(now)" --argjson s "$status" --argjson q "$sessions" \
      '{at: $at, state: $s.data.read.policy.desiredState, revision: $s.data.read.policy.revision, epoch: $s.data.read.policy.epoch, liveAdmissions: $s.data.liveAdmissions, activeSessions: ($q.active // null)}' >> "$RUN_DIR/observations-$label.jsonl"
    if jq -e --argjson r "$OFF_REVISION" --argjson e "$OFF_EPOCH" '.data.read.policy.desiredState == "inactive" and .data.read.policy.revision == $r and .data.read.policy.epoch == $e and .data.liveAdmissions == 0' <<<"$status" >/dev/null 2>&1 \
      && jq -e '.active == []' <<<"$sessions" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
    else
      if ! jq -e '.data.read.policy.desiredState == "inactive"' <<<"$status" >/dev/null 2>&1; then
        OFF_STATE=lost
        refuse "production left Inactive during $label observation; something turned it back on"
      fi
      consecutive=0
    fi
    if (( consecutive >= REQUIRED_CONSECUTIVE_OBSERVATIONS )); then return 0; fi
    elapsed=$(( $(date -u +%s) - started ))
    if (( elapsed >= deadline )); then
      refuse "$label: live admissions or Sessions did not reach zero for $REQUIRED_CONSECUTIVE_OBSERVATIONS consecutive observations within ${deadline}s; committed work is left to finish, nothing was killed"
    fi
    sleep "$OBSERVATION_INTERVAL_SECONDS"
  done
}

STAGE=drain
observe_quiet drain "$DRAIN_DEADLINE_SECONDS"
ledger observation "zero live admissions and zero prepared or running Sessions across $REQUIRED_CONSECUTIVE_OBSERVATIONS consecutive observations after Off"

# The restart recreates the worker logs (run 5's log after its G8 held nothing from runs 1 to 5):
# copy every worker log into this run's evidence folder first, and refuse to restart without one.
STAGE=preserve_worker_log
EVIDENCE_DIR="$RUN_DIR/evidence/worker-logs"
mkdir -p "$EVIDENCE_DIR"
COPIED="[]"
for directory in $WORKER_LOG_GLOB; do
  [[ -d "$directory" ]] || continue
  for name in worker.out.log worker.err.log; do
    [[ -f "$directory/$name" ]] || continue
    mkdir -p "$EVIDENCE_DIR/${directory##*/}"
    cp -p "$directory/$name" "$EVIDENCE_DIR/${directory##*/}/$name"
    [[ "$(sha256_of "$directory/$name")" == "$(sha256_of "$EVIDENCE_DIR/${directory##*/}/$name")" ]] || refuse "the copy of $directory/$name does not match its source"
    COPIED="$(jq -c --arg source "$directory/$name" --arg copy "$EVIDENCE_DIR/${directory##*/}/$name" --arg sha "$(sha256_of "$EVIDENCE_DIR/${directory##*/}/$name")" \
      --argjson bytes "$(wc -c < "$EVIDENCE_DIR/${directory##*/}/$name" | tr -d ' ')" '. + [{source: $source, copy: $copy, sha256: $sha, bytes: $bytes}]' <<<"$COPIED")"
  done
done
[[ "$(jq '[.[] | select(.source | endswith("/worker.out.log"))] | length' <<<"$COPIED")" -gt 0 ]] || refuse "no worker.out.log was found under $WORKER_LOG_GLOB, so the restart would leave no worker evidence; production is Off and nothing was restarted"
record workerLogs "$COPIED"
ledger evidence "copied $(jq length <<<"$COPIED") worker log file(s) into $EVIDENCE_DIR before the restart"

# 2. Restart only through the reviewed host-service path.
STAGE=restart_preconditions
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean on main before the reviewed restart reinstalls from it"
RECOVER="$LIBRARY_DIR/$RECOVER_ID.sh"
[[ -x "$RECOVER" && -f "$LIBRARY_DIR/$RECOVER_ID.json" ]] || refuse "the reviewed host-service action $RECOVER_ID is missing from the library"
[[ "$(sha256_of "$RECOVER")" == "$RECOVER_SCRIPT_SHA256" && "$(sha256_of "$LIBRARY_DIR/$RECOVER_ID.json")" == "$RECOVER_DESCRIPTOR_SHA256" ]] || refuse "$RECOVER_ID differs from its reviewed bytes; refusing an unreviewed restart path"
[[ -f "$RESTART_IMPL" && "$(sha256_of "$RESTART_IMPL")" == "$RESTART_IMPL_SHA256" ]] || refuse "the restart implementation $RESTART_IMPL is missing or differs from its reviewed bytes"

STAGE=restart
SERVICES_BEFORE="$(cd "$ARCADIA_REPO" && timeout 60 scripts/services.sh status 2>&1 || true)"
printf '%s\n' "$SERVICES_BEFORE" > "$RUN_DIR/services-before.txt"
RESTART_STARTED="$(now)"
RESTART_EXIT=0
# The nested action gets the workspace path, none of this action's /runs
# identity, and none of the variables that would redirect the pinned restart
# path to another implementation, toolchain or retry policy.
(cd "$ARCADIA_REPO" && env -u ARCADIA_OPERATOR_SCRIPT_ID -u ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR \
  -u ARCADIA_RESTART_SCRIPT -u ARCADIA_RESTART_ATTEMPTS -u ARCADIA_RESTART_RETRY_DELAY \
  -u ARCADIA_MISE_BIN -u ARCADIA_NODE_BIN -u ARCADIA_WORKSPACE_DEFAULT ARCADIA_WORKSPACE="$WORKSPACE" \
  timeout "$RESTART_TIMEOUT_SECONDS" "$RECOVER" run) > "$RUN_DIR/restart-output.log" 2>&1 || RESTART_EXIT=$?
RESTARTED=true
SERVICES_AFTER="$(cd "$ARCADIA_REPO" && timeout 60 scripts/services.sh status 2>&1 || true)"
printf '%s\n' "$SERVICES_AFTER" > "$RUN_DIR/services-after.txt"
WORKER_AFTER="$(arcadia worker status 2>&1 || true)"
jq -n --arg started "$RESTART_STARTED" --arg finished "$(now)" --argjson exit "$RESTART_EXIT" --arg path "$RECOVER_ID" --arg sha "$RECOVER_SCRIPT_SHA256" \
  --arg output "$RUN_DIR/restart-output.log" --arg before "$SERVICES_BEFORE" --arg after "$SERVICES_AFTER" --arg worker "$WORKER_AFTER" \
  --arg impl "$RESTART_IMPL" --arg implSha "$RESTART_IMPL_SHA256" \
  '{schema: "arcadia-three-action-restart-receipt-v1", path: $path, scriptSha256: $sha, implementation: $impl, implementationSha256: $implSha, mayTerminateArcadiaServiceProcesses: true, startedAt: $started, finishedAt: $finished, exitStatus: $exit, output: $output, servicesBefore: $before, servicesAfter: $after, workerAfter: $worker}' > "$RESTART_RECEIPT"
ledger service_restart "ran $RECOVER_ID (sha256 $RECOVER_SCRIPT_SHA256) with exit $RESTART_EXIT; receipt $RESTART_RECEIPT"
record_str restartReceipt "$RESTART_RECEIPT"
(( RESTART_EXIT == 0 )) || refuse "$RECOVER_ID exited $RESTART_EXIT; read $RUN_DIR/restart-output.log and its own failure handoff"
[[ "$WORKER_AFTER" == "Worker: running"* ]] || refuse "the worker is not running after the reviewed restart: $WORKER_AFTER"

STAGE=post_restart
observe_quiet post_restart 300
ledger observation "after restart: still Inactive at revision $OFF_REVISION, epoch $OFF_EPOCH, zero live admissions and Sessions across $REQUIRED_CONSECUTIVE_OBSERVATIONS observations"

# 3. Classify every fixture Session's committed work (every run's, so all N of this
# run's candidates and every earlier one) without touching it.
STAGE=reconcile_work
[[ -f "$MANIFEST" ]] || refuse "fixture manifest missing at $MANIFEST; committed rehearsal work could not be reconciled"
SESSIONS="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" < "$RUN_DIR/probe-sessions.mjs")"
printf '%s\n' "$SESSIONS" > "$RUN_DIR/fixture-sessions.json"
FIXTURE_MAIN="$(git -C "$FIXTURE_REPO" rev-parse refs/heads/main)"
FIXTURE_GITHUB="$(jq -r '.githubRepository // empty' "$MANIFEST")"
: > "$RUN_DIR/work-reconciliation.jsonl"
UNRECONCILED=0
COUNT="$(jq '.fixtureSessions | length' <<<"$SESSIONS")"
for ((i = 0; i < COUNT; i++)); do
  ROW="$(jq -c ".fixtureSessions[$i]" <<<"$SESSIONS")"
  SID="$(jq -r '.id' <<<"$ROW")"; WT="$(jq -r '.worktree_path' <<<"$ROW")"; BRANCH="$(jq -r '.branch' <<<"$ROW")"
  BASE="$(jq -r '.base_revision' <<<"$ROW")"; PRESERVED="$(jq -r '.preservation.commit_sha // empty' <<<"$ROW")"
  TIP=""; DIRTY=false; BASIS=""; REFUSAL=""; CLASSIFIED='{}'
  if [[ -d "$WT" ]]; then
    TIP="$(git -C "$WT" rev-parse HEAD 2>/dev/null || true)"
    [[ -z "$(git -C "$WT" status --porcelain 2>/dev/null)" ]] || DIRTY=true
  else
    TIP="$(git -C "$FIXTURE_REPO" rev-parse --verify -q "refs/heads/$BRANCH" 2>/dev/null || true)"
  fi
  if [[ "$(jq -r '.status' <<<"$ROW")" == prepared || "$(jq -r '.status' <<<"$ROW")" == running ]]; then
    STATE=still_live
  elif [[ "$DIRTY" == true ]]; then
    STATE=uncommitted_changes_retained
  elif [[ -n "$TIP" && "$TIP" != "$BASE" ]] && git -C "$FIXTURE_REPO" merge-base --is-ancestor "$TIP" "$FIXTURE_MAIN" 2>/dev/null; then
    STATE=integrated
  elif [[ -n "$PRESERVED" ]] && git -C "$FIXTURE_REPO" merge-base --is-ancestor "$PRESERVED" "$FIXTURE_MAIN" 2>/dev/null && [[ -z "$TIP" || "$TIP" == "$PRESERVED" ]]; then
    STATE=integrated
  elif [[ -n "$PRESERVED" && ( -z "$TIP" || "$TIP" == "$PRESERVED" ) ]]; then
    STATE=preserved; BASIS=exact_tip
  elif [[ -z "$PRESERVED" && ( -z "$TIP" || "$TIP" == "$BASE" ) ]]; then
    STATE=no_committed_work
  elif [[ -n "$PRESERVED" && -n "$TIP" ]]; then
    if [[ -d "$WT" ]]; then CANDIDATE_GIT="$WT"; CANDIDATE_WT="$WT"; else CANDIDATE_GIT="$FIXTURE_REPO"; CANDIDATE_WT=""; fi
    INPUT="$(jq -nc --arg workspace "$WORKSPACE" --arg project "$FIXTURE_PROJECT" --arg action "$(jq -r '.action_id' <<<"$ROW")" \
      --arg repository "$CANDIDATE_GIT" --arg worktree "$CANDIDATE_WT" --arg receipt "$PRESERVED" --arg tip "$TIP" --arg branch "$BRANCH" \
      --arg pr "$(jq -r '.preservation.pull_request_url // ""' <<<"$ROW")" --arg github "$FIXTURE_GITHUB" \
      '{workspace: $workspace, project: $project, actionId: $action, repository: $repository, worktree: (if $worktree == "" then null else $worktree end), receiptCommit: $receipt, tip: $tip, branch: $branch, pullRequestUrl: $pr, githubRepository: $github}')"
    CLASSIFIED="$(probe "$INPUT" < "$RUN_DIR/classify-candidate.mjs")" || CLASSIFIED='{"reconciled":false,"reason":"classifier_failed","detail":"the settled-descendant classifier did not run"}'
    jq -e 'type == "object"' <<<"$CLASSIFIED" >/dev/null 2>&1 || CLASSIFIED='{"reconciled":false,"reason":"classifier_failed","detail":"the settled-descendant classifier returned unreadable output"}'
    if jq -e '.reconciled == true and .basis == "settled_descendant"' <<<"$CLASSIFIED" >/dev/null; then
      STATE=preserved; BASIS=settled_descendant
    else
      STATE=committed_unreconciled; REFUSAL="$(jq -r '.reason // "classifier_failed"' <<<"$CLASSIFIED")"
    fi
  else
    STATE=committed_unreconciled
  fi
  case "$STATE" in integrated | preserved | no_committed_work) ;; *) UNRECONCILED=$((UNRECONCILED + 1)) ;; esac
  jq -nc --arg session "$SID" --arg action "$(jq -r '.action_id' <<<"$ROW")" --arg state "$STATE" --arg tip "$TIP" --arg worktree "$WT" --arg branch "$BRANCH" --arg pr "$(jq -r '.preservation.pull_request_url // ""' <<<"$ROW")" \
    --arg preserved "$PRESERVED" --arg basis "$BASIS" --arg refusal "$REFUSAL" --argjson classified "$CLASSIFIED" \
    '{session: $session, action: $action, state: $state, tip: $tip, worktree: $worktree, branch: $branch, pullRequest: $pr, preservedCommit: $preserved}
      + (if $basis == "" then {} else {basis: $basis} end) + (if $refusal == "" then {} else {refusal: $refusal, refusalDetail: ($classified.detail // "")} end)
      + (if $classified.settlement then {settlement: $classified.settlement, remote: $classified.remote} else {} end)' >> "$RUN_DIR/work-reconciliation.jsonl"
  echo "work: $SID $STATE${BASIS:+ ($BASIS)}${REFUSAL:+ (refused: $REFUSAL)}"
done
record_str workReconciliation "$RUN_DIR/work-reconciliation.jsonl"
record_str fixtureMain "$FIXTURE_MAIN"
# Which of this run's N Actions have a fixture Session at all (informational: an Action the run never reached has none).
record "chainActionSessions" "$(jq -sc --argjson actions "$FIXTURE_ACTIONS_JSON" '. as $rows | [$actions[] | sub("^[^/]+/"; "") as $id | {action: $id, sessions: [$rows[] | select(.action == $id) | {session, state}]}]' "$RUN_DIR/work-reconciliation.jsonl")"
(( UNRECONCILED == 0 )) || refuse "$UNRECONCILED fixture Session(s) hold live, uncommitted or unreconciled committed work; it was retained untouched (see work-reconciliation.jsonl)"

STAGE=complete
REASON=""
ledger completed "terminal Off proven; this script issued no signal of its own beyond bounded timeouts and only read candidate worktrees and branches"
write_receipt succeeded
echo "TERMINAL OFF PROVEN: Inactive at revision $OFF_REVISION, zero live admissions and Sessions before and after the reviewed restart; every fixture candidate is integrated, preserved or empty."
echo "Next run: fill its parameter file's previous-run bindings from this receipt (fixtureMain $FIXTURE_MAIN, runId $RUN_ID) and work-reconciliation.jsonl."
echo "Receipt: $RECEIPT"
