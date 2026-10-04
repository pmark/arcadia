#!/usr/bin/env bash
# G8: restore and prove terminal Off after the three-Action rehearsal. It uses
# only governed paths: `arcadia production deactivate` for Off and the reviewed,
# hash-pinned recover-arcadia-host-services action for the restart. It never
# signals a process by PID, removes a worktree or branch, resets Git, or turns
# production back on. Committed work is observed and classified, never discarded.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="restore-terminal-off-three-action-rehearsal-2026-10-04"
ARCADIA_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST="$FIXTURE_REPO/.arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
RECOVER_ID="recover-arcadia-host-services"
# The reviewed host-service path, pinned to its exact reviewed bytes.
RECOVER_SCRIPT_SHA256="d48ad928b578010f6de10f51bf971168db21713f2a99daf22354559afb500a63"
RECOVER_DESCRIPTOR_SHA256="3fa28275bee58c597a0df6575613466d6e1229bdca388be89c2d2fdb7ee4e7c8"
DRAIN_DEADLINE_SECONDS=1800
OBSERVATION_INTERVAL_SECONDS=15
REQUIRED_CONSECUTIVE_OBSERVATIONS=3
RESTART_TIMEOUT_SECONDS=900

case "${1:-run}" in
  run) ;;
  --describe) cat "$SCRIPT_DIR/$SCRIPT_ID.json"; exit 0 ;;
  *) echo "usage: $0 [run|--describe]" >&2; exit 2 ;;
esac

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$SCRIPT_DIR/runs/$RUN_ID"
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
LEDGER="$RUN_DIR/intervention-ledger.jsonl"
RESTART_RECEIPT="$RUN_DIR/restart-receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIR"
: > "$LEDGER"
exec > >(tee -a "$LOG") 2>&1

STAGE=preconditions
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
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"offState":%s,"restarted":%s,"interventionLedger":%s,"rawProcessSignals":0,"candidatesDiscarded":0%s}\n' \
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
    echo "No process was signalled by PID, no worktree, branch or candidate was removed, and production was not turned back on."
    if [[ "$OFF_STATE" != confirmed ]]; then
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

echo "== G8: restore and prove terminal Off =="
for tool in git jq mise timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the configured default workspace is not martianrover"
record_str workspace "$WORKSPACE"

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

read_status() { arcadia production status --json; }

# 1. Governed Off first: nothing below may delay it.
STAGE=production_off
STATUS="$(read_status)"
printf '%s\n' "$STATUS" > "$RUN_DIR/status-before.json"
jq -e '.ok == true and .data.read.status == "ok"' <<<"$STATUS" >/dev/null || refuse "production status is unreadable; an unreadable store is not a confirmed Off (use the dashboard Off switch)"
if jq -e '.data.read.policy.desiredState == "inactive"' <<<"$STATUS" >/dev/null; then
  ledger none "production was already Inactive at revision $(jq -r '.data.read.policy.revision' <<<"$STATUS"); no Off issued"
else
  REVOKED="$(jq -r '.data.read.policy.authority.requestId // "unknown"' <<<"$STATUS")"
  arcadia production deactivate --request-id "$SCRIPT_ID-$RUN_ID" --reason 'Terminal Off after the three-Action rehearsal; let committed work finish and preserve every candidate.' --json > "$RUN_DIR/off.json" || refuse "production deactivate failed"
  jq -e '.ok == true and .data.result.policy.desiredState == "inactive"' "$RUN_DIR/off.json" >/dev/null || refuse "the Off acknowledgement did not report Inactive"
  ledger production_off "revoked active policy $REVOKED at revision $(jq -r '.data.read.policy.revision' <<<"$STATUS") with request id $SCRIPT_ID-$RUN_ID"
fi
STATUS="$(read_status)"
jq -e '.data.read.policy.desiredState == "inactive"' <<<"$STATUS" >/dev/null || refuse "production is not Inactive after Off"
OFF_STATE=confirmed
printf '%s\n' "$STATUS" > "$RUN_DIR/inactive-receipt.json"
OFF_REVISION="$(jq -r '.data.read.policy.revision' <<<"$STATUS")"
OFF_EPOCH="$(jq -r '.data.read.policy.epoch' <<<"$STATUS")"
record offRevision "$OFF_REVISION"
record offEpoch "$OFF_EPOCH"

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

# 2. Restart only through the reviewed host-service path.
STAGE=restart_preconditions
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean on main before the reviewed restart reinstalls from it"
RECOVER="$SCRIPT_DIR/$RECOVER_ID.sh"
[[ -x "$RECOVER" && -f "$SCRIPT_DIR/$RECOVER_ID.json" ]] || refuse "the reviewed host-service action $RECOVER_ID is missing from the library"
[[ "$(sha256_of "$RECOVER")" == "$RECOVER_SCRIPT_SHA256" && "$(sha256_of "$SCRIPT_DIR/$RECOVER_ID.json")" == "$RECOVER_DESCRIPTOR_SHA256" ]] || refuse "$RECOVER_ID differs from its reviewed bytes; refusing an unreviewed restart path"

STAGE=restart
SERVICES_BEFORE="$(cd "$ARCADIA_REPO" && timeout 60 scripts/services.sh status 2>&1 || true)"
printf '%s\n' "$SERVICES_BEFORE" > "$RUN_DIR/services-before.txt"
RESTART_STARTED="$(now)"
RESTART_EXIT=0
# The nested action gets the workspace path and none of this action's /runs identity.
(cd "$ARCADIA_REPO" && env -u ARCADIA_OPERATOR_SCRIPT_ID -u ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR ARCADIA_WORKSPACE="$WORKSPACE" \
  timeout "$RESTART_TIMEOUT_SECONDS" "$RECOVER" run) > "$RUN_DIR/restart-output.log" 2>&1 || RESTART_EXIT=$?
RESTARTED=true
SERVICES_AFTER="$(cd "$ARCADIA_REPO" && timeout 60 scripts/services.sh status 2>&1 || true)"
printf '%s\n' "$SERVICES_AFTER" > "$RUN_DIR/services-after.txt"
WORKER_AFTER="$(arcadia worker status 2>&1 || true)"
jq -n --arg started "$RESTART_STARTED" --arg finished "$(now)" --argjson exit "$RESTART_EXIT" --arg path "$RECOVER_ID" --arg sha "$RECOVER_SCRIPT_SHA256" \
  --arg output "$RUN_DIR/restart-output.log" --arg before "$SERVICES_BEFORE" --arg after "$SERVICES_AFTER" --arg worker "$WORKER_AFTER" \
  '{schema: "arcadia-three-action-restart-receipt-v1", path: $path, scriptSha256: $sha, startedAt: $started, finishedAt: $finished, exitStatus: $exit, output: $output, servicesBefore: $before, servicesAfter: $after, workerAfter: $worker}' > "$RESTART_RECEIPT"
ledger service_restart "ran $RECOVER_ID (sha256 $RECOVER_SCRIPT_SHA256) with exit $RESTART_EXIT; receipt $RESTART_RECEIPT"
record_str restartReceipt "$RESTART_RECEIPT"
(( RESTART_EXIT == 0 )) || refuse "$RECOVER_ID exited $RESTART_EXIT; read $RUN_DIR/restart-output.log and its own failure handoff"
[[ "$WORKER_AFTER" == "Worker: running"* ]] || refuse "the worker is not running after the reviewed restart: $WORKER_AFTER"

STAGE=post_restart
observe_quiet post_restart 300
ledger observation "after restart: still Inactive at revision $OFF_REVISION, epoch $OFF_EPOCH, zero live admissions and Sessions across $REQUIRED_CONSECUTIVE_OBSERVATIONS observations"

# 3. Classify every fixture Session's committed work without touching it.
STAGE=reconcile_work
[[ -f "$MANIFEST" ]] || refuse "fixture manifest missing at $MANIFEST; committed rehearsal work could not be reconciled"
SESSIONS="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" < "$RUN_DIR/probe-sessions.mjs")"
printf '%s\n' "$SESSIONS" > "$RUN_DIR/fixture-sessions.json"
FIXTURE_MAIN="$(git -C "$FIXTURE_REPO" rev-parse refs/heads/main)"
: > "$RUN_DIR/work-reconciliation.jsonl"
UNRECONCILED=0
COUNT="$(jq '.fixtureSessions | length' <<<"$SESSIONS")"
for ((i = 0; i < COUNT; i++)); do
  ROW="$(jq -c ".fixtureSessions[$i]" <<<"$SESSIONS")"
  SID="$(jq -r '.id' <<<"$ROW")"; WT="$(jq -r '.worktree_path' <<<"$ROW")"; BRANCH="$(jq -r '.branch' <<<"$ROW")"
  BASE="$(jq -r '.base_revision' <<<"$ROW")"; PRESERVED="$(jq -r '.preservation.commit_sha // empty' <<<"$ROW")"
  TIP=""; DIRTY=false
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
  elif [[ -z "$TIP" || "$TIP" == "$BASE" ]]; then
    STATE=no_committed_work
  elif git -C "$FIXTURE_REPO" merge-base --is-ancestor "$TIP" "$FIXTURE_MAIN" 2>/dev/null; then
    STATE=integrated
  elif [[ -n "$PRESERVED" && "$PRESERVED" == "$TIP" ]]; then
    STATE=preserved
  else
    STATE=committed_unreconciled
  fi
  case "$STATE" in integrated | preserved | no_committed_work) ;; *) UNRECONCILED=$((UNRECONCILED + 1)) ;; esac
  jq -nc --arg session "$SID" --arg action "$(jq -r '.action_id' <<<"$ROW")" --arg state "$STATE" --arg tip "$TIP" --arg worktree "$WT" --arg branch "$BRANCH" --arg pr "$(jq -r '.preservation.pull_request_url // ""' <<<"$ROW")" \
    '{session: $session, action: $action, state: $state, tip: $tip, worktree: $worktree, branch: $branch, pullRequest: $pr}' >> "$RUN_DIR/work-reconciliation.jsonl"
  echo "work: $SID $STATE"
done
record_str workReconciliation "$RUN_DIR/work-reconciliation.jsonl"
record_str fixtureMain "$FIXTURE_MAIN"
(( UNRECONCILED == 0 )) || refuse "$UNRECONCILED fixture Session(s) hold live, uncommitted or unreconciled committed work; it was retained untouched (see work-reconciliation.jsonl)"

STAGE=complete
REASON=""
ledger completed "terminal Off proven; no raw process signal sent and no candidate discarded"
write_receipt succeeded
echo "TERMINAL OFF PROVEN: Inactive at revision $OFF_REVISION, zero live admissions and Sessions before and after the reviewed restart; every fixture candidate is integrated, preserved or empty."
echo "Receipt: $RECEIPT"
