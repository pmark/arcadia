#!/usr/bin/env bash
# G7 for rehearsal run 3: one-shot Grant for the third disposable
# three-Action rehearsal, under its own request id. It binds the fixture head
# recorded by the latest succeeded run-3 reset receipt
# (reset-three-action-rehearsal-fixture-run3-2026-10-05), one commit on run 2's
# reset head, and requires a run-3 G6 receipt; every other property of the
# run-2 Grant is kept. After fresh
# fail-closed preconditions, a passing G6 receipt and a passing host replay of
# the hermetic three-Action rehearsal, it previews the exact scope at the
# current policy revision and activates only that previewed fingerprint. It
# never merges on GitHub, pushes a base branch, launches or terminates a
# Session, restarts a service, or turns production back on after Off.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="grant-production-three-action-rehearsal-run3-2026-10-05"
PREFLIGHT_ID="preflight-three-action-rehearsal-run3-2026-10-05"
RESET_ID="reset-three-action-rehearsal-fixture-run3-2026-10-05"
# Run 2's reset head: the run-3 reset commit's only parent.
RUN2_HEAD="0d3d2cedc5548da41896201688a1dc0210208ea4"
ARCADIA_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST="$FIXTURE_REPO/.arcadia-three-action-rehearsal.json"
PROJECT="three-action-rehearsal"
PLAN="autonomous-three-action-rehearsal"
ACTION_A="write-start-marker"
ACTION_B="transform-start-marker"
ACTION_C="verify-final-rehearsal"
ACTIONS_JSON='["write-start-marker","transform-start-marker","verify-final-rehearsal"]'
PROVIDER="claude-code-cli"
TRANSITIONS="validation,acceptance,pointer,packet_approval"
INTEGRATION_DECISION="0058"
DECISION_FILE="docs/decisions/0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"
GRANT_HOURS=12
PREFLIGHT_MAX_AGE_SECONDS=1800
REQUIRED_COMMITS="9a9db5e8bfe7b35d0b312fc2f763cc80c2db25f1 0b3686013f0a924c35d58dc7a09c979f1a994c7e"
RUNTIME_PATHS="src scripts apps package.json pnpm-lock.yaml tsconfig.json"

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
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$LOG") 2>&1

STAGE=launch_context
REASON=""
EXTRA=""
ACTIVATED=false
ACTIVATION_ATTEMPTED=false
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"activated":%s%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$ACTIVATED" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }

# After an activation attempt, the CLI's exit status is not proof of the
# outcome: activation can commit and the CLI still time out, fail or print
# unparsable output. Observe production status instead and return only this
# Grant to Off. Sets OFF_RESULT to one of: not_attempted, not_active, other_grant_active,
# returned_off, OFF_FAILED, UNKNOWN.
reconcile_activation() {
  local status
  [[ "$ACTIVATION_ATTEMPTED" == true ]] || { OFF_RESULT=not_attempted; return 0; }
  if ! status="$(arcadia production status --json)" || ! jq -e '.ok == true and .data.read.status == "ok"' <<<"$status" >/dev/null 2>&1; then
    OFF_RESULT=UNKNOWN; return 0
  fi
  printf '%s\n' "$status" > "$RUN_DIR/status-after-failure.json"
  if jq -e '.data.read.policy.desiredState == "inactive"' <<<"$status" >/dev/null; then OFF_RESULT=not_active; return 0; fi
  if ! jq -e --arg id "$SCRIPT_ID" '.data.read.policy.authority.requestId == $id' <<<"$status" >/dev/null; then OFF_RESULT=other_grant_active; return 0; fi
  ACTIVATED=true
  if arcadia production deactivate --request-id "$SCRIPT_ID-$RUN_ID-off" --reason 'G7 did not complete verification after an activation attempt; return this exact Grant to Off and preserve evidence.' --json > "$RUN_DIR/off.json" \
    && jq -e '.ok == true and .data.result.policy.desiredState == "inactive"' "$RUN_DIR/off.json" >/dev/null 2>&1; then
    OFF_RESULT=returned_off
  else
    OFF_RESULT=OFF_FAILED
  fi
}
finish_refused() {
  local code="$1" off
  trap - ERR TERM INT
  set +e
  OFF_RESULT=UNKNOWN
  reconcile_activation
  off="$OFF_RESULT"
  # The receipt reports what was observed: an unreadable status is not "not activated".
  case "$off" in
    returned_off | OFF_FAILED) ACTIVATED=true ;;
    UNKNOWN) ACTIVATED='"unknown"' ;;
    *) ACTIVATED=false ;;
  esac
  record_str offCleanup "$off"
  write_receipt refused
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT"
    echo "- observed Off cleanup: $off"
    echo
    case "$off" in
      not_attempted) echo "No activation was attempted: production policy was not changed by this run." ;;
      not_active) echo "An activation was attempted, and production status afterwards reads Inactive. This Grant is not active." ;;
      returned_off) echo "An activation by this Grant was observed Active after the failure; the script returned only this Grant to Off and the Off was confirmed." ;;
      other_grant_active) echo "Production is Active under ANOTHER request id, not this Grant; this script did not touch it. Read production status and run the run-3 G8 if that is not intended." ;;
      OFF_FAILED) echo "This Grant was observed Active and the Off was NOT confirmed. Run the run-3 G8 terminal-Off action (restore-terminal-off-three-action-rehearsal-run3-2026-10-05) NOW from the Terminal panel or /runs and read production status." ;;
      *) echo "Production status could not be read after the activation attempt: the policy may be ACTIVE. Run the run-3 G8 terminal-Off action (restore-terminal-off-three-action-rehearsal-run3-2026-10-05) NOW from the Terminal panel or /runs." ;;
    esac
    echo "Do not press this one-shot Grant again blindly. Resolve the named drift, rerun G6, and ask for a fresh G7 if the scope changed."
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
on_error() {
  local code=$? command="$BASH_COMMAND"
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  finish_refused "$code"
}
on_signal() {
  if (( BASH_SUBSHELL > 0 )); then exit 143; fi
  REASON="interrupted by a signal during stage $STAGE"
  finish_refused 143
}
trap on_error ERR
trap on_signal TERM INT

echo "== G7 (run 3): one-shot three-Action rehearsal Grant at the run-3 reset fixture head =="
# A one-shot Grant runs only through /runs, whose lifecycle disables it after success.
DESCRIPTOR_PATH="${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}"
[[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$SCRIPT_ID" && -n "$DESCRIPTOR_PATH" && -f "$DESCRIPTOR_PATH" ]] || refuse "launch this one-shot Grant through the /runs operator-action library"
[[ "$(cd "$(dirname "$DESCRIPTOR_PATH")" && pwd -P)/$(basename "$DESCRIPTOR_PATH")" == "$SCRIPT_DIR/$SCRIPT_ID.json" ]] || refuse "the launching descriptor is not this Grant's descriptor"
[[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only Grant: an agent sandbox may not run it"

STAGE=preconditions
for tool in git jq mise timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the configured default workspace is not martianrover"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean on main"
HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)"
[[ "$HEAD" == "$(git -C "$ARCADIA_REPO" rev-parse origin/main)" ]] || refuse "main is not level with its last-fetched origin/main"
REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main)" || refuse "origin main could not be observed within 30 seconds"
[[ "${REMOTE_LINE%%[[:space:]]*}" == "$HEAD" ]] || refuse "origin main has moved past local main; fetch, fast-forward and reinstall, then rerun G6"
for commit in $REQUIRED_COMMITS; do git -C "$ARCADIA_REPO" merge-base --is-ancestor "$commit" HEAD || refuse "main lacks required commit $commit"; done
grep -q '^status: approved$' "$ARCADIA_REPO/$DECISION_FILE" || refuse "Decision $INTEGRATION_DECISION is not approved in $DECISION_FILE"
BROKER="$(arcadia go-broker status --json)" || refuse "go-broker status is not ready"
jq -e '.ok == true and .data.ready == true and .data.preservationTransport.ready == true and .data.agentGoTransport.ready == true' <<<"$BROKER" >/dev/null || refuse "the installed broker or its host transports are not ready"
BROKER_REVISION="$(jq -r '.data.revision' <<<"$BROKER")"
git -C "$ARCADIA_REPO" merge-base --is-ancestor "$BROKER_REVISION" "$HEAD" || refuse "installed release $BROKER_REVISION is not on main"
git -C "$ARCADIA_REPO" diff --quiet "$BROKER_REVISION" "$HEAD" -- $RUNTIME_PATHS || refuse "installed release $BROKER_REVISION is stale against main $HEAD"
record_str arcadiaHead "$HEAD"
record_str installedRelease "$BROKER_REVISION"

STAGE=fixture
[[ -f "$MANIFEST" ]] || refuse "fixture manifest missing; run G1 and G6 first"
jq -e --arg p "$PROJECT" --arg plan "$PLAN" --argjson actions "$ACTIONS_JSON" --arg provider "$PROVIDER" \
  '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .fixtureProject == $p and .fixturePlan == $plan and .actions == $actions and .provider == $provider' "$MANIFEST" >/dev/null || refuse "fixture manifest does not name the exact three-Action scope"
REPO="$(jq -r '.githubRepository' "$MANIFEST")"
[[ "$(git -C "$FIXTURE_REPO" branch --show-current)" == main && -z "$(git -C "$FIXTURE_REPO" status --porcelain)" ]] || refuse "the fixture must be clean on main"
ROOT_COMMIT="$(git -C "$FIXTURE_REPO" rev-list --max-parents=0 HEAD)"
[[ "$ROOT_COMMIT" != *$'\n'* ]] || refuse "the fixture must have exactly one root commit"
ORIGIN="$(git -C "$FIXTURE_REPO" remote get-url origin)"
[[ "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ]] || refuse "fixture origin $ORIGIN is not $REPO"
# The run-3 fixture head: the one the latest succeeded run-3 reset receipt for
# this exact repository recorded, one reset commit on run 2's reset head, itself
# one commit on G1's genesis.
RESET_RECEIPT=""
for candidate in "$SCRIPT_DIR"/runs/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$RESET_ID" --arg repo "$REPO" '.id == $id and .outcome == "succeeded" and .githubRepository == $repo' "$candidate" >/dev/null 2>&1; then RESET_RECEIPT="$candidate"; fi
done
[[ -n "$RESET_RECEIPT" ]] || refuse "no succeeded $RESET_ID receipt exists for $REPO; run the reset and G6 first"
FIXTURE_HEAD="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
jq -e --arg head "$FIXTURE_HEAD" --arg root "$ROOT_COMMIT" --arg run2 "$RUN2_HEAD" --arg fixture "$FIXTURE_REPO" \
  '.newHead == $head and .previousMain == $run2 and .genesis == $root and .remoteMainAfter == .newHead and .fixtureRoot == $fixture' "$RESET_RECEIPT" >/dev/null \
  || refuse "fixture main $FIXTURE_HEAD is not the run-3 reset head on run 2's reset head $RUN2_HEAD and genesis $ROOT_COMMIT recorded in $RESET_RECEIPT; this Grant is only for the freshly reset fixture"
[[ "$(git -C "$FIXTURE_REPO" rev-parse HEAD^)" == "$RUN2_HEAD" && "$(git -C "$FIXTURE_REPO" rev-parse HEAD^^)" == "$ROOT_COMMIT" && "$(git -C "$FIXTURE_REPO" rev-list --count HEAD)" == 3 ]] || refuse "the fixture is not exactly one reset commit on run 2's reset head on its genesis"
record_str githubRepository "$REPO"
record_str rootCommit "$ROOT_COMMIT"
record_str fixtureHead "$FIXTURE_HEAD"
record_str resetReceipt "$RESET_RECEIPT"

STAGE=preflight_receipt
LATEST=""
for candidate in "$SCRIPT_DIR"/runs/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$PREFLIGHT_ID" '.id == $id' "$candidate" >/dev/null 2>&1; then LATEST="$candidate"; fi
done
[[ -n "$LATEST" ]] || refuse "no G6 preflight receipt exists; run $PREFLIGHT_ID first"
record_str preflightReceipt "$LATEST"
jq -e '.outcome == "succeeded"' "$LATEST" >/dev/null || refuse "the latest G6 preflight refused ($LATEST); fix its checks and rerun it"
AGE=$(( $(date -u +%s) - $(jq -r '.finishedAt | fromdateiso8601' "$LATEST") ))
(( AGE >= 0 && AGE <= PREFLIGHT_MAX_AGE_SECONDS )) || refuse "the latest G6 preflight is ${AGE}s old; rerun it (limit ${PREFLIGHT_MAX_AGE_SECONDS}s)"
jq -e --arg head "$HEAD" --arg broker "$BROKER_REVISION" --arg repo "$REPO" --arg root "$ROOT_COMMIT" --arg ws "$WORKSPACE" --arg fhead "$FIXTURE_HEAD" --arg reset "$RESET_RECEIPT" \
  '.arcadiaHead == $head and .brokerRevision == $broker and .githubRepository == $repo and .rootCommit == $root and .workspace == $ws and .fixtureHead == $fhead and .resetReceipt == $reset' "$LATEST" >/dev/null || refuse "the G6 receipt was taken against a different main, release, workspace, fixture or reset head"

STAGE=production_state
STATUS="$(arcadia production status --json)"
printf '%s\n' "$STATUS" > "$RUN_DIR/status-before.json"
jq -e '.ok == true and .data.read.status == "ok"' <<<"$STATUS" >/dev/null || refuse "production status is unreadable"
if jq -e --arg id "$SCRIPT_ID" '.data.read.policy.authority.requestId == $id' <<<"$STATUS" >/dev/null; then
  refuse "this exact Grant request id is already recorded in production policy; it is one-shot and is not reapplied"
fi
jq -e '.data.read.policy.desiredState == "inactive" and .data.liveAdmissions == 0' <<<"$STATUS" >/dev/null || refuse "production must be Inactive with zero live admissions"
REVISION="$(jq -r '.data.read.policy.revision' <<<"$STATUS")"
[[ "$REVISION" =~ ^[0-9]+$ ]] || refuse "production status gave no numeric policy revision"
jq -e --argjson r "$REVISION" '.policyRevision == $r' "$LATEST" >/dev/null || refuse "policy revision moved to $REVISION since the G6 preflight"
record policyRevisionBefore "$REVISION"

STAGE=host_rehearsal
# The hermetic three-Action rehearsal (all three variants, including the tick
# readying each PR and running both host reviews) must pass on this host before
# any preview. Its fixtures are isolated from this Grant's operator context.
mise exec -- node --input-type=module - "$ARCADIA_REPO" "$RUN_DIR/rehearsal-report.json" <<'PREFLIGHT'
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
if (process.env.CODEX_SANDBOX) {
  console.error("REFUSED: run this Grant through the host operator-action library.");
  process.exit(1);
}
const [repository, report] = process.argv.slice(2);
const {
  ARCADIA_OPERATOR_SCRIPT_ID: liveOperatorId,
  ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: liveOperatorDescriptor,
  ...rehearsalEnv
} = process.env;
const result = spawnSync("pnpm", ["exec", "vitest", "run", "--dir", "tests", "rehearsal-three-action.test.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`], {
  cwd: repository,
  env: { ...rehearsalEnv, ARCADIA_PRESERVATION_HOST_TEST: "1" },
  stdio: "inherit",
  timeout: 300_000
});
if (result.error) {
  console.error(`Rehearsal preflight failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
let parsed;
try {
  parsed = JSON.parse(readFileSync(report, "utf8"));
} catch {
  console.error("REFUSED: the hermetic rehearsal wrote no readable JSON report.");
  process.exit(1);
}
const assertions = (parsed.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
const tick = assertions.filter((entry) => String(entry.title).includes("the tick readying each PR"));
if (parsed.numFailedTests !== 0 || assertions.length < 3 || assertions.some((entry) => entry.status !== "passed") || tick.length !== 1) {
  console.error("REFUSED: the hermetic rehearsal did not pass every variant, including the tick-driven review variant.");
  process.exit(1);
}
console.log(`Hermetic three-Action rehearsal passed: ${assertions.length} variants, including the tick-driven review variant.`);
PREFLIGHT

STAGE=recheck_after_replay
# The replay can take minutes; nothing it relied on may have moved meanwhile.
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" && "$(git -C "$ARCADIA_REPO" rev-parse HEAD)" == "$HEAD" ]] || refuse "main moved or became dirty during the hermetic replay"
BROKER="$(arcadia go-broker status --json)" || refuse "go-broker status is not ready after the replay"
jq -e --arg r "$BROKER_REVISION" '.ok == true and .data.ready == true and .data.revision == $r and .data.preservationTransport.ready == true and .data.agentGoTransport.ready == true' <<<"$BROKER" >/dev/null || refuse "the installed release or host transports changed during the hermetic replay"
[[ -z "$(git -C "$FIXTURE_REPO" status --porcelain)" && "$(git -C "$FIXTURE_REPO" rev-parse HEAD)" == "$FIXTURE_HEAD" ]] || refuse "the fixture changed during the hermetic replay"
cat > "$RUN_DIR/probe-leases.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { listActiveAgentSessions } from "./src/sessions/index.ts";
const [workspace, project] = process.argv.slice(2);
const active = withReadOnlyDatabase(workspace, (db) => listActiveAgentSessions(db));
console.log(JSON.stringify({ active: active.length, fixtureActive: active.filter((s) => s.project_slug === project).map((s) => s.id) }));
NODE
LEASES="$(cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$WORKSPACE" "$PROJECT" < "$RUN_DIR/probe-leases.mjs")" || refuse "repository leases could not be observed"
jq -e '.fixtureActive == []' <<<"$LEASES" >/dev/null || refuse "a fixture Session is already prepared or running"
STATUS="$(arcadia production status --json)"
jq -e --argjson r "$REVISION" '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive" and .data.read.policy.revision == $r and .data.liveAdmissions == 0' <<<"$STATUS" >/dev/null || refuse "production state or revision changed during the hermetic replay"

STAGE=preview
EXPIRES="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 3600e3).toISOString())' "$GRANT_HOURS")"
ARGS=(--project "$PROJECT" --plan "$PROJECT/$PLAN"
  --action "$PROJECT/$ACTION_A" --action "$PROJECT/$ACTION_B" --action "$PROJECT/$ACTION_C"
  --provider "$PROVIDER" --concurrency 1
  --transitions "$TRANSITIONS" --packet-approval-expires-at "$EXPIRES"
  --remote-preservation
  --integration-grant-decision "$INTEGRATION_DECISION" --integration-grant-expires-at "$EXPIRES"
  --integration-grant-action "$PROJECT/$ACTION_A" --integration-grant-action "$PROJECT/$ACTION_B" --integration-grant-action "$PROJECT/$ACTION_C"
  --intent 'Bounded disposable three-Action rehearsal run 3 from the run-3 reset fixture head: three serial Actions preserved to draft PRs, readied and independently reviewed by the tick, then integrated by local fast-forward. Never a GitHub merge or base push.')
PREVIEW="$(arcadia production preview "${ARGS[@]}" --json)"
printf '%s\n' "$PREVIEW" > "$RUN_DIR/preview.json"
jq -e --argjson rev "$REVISION" --arg p "$PROJECT" --arg plan "$PROJECT/$PLAN" --arg a "$PROJECT/$ACTION_A" --arg b "$PROJECT/$ACTION_B" --arg c "$PROJECT/$ACTION_C" --arg provider "$PROVIDER" --arg e "$EXPIRES" '
  def same_instant($x; $y): ($x | sub("\\.[0-9]+Z$"; "Z")) == ($y | sub("\\.[0-9]+Z$"; "Z"));
  .ok == true and .data.preview.expectedRevision == $rev
  and .data.preview.scope.projects == [$p] and .data.preview.scope.plans == [$plan]
  and .data.preview.scope.actions == [$a, $b, $c]
  and .data.preview.scope.providers == [$provider] and .data.preview.scope.maxConcurrentSessions == 1
  and (.data.preview.scope.mechanicalTransitions | sort) == (["acceptance", "packet_approval", "pointer", "validation"])
  and .data.preview.scope.remotePreservation == true
  and .data.preview.scope.integrationGrant.decisionRef == "0058"
  and .data.preview.scope.integrationGrant.actions == [$a, $b, $c]
  and same_instant(.data.preview.scope.integrationGrant.expiresAt; $e)
  and same_instant(.data.preview.scope.packetApprovalExpiresAt; $e)
  and (.data.preview.scope.rehearsalException == null)
  and (.data.preview.unmatched.projects == []) and (.data.preview.unmatched.plans == [])
  and (.data.preview.scopeFingerprint | type == "string" and length > 0)' <<<"$PREVIEW" >/dev/null || refuse "preview differs from the exact three-Action, one-provider, concurrency-one, remote-preservation, Decision 0058 scope"
FINGERPRINT="$(jq -r '.data.preview.scopeFingerprint' <<<"$PREVIEW")"
record_str scopeFingerprint "$FINGERPRINT"
record_str expiresAt "$EXPIRES"

# `production activate` recomputes its scope from the queue and has no
# expected-fingerprint option, so preview again immediately before activating
# and require the identical fingerprint and revision; after activation the
# recorded fingerprint is verified and a mismatch returns this Grant to Off.
STAGE=preview_recheck
RECHECK="$(arcadia production preview "${ARGS[@]}" --json)"
printf '%s\n' "$RECHECK" > "$RUN_DIR/preview-recheck.json"
jq -e --arg f "$FINGERPRINT" --argjson rev "$REVISION" '.ok == true and .data.preview.scopeFingerprint == $f and .data.preview.expectedRevision == $rev' <<<"$RECHECK" >/dev/null || refuse "the scope fingerprint or policy revision changed between preview and activation"

STAGE=activate
ACTIVATION_ATTEMPTED=true
ACTIVATION="$(arcadia production activate "${ARGS[@]}" --expected-revision "$REVISION" --request-id "$SCRIPT_ID" --granted-by 'P. Mark Anderson' --json)" || refuse "the activate command failed or timed out; its outcome is read back from production status"
printf '%s\n' "$ACTIVATION" > "$RUN_DIR/activation.json"
if jq -e '.ok == true and .data.result.policy.desiredState == "active"' <<<"$ACTIVATION" >/dev/null 2>&1; then ACTIVATED=true; fi
[[ "$ACTIVATED" == true ]] || refuse "activation output did not confirm Active; its outcome is read back from production status"
jq -e --arg id "$SCRIPT_ID" --arg f "$FINGERPRINT" '.data.result.policy.authority.requestId == $id and .data.result.policy.authority.scopeFingerprint == $f' <<<"$ACTIVATION" >/dev/null || refuse "the active policy is not the previewed fingerprint"
record "policyRevisionAfter" "$(jq '.data.result.policy.revision' <<<"$ACTIVATION")"

STAGE=complete
REASON=""
record_str authorizes "Only the previewed scope: Project $PROJECT, Plan $PLAN, Actions $ACTION_A, $ACTION_B, $ACTION_C in order, at fixture head $FIXTURE_HEAD; provider $PROVIDER; concurrency 1; validation, acceptance, pointer and packet_approval until $EXPIRES; draft-PR remote preservation; and pushing the settled head, readying the host-created PR and running both independent reviews before local fast-forward integration until $EXPIRES (Decision 0058 covers those for this use: the operator answered #925 yes, recorded in Log operator-answers-rehearsal-run2-2026-10-05 (133e503dc, clarified by 49b1342a8) and the operator's chat confirmations of 2026-10-05; that answer created no Decision)."
record_str neverAuthorizes "GitHub merge, a base-branch push, another Project/Plan/Action/provider, concurrency above one, a Session launched by this script, or reactivation after Off."
record_str operatorAcknowledgement "Pressed with the always-visible statement in this Grant's title and effect that pressing accepts Decision 0058 for these three fixture Actions only (#925, answered yes in Log operator-answers-rehearsal-run2-2026-10-05 (133e503dc, clarified by 49b1342a8) and the operator's chat confirmations of 2026-10-05; that answer created no Decision): readying the PR, pushing the settled head and reviewer-model spend; the full acknowledgement is under 'What this action does'."
write_receipt succeeded
cat > "$RUN_DIR/receipt.md" <<EOF
# G7 three-Action rehearsal run 3 Grant receipt

- request id: $SCRIPT_ID
- fixture: $PROJECT/$PLAN on $REPO (run-3 reset head $FIXTURE_HEAD on run 2's reset head $RUN2_HEAD and genesis $ROOT_COMMIT)
- reset receipt: $RESET_RECEIPT
- Actions: $PROJECT/$ACTION_A -> $PROJECT/$ACTION_B -> $PROJECT/$ACTION_C
- provider $PROVIDER; concurrency 1; transitions $TRANSITIONS
- remote preservation: on (draft PRs); integration Grant: Decision $INTEGRATION_DECISION naming each Action
- packet-approval and integration expiry: $EXPIRES
- policy revision before: $REVISION; scope fingerprint: $FINGERPRINT (previewed twice, verified after activation)
- installed release: $BROKER_REVISION; main: $HEAD
- G6 receipt: $LATEST
- run log: $LOG

Within the scope above the policy permits draft preservation and, under
Decision 0058 for this use (the operator answered #925 yes, recorded in
Log operator-answers-rehearsal-run2-2026-10-05 (133e503dc, clarified by 49b1342a8) and the
operator's chat confirmations of 2026-10-05; that answer created no Decision), PR readiness plus
both independent reviews before local fast-forward integration; the tick runs
those only while the policy carries both remote preservation and this Decision
0058 grant. It never permits a GitHub merge or a base-branch push. The Grant's
always-visible title and effect state that pressing accepts Decision 0058 for
these three fixture Actions only (#925); the operator pressed it. Use the run-3
G8 (restore-terminal-off-three-action-rehearsal-run3-2026-10-05), from the
Terminal panel or /runs, for terminal Off.
EOF
echo "GRANTED: exact three-Action rehearsal run-3 scope only, until $EXPIRES. Do not press again. Receipt: $RUN_DIR/receipt.md"
