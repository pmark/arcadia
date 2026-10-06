#!/usr/bin/env bash
# Rehearsal chain G6: the bounded, read-only preflight for one run's G7 Grant,
# driven only by that run's reviewed parameter file. It keeps every check of the
# run-5 preflight and binds the fixture head the run's succeeded chain reset
# recorded (one reset commit on the previous run's reset head, carrying exactly
# the run's N Actions and completion ids), the Arcadia main head, the installed
# broker revision and the parameter file's required commits (all must be
# filled and on main). It observes, read-only, that no pending proposal or open
# Decision gates any chain Action, that the operational queue is valid (orderValid,
# nothing unpositioned), the worker-context Claude Code sign-in
# verdict (never the token), Codex reviewer readiness and a live-read capacity, and GitHub
# readiness for exactly the fixture repository. Every unknown, stale, paid,
# unfilled or unavailable observation refuses. It never previews or activates
# production, writes a token, restarts anything, or calls a model.
set -Eeuo pipefail

IMPL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LIBRARY_DIR="$(cd "$IMPL_DIR/.." && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
KIND_PREFIX="preflight-rehearsal-chain"
IMPL_FILE="preflight.sh"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST="$FIXTURE_REPO/.arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
G1_ACTIONS_JSON='["write-start-marker","transform-start-marker","verify-final-rehearsal"]'
PROVIDER="claude-code-cli"
# A broker release counts as current only when no runtime code differs from main.
RUNTIME_PATHS="src scripts apps package.json pnpm-lock.yaml tsconfig.json"
CHECK_WAIT_SECONDS=300
REPO_PATTERN='^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?/arcadia-three-action-rehearsal(-[a-z0-9]{1,24})?$'
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
RESET_ID="reset-rehearsal-chain-fixture-$RUN_PARAM_ID"
GRANT_ID="grant-production-rehearsal-chain-$RUN_PARAM_ID"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$LIBRARY_DIR/runs/$RUN_ID"
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$LOG") 2>&1

STAGE=tools
REASON=""
EXTRA=""
CHECKS=""
REFUSALS=0
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"productionPreviewedOrActivated":false,"checks":[%s]%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$CHECKS" "$EXTRA" > "$RECEIPT"
}
write_handoff() {
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT (every check and its verdict)"
    echo
    echo "This preflight only observed. Production was not previewed or activated, no token was read into the log,"
    echo "and nothing was restarted. Do not press the G7 Grant ($GRANT_ID): it requires a fresh passing receipt from this preflight."
    echo "Fix each refused check named in the receipt through its own reviewed path, then rerun this preflight."
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
on_error() {
  local code=$? command="$BASH_COMMAND"
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  trap - ERR
  set +e
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  write_receipt refused
  write_handoff
  exit "$code"
}
trap on_error ERR

# One verdict per observation; a refusal never stops later observations, so a
# single run names every blocker.
check() {
  CHECKS="${CHECKS:+$CHECKS,}{\"name\":$(json_string "$1"),\"status\":$(json_string "$2"),\"detail\":$(json_string "$3")}"
  [[ "$2" == pass ]] || REFUSALS=$((REFUSALS + 1))
  echo "[$2] $1: $3"
}
arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }
probe() { (cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$@"); }
ghx() { timeout 60 gh "$@"; }

echo "== G6 (rehearsal chain $RUN_PARAM_ID): preflight at the chain reset head (observation only) =="
for tool in git jq mise gh timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done

# --- The reviewed parameter file: valid, and every value filled. ---
STAGE=parameters
# Reviewed, not merely rendered: this run's parameter file, launcher, descriptor and the shared
# implementation must all be tracked and unmodified at the checkout's HEAD (artifacts/generated is gitignored).
for reviewed in "$PARAMS_FILE" "$LIBRARY_DIR/$SCRIPT_ID.sh" "$LIBRARY_DIR/$SCRIPT_ID.json" "$IMPL_DIR/$IMPL_FILE"; do
  git -C "$ARCADIA_REPO" ls-files --error-unmatch -- "$reviewed" >/dev/null 2>&1 && git -C "$ARCADIA_REPO" diff --quiet HEAD -- "$reviewed" \
    || refuse "$reviewed is not tracked and unmodified at the checkout's HEAD; a run's parameter file, launcher, descriptor and implementation must be reviewed and committed before they run"
done
cat > "$RUN_DIR/params.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { validateChainParams, chainActionIds, completionRequestId } from "./src/operatorActions/rehearsalChain.ts";
const [file] = process.argv.slice(2);
let raw;
try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (error) { console.log(JSON.stringify({ problems: [`unreadable parameter file: ${error.message}`], unfilled: [] })); process.exit(0); }
const { params, problems, unfilled } = validateChainParams(raw);
if (!params) { console.log(JSON.stringify({ problems, unfilled })); process.exit(0); }
const actionIds = chainActionIds(params.actionCount);
console.log(JSON.stringify({ problems, unfilled, params, actionIds, completionIds: actionIds.map((id) => completionRequestId(id, params.runId)) }));
NODE
PARAMS="$(probe "$PARAMS_FILE" < "$RUN_DIR/params.mjs")" || refuse "the parameter file could not be validated"
printf '%s\n' "$PARAMS" > "$RUN_DIR/params-validation.json"
jq -e '.problems == []' <<<"$PARAMS" >/dev/null || refuse "the parameter file $PARAMS_FILE is invalid: $(jq -c '.problems' <<<"$PARAMS")"
jq -e --arg run "$RUN_PARAM_ID" '.params.runId == $run' <<<"$PARAMS" >/dev/null || refuse "the parameter file's runId does not match its file name $RUN_PARAM_ID"
jq -e '.unfilled == []' <<<"$PARAMS" >/dev/null || refuse "the parameter file still has UNFILLED values: $(jq -c '.unfilled' <<<"$PARAMS"); fill them through a reviewed change (merge it, reinstall if needed) and rerun the reset and this preflight"
ACTION_IDS_JSON="$(jq -c '.actionIds' <<<"$PARAMS")"
COMPLETION_IDS_JSON="$(jq -c '.completionIds' <<<"$PARAMS")"
RESET_HEAD="$(jq -r '.params.previousRun.bindings.resetHead' <<<"$PARAMS")"
REQUIRED_COMMITS="$(jq -r '[.params.requiredCommits[].commit] | join(" ")' <<<"$PARAMS")"
N="$(jq -r '.params.actionCount' <<<"$PARAMS")"
record_str chainRunId "$RUN_PARAM_ID"
record actionIds "$ACTION_IDS_JSON"
record requiredCommits "$(jq -c '.params.requiredCommits' <<<"$PARAMS")"

STAGE=observe
HEAD=""
if [[ "$(git -C "$ARCADIA_REPO" branch --show-current 2>/dev/null)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain 2>/dev/null)" ]] \
  && HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)" && [[ "$HEAD" == "$(git -C "$ARCADIA_REPO" rev-parse origin/main 2>/dev/null)" ]]; then
  check arcadia_checkout pass "clean main at $HEAD, level with last-fetched origin/main"
else
  HEAD=""
  check arcadia_checkout refuse "the Arcadia checkout must be clean on main and level with its last-fetched origin/main"
fi
# A fresh, bounded remote observation: last-fetched origin/main can be stale.
REMOTE_HEAD=""
if [[ -n "$HEAD" ]] && REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main 2>/dev/null)" && REMOTE_HEAD="${REMOTE_LINE%%[[:space:]]*}" && [[ "$REMOTE_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
  if [[ "$REMOTE_HEAD" == "$HEAD" ]]; then
    check remote_main pass "origin main observed now at $REMOTE_HEAD, equal to local main"
  else
    check remote_main refuse "origin main is $REMOTE_HEAD now but local main is $HEAD; fetch and fast-forward main, reinstall, then rerun"
  fi
else
  check remote_main refuse "origin main could not be observed within 30 seconds (unknown is not current)"
fi
record_str remoteHead "$REMOTE_HEAD"
MISSING=""
for commit in $REQUIRED_COMMITS; do git -C "$ARCADIA_REPO" merge-base --is-ancestor "$commit" HEAD 2>/dev/null || MISSING="$MISSING $commit"; done
if [[ -n "$HEAD" && -z "$MISSING" ]]; then check installed_features pass "every required commit of the parameter file is on main: $(jq -r '[.params.requiredCommits[].why] | join("; ")' <<<"$PARAMS")"; else check installed_features refuse "main lacks required commits:${MISSING:- (main not observed)}"; fi

WORKSPACE=""
if RESOLVED="$(arcadia workspace resolve --json 2>/dev/null)" && WORKSPACE="$(jq -er '.data | select(.source == "user config") | .workspacePath' <<<"$RESOLVED")" && [[ "${WORKSPACE##*/}" == martianrover ]]; then
  check workspace pass "$WORKSPACE"
else
  WORKSPACE=""
  if [[ -n "${ARCADIA_WORKSPACE+x}" ]]; then
    check workspace refuse "ARCADIA_WORKSPACE is set in this shell, so the workspace does not resolve from user config; run 'unset ARCADIA_WORKSPACE' and rerun (set it only inline on the recover-arcadia-host-services command)"
  else
    check workspace refuse "the configured default workspace did not resolve from user config to martianrover"
  fi
fi
record_str workspace "$WORKSPACE"

POLICY_REVISION=null
POLICY_EPOCH=null
if STATUS="$(arcadia production status --json 2>/dev/null)"; then
  printf '%s\n' "$STATUS" > "$RUN_DIR/production-status.json"
  if jq -e '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive" and .data.liveAdmissions == 0' <<<"$STATUS" >/dev/null; then
    POLICY_REVISION="$(jq '.data.read.policy.revision' <<<"$STATUS")"
    POLICY_EPOCH="$(jq '.data.read.policy.epoch' <<<"$STATUS")"
    check production_status pass "Inactive at revision $POLICY_REVISION, epoch $POLICY_EPOCH, zero live admissions"
  else
    check production_status refuse "production must be readable, Inactive and have zero live admissions: $(jq -c '{read: .data.read.status, state: .data.read.policy.desiredState, live: .data.liveAdmissions}' <<<"$STATUS" 2>/dev/null)"
  fi
else
  check production_status refuse "production status could not be read"
fi
record policyRevision "$POLICY_REVISION"
record policyEpoch "$POLICY_EPOCH"

BROKER_REVISION=""
if BROKER="$(arcadia go-broker status --json 2>/dev/null)" && jq -e '.ok == true and .data.ready == true' <<<"$BROKER" >/dev/null; then
  BROKER_REVISION="$(jq -r '.data.revision' <<<"$BROKER")"
  if [[ -n "$HEAD" ]] && git -C "$ARCADIA_REPO" merge-base --is-ancestor "$BROKER_REVISION" "$HEAD" 2>/dev/null \
    && git -C "$ARCADIA_REPO" diff --quiet "$BROKER_REVISION" "$HEAD" -- $RUNTIME_PATHS 2>/dev/null; then
    check installed_release pass "broker release $BROKER_REVISION is ready and runtime-identical to main"
  else
    check installed_release refuse "installed broker release $BROKER_REVISION is stale against main ${HEAD:-unobserved}; run reinstall-go-broker or recover-arcadia-host-services"
  fi
  if jq -e '.data.preservationTransport.ready == true and .data.agentGoTransport.ready == true' <<<"$BROKER" >/dev/null; then
    check host_transports pass "preservation and go transports are fresh"
  else
    check host_transports refuse "preservation or go transport is not fresh; the worker is not servicing host requests"
  fi
else
  check installed_release refuse "go-broker status is not ready or unavailable"
  check host_transports refuse "not observed: go-broker status unavailable"
fi
record_str brokerRevision "$BROKER_REVISION"
record_str arcadiaHead "$HEAD"

if WORKER="$(arcadia worker status 2>/dev/null)" && [[ "$WORKER" == "Worker: running"* ]]; then
  check worker pass "$WORKER"
else
  check worker refuse "the managed worker is not running with a fresh heartbeat: ${WORKER:-unavailable}"
fi

REPO=""
ROOT_COMMIT=""
FIXTURE_HEAD=""
RESET_RECEIPT=""
if [[ -f "$MANIFEST" ]] && jq -e --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --argjson actions "$G1_ACTIONS_JSON" --arg provider "$PROVIDER" \
    '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .fixtureProject == $p and .fixturePlan == $plan and .actions == $actions and .provider == $provider' "$MANIFEST" >/dev/null; then
  REPO="$(jq -r '.githubRepository' "$MANIFEST")"
  [[ "$REPO" =~ $REPO_PATTERN ]] || REPO=""
  ROOT_COMMIT="$(git -C "$FIXTURE_REPO" rev-list --max-parents=0 HEAD 2>/dev/null || true)"
  ORIGIN="$(git -C "$FIXTURE_REPO" remote get-url origin 2>/dev/null || true)"
  # The chain fixture head is the one the latest succeeded chain reset receipt of this run, for this
  # exact repository, recorded: one reset commit on the previous run's reset head the parameter file binds.
  if [[ -n "$REPO" ]]; then
    for candidate in "$LIBRARY_DIR"/runs/*/receipt.json; do
      [[ -f "$candidate" ]] || continue
      if jq -e --arg id "$RESET_ID" --arg repo "$REPO" '.id == $id and .outcome == "succeeded" and .githubRepository == $repo' "$candidate" >/dev/null 2>&1; then RESET_RECEIPT="$candidate"; fi
    done
  fi
  LOCAL_HEAD="$(git -C "$FIXTURE_REPO" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$RESET_RECEIPT" ]]; then
    check reset_receipt refuse "no succeeded $RESET_ID receipt exists for ${REPO:-the manifest repository}; run the reset first"
  elif jq -e --arg head "$LOCAL_HEAD" --arg root "$ROOT_COMMIT" --arg base "$RESET_HEAD" --arg fixture "$FIXTURE_REPO" --arg run "$RUN_PARAM_ID" --argjson ids "$ACTION_IDS_JSON" --argjson completions "$COMPLETION_IDS_JSON" \
      '(.newHead | test("^[0-9a-f]{40}$")) and .newHead == $head and .previousMain == $base and .genesis == $root and .remoteMainAfter == .newHead and .fixtureRoot == $fixture
       and .chainRunId == $run and .actionIds == $ids and .completionIds == $completions' "$RESET_RECEIPT" >/dev/null 2>&1 \
      && [[ "$(git -C "$FIXTURE_REPO" rev-parse HEAD^ 2>/dev/null)" == "$RESET_HEAD" ]] && git -C "$FIXTURE_REPO" merge-base --is-ancestor "$ROOT_COMMIT" "$RESET_HEAD" 2>/dev/null; then
    FIXTURE_HEAD="$LOCAL_HEAD"
    check reset_receipt pass "fixture main $FIXTURE_HEAD is the chain reset head recorded in $RESET_RECEIPT, one commit on the previous run's reset head $RESET_HEAD on genesis $ROOT_COMMIT, carrying the $N Actions $(jq -r 'join(", ")' <<<"$ACTION_IDS_JSON")"
  else
    check reset_receipt refuse "the latest chain reset receipt $RESET_RECEIPT does not match the fixture: its newHead must be local fixture main ($LOCAL_HEAD), its previousMain the bound reset head $RESET_HEAD (the only parent), its genesis the single root ($ROOT_COMMIT) and its Actions and completion ids exactly this run's; a stale receipt or a fixture that moved on refuses"
  fi
  if [[ "$(git -C "$FIXTURE_REPO" branch --show-current 2>/dev/null)" == main && -z "$(git -C "$FIXTURE_REPO" status --porcelain 2>/dev/null)" \
      && -n "$ROOT_COMMIT" && "$ROOT_COMMIT" != *$'\n'* && -n "$FIXTURE_HEAD" \
      && ( "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ) \
      && -s "$FIXTURE_REPO/.git/arcadia-three-action-first-packet-approval" ]]; then
    check fixture pass "$REPO at chain reset head $FIXTURE_HEAD on $RESET_HEAD and genesis $ROOT_COMMIT, clean, first packet seeded"
  else
    check fixture refuse "the local fixture must be clean on main at the chain reset head on $RESET_HEAD and its single genesis commit, with origin $REPO and a seeded first packet"
  fi
else
  check fixture refuse "fixture manifest $MANIFEST is missing or names a different scope; run G1 first"
fi
if [[ -f "$MANIFEST" && -z "$REPO" ]]; then
  check fixture_repository_identifier refuse "the manifest's GitHub repository does not match the disposable-fixture pattern; no GitHub read was made for it"
fi
record_str githubRepository "$REPO"
record_str rootCommit "$ROOT_COMMIT"
record_str fixtureHead "$FIXTURE_HEAD"
record_str resetReceipt "$RESET_RECEIPT"
record_str fixtureRoot "$FIXTURE_REPO"

cat > "$RUN_DIR/probe-leases.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { listActiveAgentSessions } from "./src/sessions/index.ts";
const [workspace, project] = process.argv.slice(2);
const active = withReadOnlyDatabase(workspace, (db) => listActiveAgentSessions(db));
console.log(JSON.stringify({ active: active.length, fixtureActive: active.filter((s) => s.project_slug === project).map((s) => s.id) }));
NODE
if [[ -n "$WORKSPACE" ]] && LEASES="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" < "$RUN_DIR/probe-leases.mjs")"; then
  if jq -e '.fixtureActive == []' <<<"$LEASES" >/dev/null; then
    check fixture_leases pass "no prepared or running fixture Session ($(jq '.active' <<<"$LEASES") active Session(s) host-wide)"
  else
    check fixture_leases refuse "fixture Sessions are already live: $(jq -c '.fixtureActive' <<<"$LEASES")"
  fi
else
  check fixture_leases refuse "repository leases could not be observed"
fi

# Issue #968: a pending proposal or open Decision naming a chain Action makes the dispatch
# gate answer "decision", and the tick then launches nothing. Read-only through resolveOperatorGate.
cat > "$RUN_DIR/probe-operator-gate.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { resolveOperatorGate } from "./src/ask/operatorGate.ts";
const [workspace, fixtureRoot, slug, actionsJson] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => ({
  blocking: JSON.parse(actionsJson).flatMap((actionId) => resolveOperatorGate({ db, repoRoot: fixtureRoot, projectSlug: slug, selectedActionId: actionId })
    .blocking.map((item) => ({ action: actionId, kind: item.kind, id: item.id, title: item.title, settle: item.settleCommand })))
}))));
NODE
if [[ -n "$WORKSPACE" && -n "$FIXTURE_HEAD" ]] && GATE="$(probe "$WORKSPACE" "$FIXTURE_REPO" "$FIXTURE_PROJECT" "$ACTION_IDS_JSON" < "$RUN_DIR/probe-operator-gate.mjs")" \
    && jq -e '.blocking | type == "array"' <<<"$GATE" >/dev/null 2>&1; then
  printf '%s\n' "$GATE" > "$RUN_DIR/operator-gate.json"
  if jq -e '.blocking == []' <<<"$GATE" >/dev/null; then
    check operator_gate pass "no pending proposal or open Decision gates any of the $N chain Actions"
  else
    check operator_gate refuse "pending operator items would make dispatch answer decision, so the Grant would launch nothing: $(jq -c '[.blocking[] | {action, kind, id}]' <<<"$GATE"); settle each through its own governed path"
  fi
else
  check operator_gate refuse "the dispatch gate's pending proposals and Decisions could not be observed for the fixture"
fi

# Issue #1015: the operational queue must be valid: every approved Action positioned. An
# unpositioned Action makes `advance queue make-next` refuse every Project ("position every
# approved Action before choosing next"). The chain reset arranges the fixture's Actions;
# this observes, read-only, that nothing is left unpositioned.
QUEUE_SUMMARY=""
if QUEUE="$(arcadia advance queue --json 2>/dev/null)" && QUEUE_SUMMARY="$(jq -ce 'select(.ok == true and (.data.orderValid | type) == "boolean" and (.data.unpositionedCount | type) == "number")
    | {revision: .data.revision, orderValid: .data.orderValid, unpositionedCount: .data.unpositionedCount, nextActionKey: .data.nextActionKey, unpositioned: [.data.ordered[]? | select(.orderStatus == "unpositioned") | .orderKey]}' <<<"$QUEUE" 2>/dev/null)" && [[ -n "$QUEUE_SUMMARY" ]]; then
  if jq -e '.orderValid == true and .unpositionedCount == 0' <<<"$QUEUE_SUMMARY" >/dev/null; then
    check action_queue pass "the Action queue is valid at revision $(jq -r '.revision' <<<"$QUEUE_SUMMARY"): orderValid true, 0 unpositioned"
  else
    check action_queue refuse "the Action queue order is invalid, so the tick cannot choose next: $(jq -c '{revision, orderValid, unpositionedCount, unpositioned}' <<<"$QUEUE_SUMMARY"); position them through a governed advance queue arrange (the chain reset does this for the fixture's Actions), then rerun this preflight"
  fi
  record "actionQueue" "$QUEUE_SUMMARY"
else
  check action_queue refuse "the Action queue could not be read (arcadia advance queue --json), so its order is not known to be valid"
fi

# Worker-context Claude Code sign-in: the same check a managed launch runs. Only
# the verdict leaves the probe; the token file is never printed or copied.
cat > "$RUN_DIR/probe-claude-sign-in.mjs" <<'NODE'
import { checkProviderSignIn } from "./src/codingAgents/signIn.ts";
const [workspace] = process.argv.slice(2);
let verdict;
try {
  const status = checkProviderSignIn("claude-code-cli", workspace);
  verdict = status === null ? "unknown" : status.signedIn ? "signed_in" : "signed_out";
} catch {
  verdict = "unavailable";
}
console.log(JSON.stringify({ verdict }));
NODE
CLAUDE_VERDICT=unavailable
if [[ -n "$WORKSPACE" ]] && CLAUDE="$(probe "$WORKSPACE" < "$RUN_DIR/probe-claude-sign-in.mjs")"; then
  CLAUDE_VERDICT="$(jq -r '.verdict // "unavailable"' <<<"$CLAUDE" 2>/dev/null || echo unavailable)"
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  check claude_worker_token refuse "ANTHROPIC_API_KEY is set in this host environment, which can bill paid API usage; unset it (its value was not read)"
elif [[ "$CLAUDE_VERDICT" == signed_in ]]; then
  check claude_worker_token pass "claude-code-cli is signed in from the worker's documented sources"
else
  check claude_worker_token refuse "claude-code-cli sign-in verdict is ${CLAUDE_VERDICT:-unavailable}; run verify-claude-code-token"
fi

if command -v codex >/dev/null && timeout 20 codex --version >/dev/null 2>&1; then
  LOGIN_STATE="$(timeout 20 codex login status 2>&1 || true)"
  if grep -q 'Logged in using ChatGPT' <<<"$LOGIN_STATE"; then
    check codex_reviewer_login pass "codex is signed in with a ChatGPT subscription"
  elif grep -qi 'api key' <<<"$LOGIN_STATE"; then
    check codex_reviewer_login refuse "codex is signed in with an API key, which bills paid usage"
  else
    check codex_reviewer_login refuse "codex sign-in state is unknown"
  fi
else
  check codex_reviewer_login refuse "codex is not installed or did not answer within 20 seconds"
fi
unset LOGIN_STATE

# Codex capacity is read live, ignoring the workspace's unmetered standing
# choice: the probe makes a fresh account/rateLimits/read of the codex app
# server (the path src/codingAgents/availability.ts uses) with a bounded retry
# and judges only that reading (Issue #1016). When no attempt answers, it names
# each failure (a timeout or an exit status) and the check refuses; it never
# judges whatever telemetry an earlier run left in the cache. The reading must
# be fresh, observed or attested, and included.
cat > "$RUN_DIR/probe-codex-capacity.mjs" <<'NODE'
import { loadPhase3Registries } from "./src/intent/registries.ts";
import { observeCodexCapacityLive } from "./src/operatorActions/rehearsalChainProbe.ts";
const [workspace] = process.argv.slice(2);
const profiles = loadPhase3Registries(workspace).codingAgents.profiles;
console.log(JSON.stringify(observeCodexCapacityLive(profiles)));
NODE
if [[ -n "$WORKSPACE" ]] && CAPACITY="$(probe "$WORKSPACE" < "$RUN_DIR/probe-codex-capacity.mjs")"; then
  printf '%s\n' "$CAPACITY" > "$RUN_DIR/codex-capacity.json"
  if jq -e '.readOnlyReviewers | length > 0' <<<"$CAPACITY" >/dev/null; then
    check codex_reviewer_profile pass "read-only codex reviewer profile(s): $(jq -r '.readOnlyReviewers | join(", ")' <<<"$CAPACITY")"
  else
    check codex_reviewer_profile refuse "no codex-cli profile with a read-only sandbox exists; arcadia qa pr would refuse"
  fi
  if ! jq -e '.liveRead.ok == true' <<<"$CAPACITY" >/dev/null 2>&1; then
    check codex_capacity refuse "the live Codex capacity read (codex app-server account/rateLimits/read) failed on every attempt, so no capacity was judged and no cached observation was used: $(jq -r '[.liveRead.attempts[]? | select(.ok == false) | "attempt \(.attempt): \(.failure.kind)\(if .failure.exitStatus != null then " (exit status \(.failure.exitStatus))" else "" end): \(.failure.detail)"] | join("; ")' <<<"$CAPACITY" 2>/dev/null)"
  # Enumerated values from src/codingAgents/capacity.ts and availability.ts:
  # evidence real|simulated; availability available|unknown|usage_limited|budget_limited.
  # An observation must report the provider available; only an operator
  # attestation, which carries no provider telemetry, may leave it unknown.
  elif jq -e '.codex != null and .codex.admitted == true and .codex.freshness == "fresh" and (.codex.confidence == "observed" or .codex.confidence == "attested") and .codex.usagePolicy == "included" and .codex.evidence == "real" and (.codex.availability == "available" or (.codex.confidence == "attested" and .codex.availability == "unknown"))' <<<"$CAPACITY" >/dev/null; then
    check codex_capacity pass "fresh $(jq -r '.codex.confidence' <<<"$CAPACITY") included capacity read live on attempt $(jq -r '[.liveRead.attempts[] | select(.ok == true) | .attempt] | first' <<<"$CAPACITY") of $(jq -r '.liveRead.maxAttempts' <<<"$CAPACITY") (unattended proof: $(jq -r '.codex.unattendedProof' <<<"$CAPACITY"))"
  else
    check codex_capacity refuse "codex capacity evidence is not fresh, included and available: $(jq -c '.codex | if . == null then "no observation" else {admitted, freshness, confidence, usagePolicy, evidence, availability, reason} end' <<<"$CAPACITY")"
  fi
else
  check codex_reviewer_profile refuse "coding-agent profiles could not be read"
  check codex_capacity refuse "codex capacity could not be observed"
fi

# GitHub readiness: reads limited to gh auth, the exact fixture repository,
# its main branch and the check runs on the reset head.
if ghx auth status >/dev/null 2>&1; then
  check github_auth pass "gh is authenticated"
else
  check github_auth refuse "gh is not authenticated or GitHub is unreachable"
fi
if [[ -n "$REPO" && -n "$FIXTURE_HEAD" ]] && REPO_VIEW="$(ghx api "repos/$REPO" 2>/dev/null)"; then
  # On an HTTP error gh prints the error body on stdout; discard it rather than appending a second document to it.
  BRANCH_VIEW="$(ghx api "repos/$REPO/branches/main" 2>/dev/null)" || BRANCH_VIEW='{}'
  if jq -e '.private == true and .archived == false and .fork == false and (.permissions.push == true or .permissions.admin == true) and .default_branch == "main"' <<<"$REPO_VIEW" >/dev/null \
    && jq -e --arg head "$FIXTURE_HEAD" '.commit.sha == $head and .protected == false' <<<"$BRANCH_VIEW" >/dev/null; then
    check github_repository pass "$REPO is private, writable, unprotected, and main is the chain reset head"
  else
    check github_repository refuse "$REPO must be private, writable, unarchived, without branch protection, with main at the chain reset head $FIXTURE_HEAD"
  fi
  CHECKS_STATE=unknown
  # Wall-clock bound: each read is capped at 20 seconds and no read starts after the deadline.
  CHECK_DEADLINE=$(( $(date -u +%s) + CHECK_WAIT_SECONDS ))
  while :; do
    # A failed read is "unreadable", never "none": gh's error body on stdout is discarded.
    if RUNS="$(timeout 20 gh api "repos/$REPO/commits/$FIXTURE_HEAD/check-runs" 2>/dev/null)"; then
      CHECKS_STATE="$(jq -r 'if (.total_count // 0) == 0 then "none" elif all(.check_runs[]; .status == "completed" and .conclusion == "success") then "success" elif any(.check_runs[]; .status == "completed" and .conclusion != "success") then "failed" else "pending" end' <<<"$RUNS" 2>/dev/null)" || CHECKS_STATE=unknown
      [[ "$CHECKS_STATE" =~ ^(none|success|failed|pending)$ ]] || CHECKS_STATE=unknown
    else
      CHECKS_STATE="unreadable (the GitHub check-runs read failed)"
    fi
    if [[ "$CHECKS_STATE" == success || "$CHECKS_STATE" == failed ]]; then break; fi
    if (( $(date -u +%s) + 15 >= CHECK_DEADLINE )); then break; fi
    sleep 15
  done
  if [[ "$CHECKS_STATE" == success ]]; then
    check github_checks pass "chain reset-head CI check runs completed successfully"
  else
    check github_checks refuse "chain reset-head CI checks are $CHECKS_STATE after a bounded ${CHECK_WAIT_SECONDS}s wait; pull requests need a non-empty, green statusCheckRollup"
  fi
else
  check github_repository refuse "the fixture repository could not be read on GitHub"
  check github_checks refuse "not observed: fixture repository unavailable"
fi

STAGE=verdict
if (( REFUSALS > 0 )); then
  REASON="$REFUSALS preflight check(s) refused; see checks in the receipt"
  echo "REFUSED: $REASON" >&2
  write_receipt refused
  write_handoff
  exit 1
fi
write_receipt succeeded
echo "READY: every preflight check passed. This run's G7 Grant ($GRANT_ID) accepts this receipt for 30 minutes: $RECEIPT"
echo "Do not push to Arcadia main, reinstall, restart services or press any G8 until that press: each voids this receipt."
