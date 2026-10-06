#!/usr/bin/env bash
# Rehearsal chain G7: one-shot Grant for one run of the N-Action serial chain,
# driven only by that run's reviewed parameter file, under its own request id
# (this run's library id). It keeps every property of the run-5 Grant: /runs
# launch only, fresh fail-closed preconditions (including the parameter file's
# required commits), a passing G6 receipt of this run no older than 30 minutes
# bound to the same main, release, workspace, fixture, reset head, reset
# receipt and policy revision, a passing host replay of the hermetic
# three-Action rehearsal, then a preview of the exact scope at the current
# policy revision, a second identical preview immediately before activation,
# one activation and a fingerprint check that returns only this Grant to Off on
# any mismatch. The scope names exactly the run's N fixture Actions, in order,
# for provider claude-code-cli at concurrency one, with remote preservation and
# a Decision 0058 integration grant naming each of them, both expiring in 12
# hours. It never merges on GitHub, pushes a base branch, launches or
# terminates a Session, restarts a service, or turns production back on after Off.
set -Eeuo pipefail

IMPL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LIBRARY_DIR="$(cd "$IMPL_DIR/.." && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
KIND_PREFIX="grant-production-rehearsal-chain"
IMPL_FILE="grant.sh"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST="$FIXTURE_REPO/.arcadia-three-action-rehearsal.json"
PROJECT="three-action-rehearsal"
PLAN="autonomous-three-action-rehearsal"
G1_ACTIONS_JSON='["write-start-marker","transform-start-marker","verify-final-rehearsal"]'
PROVIDER="claude-code-cli"
TRANSITIONS="validation,acceptance,pointer,packet_approval"
INTEGRATION_DECISION="0058"
DECISION_FILE="docs/decisions/0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"
GRANT_HOURS=12
PREFLIGHT_MAX_AGE_SECONDS=1800
RUNTIME_PATHS="src scripts apps package.json pnpm-lock.yaml tsconfig.json"
RUN_PARAM_PATTERN='^run[0-9]{1,3}-[0-9]{4}-[0-9]{2}-[0-9]{2}$'

# --- Launcher binding: only this run's published launcher and parameter file. ---
PARAMS_FILE="${1:-}"
MODE="${2:-run}"
case "$MODE" in run | --describe) ;; *) echo "usage: <launcher> [run|--describe]" >&2; exit 2 ;; esac
RUN_PARAM_ID="$(basename "$PARAMS_FILE" .json)"
if [[ ! "$RUN_PARAM_ID" =~ $RUN_PARAM_PATTERN || "$PARAMS_FILE" != "$IMPL_DIR/params/$RUN_PARAM_ID.json" || ! -f "$PARAMS_FILE" ]]; then
  echo "REFUSED: run this through its per-run library launcher ($KIND_PREFIX-<run-id>.sh), which passes rehearsal-chain/params/<run-id>.json" >&2; exit 2
fi
SCRIPT_ID="$KIND_PREFIX-$RUN_PARAM_ID"
canonical_launcher() {
  printf '%s\n' '#!/usr/bin/env bash' \
    "# Rehearsal chain $RUN_PARAM_ID: runs the shared $IMPL_FILE with this run's reviewed parameter file and nothing else." \
    'set -euo pipefail' \
    'library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"' \
    "exec \"\$library_dir/rehearsal-chain/$IMPL_FILE\" \"\$library_dir/rehearsal-chain/params/$RUN_PARAM_ID.json\" \"\${1:-run}\""
}
if [[ ! -f "$LIBRARY_DIR/$SCRIPT_ID.json" || "$(cat "$LIBRARY_DIR/$SCRIPT_ID.sh" 2>/dev/null)" != "$(canonical_launcher)" ]]; then
  echo "REFUSED: $SCRIPT_ID is not published in this library with its exact launcher and descriptor" >&2; exit 2
fi
if [[ "$MODE" == --describe ]]; then cat "$LIBRARY_DIR/$SCRIPT_ID.json"; exit 0; fi
PREFLIGHT_ID="preflight-rehearsal-chain-$RUN_PARAM_ID"
RESET_ID="reset-rehearsal-chain-fixture-$RUN_PARAM_ID"
G8_ID="restore-terminal-off-rehearsal-chain-$RUN_PARAM_ID"

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
probe() { (cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$@"); }

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
      other_grant_active) echo "Production is Active under ANOTHER request id, not this Grant; this script did not touch it. Read production status and run this run's G8 if that is not intended." ;;
      OFF_FAILED) echo "This Grant was observed Active and the Off was NOT confirmed. Run this run's G8 terminal-Off action ($G8_ID) NOW from the Terminal panel or /runs and read production status." ;;
      *) echo "Production status could not be read after the activation attempt: the policy may be ACTIVE. Run this run's G8 terminal-Off action ($G8_ID) NOW from the Terminal panel or /runs." ;;
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

echo "== G7 (rehearsal chain $RUN_PARAM_ID): one-shot N-Action chain Grant at the chain reset fixture head =="
# A one-shot Grant runs only through /runs, whose lifecycle disables it after success.
DESCRIPTOR_PATH="${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}"
[[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$SCRIPT_ID" && -n "$DESCRIPTOR_PATH" && -f "$DESCRIPTOR_PATH" ]] || refuse "launch this one-shot Grant through the /runs operator-action library"
[[ "$(cd "$(dirname "$DESCRIPTOR_PATH")" && pwd -P)/$(basename "$DESCRIPTOR_PATH")" == "$LIBRARY_DIR/$SCRIPT_ID.json" ]] || refuse "the launching descriptor is not this Grant's descriptor"
[[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only Grant: an agent sandbox may not run it"

STAGE=parameters
for tool in git jq mise timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
# Reviewed, not merely rendered: this run's parameter file, launcher, descriptor and the shared
# implementation must all be tracked and unmodified at the checkout's HEAD (artifacts/generated is gitignored).
for reviewed in "$PARAMS_FILE" "$LIBRARY_DIR/$SCRIPT_ID.sh" "$LIBRARY_DIR/$SCRIPT_ID.json" "$IMPL_DIR/$IMPL_FILE"; do
  git -C "$ARCADIA_REPO" ls-files --error-unmatch -- "$reviewed" >/dev/null 2>&1 && git -C "$ARCADIA_REPO" diff --quiet HEAD -- "$reviewed" \
    || refuse "$reviewed is not tracked and unmodified at the checkout's HEAD; a run's parameter file, launcher, descriptor and implementation must be reviewed and committed before they run"
done
cat > "$RUN_DIR/params.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { validateChainParams, chainActionIds } from "./src/operatorActions/rehearsalChain.ts";
const [file] = process.argv.slice(2);
let raw;
try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (error) { console.log(JSON.stringify({ problems: [`unreadable parameter file: ${error.message}`], unfilled: [] })); process.exit(0); }
const { params, problems, unfilled } = validateChainParams(raw);
if (!params) { console.log(JSON.stringify({ problems, unfilled })); process.exit(0); }
console.log(JSON.stringify({ problems, unfilled, params, actionIds: chainActionIds(params.actionCount) }));
NODE
PARAMS="$(probe "$PARAMS_FILE" < "$RUN_DIR/params.mjs")" || refuse "the parameter file could not be validated"
printf '%s\n' "$PARAMS" > "$RUN_DIR/params-validation.json"
jq -e '.problems == []' <<<"$PARAMS" >/dev/null || refuse "the parameter file $PARAMS_FILE is invalid: $(jq -c '.problems' <<<"$PARAMS")"
jq -e --arg run "$RUN_PARAM_ID" '.params.runId == $run' <<<"$PARAMS" >/dev/null || refuse "the parameter file's runId does not match its file name $RUN_PARAM_ID"
jq -e '.unfilled == []' <<<"$PARAMS" >/dev/null || refuse "the parameter file still has UNFILLED values: $(jq -c '.unfilled' <<<"$PARAMS")"
ACTION_IDS_JSON="$(jq -c '.actionIds' <<<"$PARAMS")"
SCOPED_ACTIONS_JSON="$(jq -c --arg p "$PROJECT" '[.actionIds[] | "\($p)/\(.)"]' <<<"$PARAMS")"
N="$(jq -r '.params.actionCount' <<<"$PARAMS")"
RUN_LABEL="$(jq -r '.params.runLabel' <<<"$PARAMS")"
RESET_HEAD="$(jq -r '.params.previousRun.bindings.resetHead' <<<"$PARAMS")"
REQUIRED_COMMITS="$(jq -r '[.params.requiredCommits[].commit] | join(" ")' <<<"$PARAMS")"
record_str chainRunId "$RUN_PARAM_ID"
record actionIds "$ACTION_IDS_JSON"

STAGE=preconditions
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
jq -e --arg p "$PROJECT" --arg plan "$PLAN" --argjson actions "$G1_ACTIONS_JSON" --arg provider "$PROVIDER" \
  '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .fixtureProject == $p and .fixturePlan == $plan and .actions == $actions and .provider == $provider' "$MANIFEST" >/dev/null || refuse "fixture manifest does not name G1's exact scope"
REPO="$(jq -r '.githubRepository' "$MANIFEST")"
[[ "$(git -C "$FIXTURE_REPO" branch --show-current)" == main && -z "$(git -C "$FIXTURE_REPO" status --porcelain)" ]] || refuse "the fixture must be clean on main"
ROOT_COMMIT="$(git -C "$FIXTURE_REPO" rev-list --max-parents=0 HEAD)"
[[ "$ROOT_COMMIT" != *$'\n'* ]] || refuse "the fixture must have exactly one root commit"
ORIGIN="$(git -C "$FIXTURE_REPO" remote get-url origin)"
[[ "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ]] || refuse "fixture origin $ORIGIN is not $REPO"
RESET_RECEIPT=""
for candidate in "$LIBRARY_DIR"/runs/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$RESET_ID" --arg repo "$REPO" '.id == $id and .outcome == "succeeded" and .githubRepository == $repo' "$candidate" >/dev/null 2>&1; then RESET_RECEIPT="$candidate"; fi
done
[[ -n "$RESET_RECEIPT" ]] || refuse "no succeeded $RESET_ID receipt exists for $REPO; run the reset and G6 first"
FIXTURE_HEAD="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
jq -e --arg head "$FIXTURE_HEAD" --arg root "$ROOT_COMMIT" --arg base "$RESET_HEAD" --arg fixture "$FIXTURE_REPO" --arg run "$RUN_PARAM_ID" --argjson ids "$ACTION_IDS_JSON" \
  '.newHead == $head and .previousMain == $base and .genesis == $root and .remoteMainAfter == .newHead and .fixtureRoot == $fixture and .chainRunId == $run and .actionIds == $ids' "$RESET_RECEIPT" >/dev/null \
  || refuse "fixture main $FIXTURE_HEAD is not the chain reset head on $RESET_HEAD and genesis $ROOT_COMMIT recorded, with exactly this run's Actions, in $RESET_RECEIPT; this Grant is only for the freshly reset fixture"
[[ "$(git -C "$FIXTURE_REPO" rev-parse HEAD^)" == "$RESET_HEAD" ]] && git -C "$FIXTURE_REPO" merge-base --is-ancestor "$ROOT_COMMIT" "$RESET_HEAD" || refuse "the fixture is not exactly one reset commit on $RESET_HEAD on its genesis"
record_str githubRepository "$REPO"
record_str rootCommit "$ROOT_COMMIT"
record_str fixtureHead "$FIXTURE_HEAD"
record_str resetReceipt "$RESET_RECEIPT"

STAGE=preflight_receipt
LATEST=""
for candidate in "$LIBRARY_DIR"/runs/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$PREFLIGHT_ID" '.id == $id' "$candidate" >/dev/null 2>&1; then LATEST="$candidate"; fi
done
[[ -n "$LATEST" ]] || refuse "no G6 preflight receipt exists; run $PREFLIGHT_ID first"
record_str preflightReceipt "$LATEST"
jq -e '.outcome == "succeeded"' "$LATEST" >/dev/null || refuse "the latest G6 preflight refused ($LATEST); fix its checks and rerun it"
AGE=$(( $(date -u +%s) - $(jq -r '.finishedAt | fromdateiso8601' "$LATEST") ))
(( AGE >= 0 && AGE <= PREFLIGHT_MAX_AGE_SECONDS )) || refuse "the latest G6 preflight is ${AGE}s old; rerun it (limit ${PREFLIGHT_MAX_AGE_SECONDS}s)"
jq -e --arg head "$HEAD" --arg broker "$BROKER_REVISION" --arg repo "$REPO" --arg root "$ROOT_COMMIT" --arg ws "$WORKSPACE" --arg fhead "$FIXTURE_HEAD" --arg reset "$RESET_RECEIPT" --arg run "$RUN_PARAM_ID" --argjson ids "$ACTION_IDS_JSON" \
  '.arcadiaHead == $head and .brokerRevision == $broker and .githubRepository == $repo and .rootCommit == $root and .workspace == $ws and .fixtureHead == $fhead and .resetReceipt == $reset and .chainRunId == $run and .actionIds == $ids' "$LATEST" >/dev/null \
  || refuse "the G6 receipt was taken against a different main, release, workspace, fixture, reset head or Action set"

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
LEASES="$(probe "$WORKSPACE" "$PROJECT" < "$RUN_DIR/probe-leases.mjs")" || refuse "repository leases could not be observed"
jq -e '.fixtureActive == []' <<<"$LEASES" >/dev/null || refuse "a fixture Session is already prepared or running"
STATUS="$(arcadia production status --json)"
jq -e --argjson r "$REVISION" '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive" and .data.read.policy.revision == $r and .data.liveAdmissions == 0' <<<"$STATUS" >/dev/null || refuse "production state or revision changed during the hermetic replay"

STAGE=preview
EXPIRES="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 3600e3).toISOString())' "$GRANT_HOURS")"
ARGS=(--project "$PROJECT" --plan "$PROJECT/$PLAN")
while IFS= read -r scoped; do ARGS+=(--action "$scoped"); done < <(jq -r '.[]' <<<"$SCOPED_ACTIONS_JSON")
ARGS+=(--provider "$PROVIDER" --concurrency 1
  --transitions "$TRANSITIONS" --packet-approval-expires-at "$EXPIRES"
  --remote-preservation
  --integration-grant-decision "$INTEGRATION_DECISION" --integration-grant-expires-at "$EXPIRES")
while IFS= read -r scoped; do ARGS+=(--integration-grant-action "$scoped"); done < <(jq -r '.[]' <<<"$SCOPED_ACTIONS_JSON")
ARGS+=(--intent "Bounded disposable $N-Action serial rehearsal chain ($RUN_LABEL, $RUN_PARAM_ID) from the chain reset fixture head: $N serial Actions preserved to draft PRs, readied and independently reviewed by the tick, then integrated by local fast-forward. Never a GitHub merge or base push.")
(( ${#ARGS[@]} == 4 + 2 * N + 13 + 2 * N + 2 )) || refuse "the Grant arguments do not name exactly the $N chain Actions"
PREVIEW="$(arcadia production preview "${ARGS[@]}" --json)"
printf '%s\n' "$PREVIEW" > "$RUN_DIR/preview.json"
jq -e --argjson rev "$REVISION" --arg p "$PROJECT" --arg plan "$PROJECT/$PLAN" --argjson actions "$SCOPED_ACTIONS_JSON" --arg provider "$PROVIDER" --arg e "$EXPIRES" '
  def same_instant($x; $y): ($x | sub("\\.[0-9]+Z$"; "Z")) == ($y | sub("\\.[0-9]+Z$"; "Z"));
  # Arcadia may return the scope'"'"'s Actions in its own (queue) order: compare them as a set with no duplicates.
  def same_set($x; $y): ($x | type == "array") and ($x | length) == ($y | length) and ($x | unique | length) == ($x | length) and ($x | sort) == ($y | sort);
  .ok == true and .data.preview.expectedRevision == $rev
  and .data.preview.scope.projects == [$p] and .data.preview.scope.plans == [$plan]
  and same_set(.data.preview.scope.actions; $actions)
  and .data.preview.scope.providers == [$provider] and .data.preview.scope.maxConcurrentSessions == 1
  and (.data.preview.scope.mechanicalTransitions | sort) == (["acceptance", "packet_approval", "pointer", "validation"])
  and .data.preview.scope.remotePreservation == true
  and .data.preview.scope.integrationGrant.decisionRef == "0058"
  and same_set(.data.preview.scope.integrationGrant.actions; $actions)
  and same_instant(.data.preview.scope.integrationGrant.expiresAt; $e)
  and same_instant(.data.preview.scope.packetApprovalExpiresAt; $e)
  and (.data.preview.scope.rehearsalException == null)
  and (.data.preview.unmatched.projects == []) and (.data.preview.unmatched.plans == [])
  and (.data.preview.scopeFingerprint | type == "string" and length > 0)' <<<"$PREVIEW" >/dev/null || refuse "preview differs from the exact $N-Action, one-provider, concurrency-one, remote-preservation, Decision 0058 scope"
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
ACTION_LIST="$(jq -r 'join(", ")' <<<"$ACTION_IDS_JSON")"
record_str authorizes "Only the previewed scope: Project $PROJECT, Plan $PLAN, the $N Actions $ACTION_LIST in that order, at fixture head $FIXTURE_HEAD; provider $PROVIDER; concurrency 1; validation, acceptance, pointer and packet_approval until $EXPIRES; draft-PR remote preservation; and, for each of those $N Actions, pushing the settled head, readying the host-created PR and running both independent reviews (reviewer-model spend) before local fast-forward integration, until $EXPIRES (Decision 0058 delegates integration for the Actions a grant names; the operator's #925 answer covers PR readiness, the settled-head push and reviewer spend during a managed rehearsal)."
record_str neverAuthorizes "GitHub merge, a base-branch push, another Project/Plan/Action/provider, concurrency above one, a Session launched by this script, or reactivation after Off."
record_str operatorAcknowledgement "Pressed with the always-visible statement in this Grant's title and problem that one press accepts Decision 0058 for exactly these $N fixture Actions ($ACTION_LIST) until the 12-hour expiry: readying each PR, pushing each settled head and reviewer-model spend for both reviews of each, then local fast-forward integration and admission of the next, with no further operator step."
write_receipt succeeded
cat > "$RUN_DIR/receipt.md" <<EOF
# G7 rehearsal chain $RUN_LABEL ($RUN_PARAM_ID) Grant receipt

- request id: $SCRIPT_ID
- fixture: $PROJECT/$PLAN on $REPO (chain reset head $FIXTURE_HEAD on $RESET_HEAD and genesis $ROOT_COMMIT)
- reset receipt: $RESET_RECEIPT
- Actions ($N, serial): $(jq -r --arg p "$PROJECT" '[.[] | "\($p)/\(.)"] | join(" -> ")' <<<"$ACTION_IDS_JSON")
- provider $PROVIDER; concurrency 1; transitions $TRANSITIONS
- remote preservation: on (draft PRs); integration Grant: Decision $INTEGRATION_DECISION naming each of the $N Actions
- packet-approval and integration expiry: $EXPIRES
- policy revision before: $REVISION; scope fingerprint: $FINGERPRINT (previewed twice, verified after activation)
- installed release: $BROKER_REVISION; main: $HEAD
- G6 receipt: $LATEST
- run log: $LOG

Within the scope above the policy permits draft preservation and, under
Decision 0058 for this use (the operator answered #925 yes, recorded in Log
operator-answers-rehearsal-run2-2026-10-05), PR readiness plus both independent
reviews before local fast-forward integration, for each of the $N Actions in
turn; the tick runs those only while the policy carries both remote
preservation and this Decision 0058 grant. It never permits a GitHub merge or a
base-branch push. Use this run's G8 ($G8_ID), from the Terminal panel or /runs,
for terminal Off.
EOF
echo "GRANTED: exact $N-Action rehearsal chain scope for $RUN_LABEL only, until $EXPIRES. Do not press again. Receipt: $RUN_DIR/receipt.md"
