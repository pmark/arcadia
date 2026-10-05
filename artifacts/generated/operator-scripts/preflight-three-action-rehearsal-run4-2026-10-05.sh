#!/usr/bin/env bash
# G6 for rehearsal run 4: bounded, read-only preflight for the run-4 Grant
# (grant-production-three-action-rehearsal-run4-2026-10-05). It binds the
# fixture head that the latest succeeded run-4 reset receipt
# (reset-three-action-rehearsal-fixture-run4-2026-10-05) recorded, one commit
# on run 3's reset head, and keeps every check of the run-3 preflight. It also
# observes, read-only, that no pending Agent Ask proposal or Decision gates a
# fixture Action (Issue #968: such an item makes dispatch answer "decision"). It
# observes production status and the installed release, the worker-context
# Claude Code sign-in verdict (never the token), Codex reviewer readiness and
# capacity, and GitHub readiness for exactly the fixture repository. Every
# unknown, stale, paid or unavailable observation refuses. It never previews or
# activates production, writes a token, restarts anything, or calls a model.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="preflight-three-action-rehearsal-run4-2026-10-05"
RESET_ID="reset-three-action-rehearsal-fixture-run4-2026-10-05"
# Run 3's reset head: the run-4 reset commit's only parent; run 2's reset head is its parent.
RUN3_HEAD="4375aafeef38f0ee339a300406c8a865dbb916dc"
RUN2_HEAD="0d3d2cedc5548da41896201688a1dc0210208ea4"
ARCADIA_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST="$FIXTURE_REPO/.arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
ACTIONS_JSON='["write-start-marker","transform-start-marker","verify-final-rehearsal"]'
PROVIDER="claude-code-cli"
# Installed features the rehearsal depends on: remote preservation (#922) and
# tick-driven PR readiness with independent reviews (#924).
REQUIRED_COMMITS="9a9db5e8bfe7b35d0b312fc2f763cc80c2db25f1 0b3686013f0a924c35d58dc7a09c979f1a994c7e"
# A broker release counts as current only when no runtime code differs from main.
RUNTIME_PATHS="src scripts apps package.json pnpm-lock.yaml tsconfig.json"
CHECK_WAIT_SECONDS=300
REPO_PATTERN='^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?/arcadia-three-action-rehearsal(-[a-z0-9]{1,24})?$'

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
    echo "and nothing was restarted. Do not press the G7 Grant: it requires a fresh passing receipt from this preflight."
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
# Probes read the program on stdin so ./src imports resolve against the checkout.
probe() { (cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$@"); }
ghx() { timeout 60 gh "$@"; }

echo "== G6 (run 4): three-Action rehearsal preflight at the run-4 reset head (observation only) =="
for tool in git jq mise gh timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done

STAGE=observe
HEAD=""
if [[ "$(git -C "$ARCADIA_REPO" branch --show-current 2>/dev/null)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain 2>/dev/null)" ]] \
  && HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)" && [[ "$HEAD" == "$(git -C "$ARCADIA_REPO" rev-parse origin/main 2>/dev/null)" ]]; then
  check arcadia_checkout pass "clean main at $HEAD, level with last-fetched origin/main"
else
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
if [[ -z "$MISSING" ]]; then check installed_features pass "remote preservation (#922) and tick-driven reviews (#924) are on main"; else check installed_features refuse "main lacks required commits:$MISSING"; fi

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
    check installed_release refuse "installed broker release $BROKER_REVISION is stale against main $HEAD; run reinstall-go-broker or recover-arcadia-host-services"
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
if [[ -f "$MANIFEST" ]] && jq -e --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --argjson actions "$ACTIONS_JSON" --arg provider "$PROVIDER" \
    '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .fixtureProject == $p and .fixturePlan == $plan and .actions == $actions and .provider == $provider' "$MANIFEST" >/dev/null; then
  REPO="$(jq -r '.githubRepository' "$MANIFEST")"
  [[ "$REPO" =~ $REPO_PATTERN ]] || REPO=""
  ROOT_COMMIT="$(git -C "$FIXTURE_REPO" rev-list --max-parents=0 HEAD 2>/dev/null || true)"
  ORIGIN="$(git -C "$FIXTURE_REPO" remote get-url origin 2>/dev/null || true)"
  # The run-4 fixture head is the one the latest succeeded run-4 reset receipt
  # for this exact repository recorded: one reset commit on run 3's reset head,
  # itself one commit on run 2's reset head, one commit on G1's genesis.
  if [[ -n "$REPO" ]]; then
    for candidate in "$SCRIPT_DIR"/runs/*/receipt.json; do
      [[ -f "$candidate" ]] || continue
      if jq -e --arg id "$RESET_ID" --arg repo "$REPO" '.id == $id and .outcome == "succeeded" and .githubRepository == $repo' "$candidate" >/dev/null 2>&1; then RESET_RECEIPT="$candidate"; fi
    done
  fi
  LOCAL_HEAD="$(git -C "$FIXTURE_REPO" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$RESET_RECEIPT" ]]; then
    check reset_receipt refuse "no succeeded $RESET_ID receipt exists for ${REPO:-the manifest repository}; run the reset first"
  elif jq -e --arg head "$LOCAL_HEAD" --arg root "$ROOT_COMMIT" --arg run3 "$RUN3_HEAD" --arg fixture "$FIXTURE_REPO" \
      '(.newHead | test("^[0-9a-f]{40}$")) and .newHead == $head and .previousMain == $run3 and .genesis == $root and .remoteMainAfter == .newHead and .fixtureRoot == $fixture' "$RESET_RECEIPT" >/dev/null 2>&1 \
      && [[ "$(git -C "$FIXTURE_REPO" rev-parse HEAD^ 2>/dev/null)" == "$RUN3_HEAD" && "$(git -C "$FIXTURE_REPO" rev-parse HEAD^^ 2>/dev/null)" == "$RUN2_HEAD" && "$(git -C "$FIXTURE_REPO" rev-parse HEAD^^^ 2>/dev/null)" == "$ROOT_COMMIT" && "$(git -C "$FIXTURE_REPO" rev-list --count HEAD 2>/dev/null)" == 4 ]]; then
    FIXTURE_HEAD="$LOCAL_HEAD"
    check reset_receipt pass "fixture main $FIXTURE_HEAD is the run-4 reset head recorded in $RESET_RECEIPT, one commit on run 3's reset head $RUN3_HEAD on run 2's reset head $RUN2_HEAD on genesis $ROOT_COMMIT"
  else
    check reset_receipt refuse "the latest run-4 reset receipt $RESET_RECEIPT does not match the fixture: its newHead must be local fixture main ($LOCAL_HEAD), its previousMain run 3's reset head $RUN3_HEAD (the only parent, itself on run 2's reset head $RUN2_HEAD) and its genesis the single root ($ROOT_COMMIT); a stale receipt or a fixture that moved on refuses"
  fi
  if [[ "$(git -C "$FIXTURE_REPO" branch --show-current 2>/dev/null)" == main && -z "$(git -C "$FIXTURE_REPO" status --porcelain 2>/dev/null)" \
      && -n "$ROOT_COMMIT" && "$ROOT_COMMIT" != *$'\n'* && -n "$FIXTURE_HEAD" \
      && ( "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ) \
      && -s "$FIXTURE_REPO/.git/arcadia-three-action-first-packet-approval" ]]; then
    check fixture pass "$REPO at run-4 reset head $FIXTURE_HEAD on run 3's and run 2's reset heads and genesis $ROOT_COMMIT, clean, first packet seeded"
  else
    check fixture refuse "the local fixture must be clean on main at the run-4 reset head on run 3's and run 2's reset heads and its single genesis commit, with origin $REPO and a seeded first packet"
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

# Issue #968: a pending Agent Ask proposal or open Decision naming a fixture
# Action makes the dispatch gate answer "decision", and the tick then launches
# nothing. Read-only through Arcadia's own resolveOperatorGate.
cat > "$RUN_DIR/probe-operator-gate.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { resolveOperatorGate } from "./src/ask/operatorGate.ts";
const [workspace, fixtureRoot, slug, actionsJson] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => ({
  blocking: JSON.parse(actionsJson).flatMap((actionId) => resolveOperatorGate({ db, repoRoot: fixtureRoot, projectSlug: slug, selectedActionId: actionId })
    .blocking.map((item) => ({ action: actionId, kind: item.kind, id: item.id, title: item.title, settle: item.settleCommand })))
}))));
NODE
if [[ -n "$WORKSPACE" && -n "$FIXTURE_HEAD" ]] && GATE="$(probe "$WORKSPACE" "$FIXTURE_REPO" "$FIXTURE_PROJECT" "$ACTIONS_JSON" < "$RUN_DIR/probe-operator-gate.mjs")" \
    && jq -e '.blocking | type == "array"' <<<"$GATE" >/dev/null 2>&1; then
  printf '%s\n' "$GATE" > "$RUN_DIR/operator-gate.json"
  if jq -e '.blocking == []' <<<"$GATE" >/dev/null; then
    check operator_gate pass "no pending Agent Ask proposal or open Decision gates a fixture Action"
  else
    check operator_gate refuse "pending operator items would make dispatch answer decision, so the Grant would launch nothing: $(jq -c '[.blocking[] | {action, kind, id}]' <<<"$GATE"); settle each through its own governed path"
  fi
else
  check operator_gate refuse "the dispatch gate's pending proposals and Decisions could not be observed for the fixture"
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

# Codex capacity is observed directly, ignoring the workspace's unmetered
# standing choice: evidence must be fresh, observed or attested, and included.
cat > "$RUN_DIR/probe-codex-capacity.mjs" <<'NODE'
import path from "node:path";
import { loadPhase3Registries } from "./src/intent/registries.ts";
import { observeProviderCapacity } from "./src/codingAgents/capacity.ts";
const [workspace] = process.argv.slice(2);
const profiles = loadPhase3Registries(workspace).codingAgents.profiles;
const observation = observeProviderCapacity(profiles, { now: new Date(), unmeteredProvider: null });
const decision = observation.providers.find((entry) => entry.providerId === "codex-cli");
const readOnlyReviewers = profiles.filter((p) => p.provider === "codex-cli" && p.sandbox === "read-only" && path.basename(p.command) === "codex").map((p) => p.name);
console.log(JSON.stringify({
  generatedAt: observation.generatedAt,
  readOnlyReviewers,
  codex: decision ? {
    admitted: decision.admitted, code: decision.code, reason: decision.reason, unattendedProof: decision.unattendedProof,
    source: decision.receipt.source, evidence: decision.receipt.evidence, confidence: decision.receipt.confidence,
    freshness: decision.receipt.freshness, usagePolicy: decision.receipt.usagePolicy, observedAt: decision.receipt.observedAt,
    expiresAt: decision.receipt.expiresAt, availability: decision.receipt.availability, windows: decision.receipt.windows
  } : null
}));
NODE
if [[ -n "$WORKSPACE" ]] && CAPACITY="$(probe "$WORKSPACE" < "$RUN_DIR/probe-codex-capacity.mjs")"; then
  printf '%s\n' "$CAPACITY" > "$RUN_DIR/codex-capacity.json"
  if jq -e '.readOnlyReviewers | length > 0' <<<"$CAPACITY" >/dev/null; then
    check codex_reviewer_profile pass "read-only codex reviewer profile(s): $(jq -r '.readOnlyReviewers | join(", ")' <<<"$CAPACITY")"
  else
    check codex_reviewer_profile refuse "no codex-cli profile with a read-only sandbox exists; arcadia qa pr would refuse"
  fi
  # Enumerated values from src/codingAgents/capacity.ts and availability.ts:
  # evidence real|simulated; availability available|unknown|usage_limited|budget_limited.
  # An observation must report the provider available; only an operator
  # attestation, which carries no provider telemetry, may leave it unknown.
  if jq -e '.codex != null and .codex.admitted == true and .codex.freshness == "fresh" and (.codex.confidence == "observed" or .codex.confidence == "attested") and .codex.usagePolicy == "included" and .codex.evidence == "real" and (.codex.availability == "available" or (.codex.confidence == "attested" and .codex.availability == "unknown"))' <<<"$CAPACITY" >/dev/null; then
    check codex_capacity pass "fresh $(jq -r '.codex.confidence' <<<"$CAPACITY") included capacity (unattended proof: $(jq -r '.codex.unattendedProof' <<<"$CAPACITY"))"
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
  # On an HTTP error gh prints the error body on stdout; discard it rather than
  # appending a second document to it.
  BRANCH_VIEW="$(ghx api "repos/$REPO/branches/main" 2>/dev/null)" || BRANCH_VIEW='{}'
  if jq -e '.private == true and .archived == false and .fork == false and (.permissions.push == true or .permissions.admin == true) and .default_branch == "main"' <<<"$REPO_VIEW" >/dev/null \
    && jq -e --arg head "$FIXTURE_HEAD" '.commit.sha == $head and .protected == false' <<<"$BRANCH_VIEW" >/dev/null; then
    check github_repository pass "$REPO is private, writable, unprotected, and main is the reset head"
  else
    check github_repository refuse "$REPO must be private, writable, unarchived, without branch protection, with main at the reset head $FIXTURE_HEAD"
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
    check github_checks pass "reset-head CI check runs completed successfully"
  else
    check github_checks refuse "reset-head CI checks are $CHECKS_STATE after a bounded ${CHECK_WAIT_SECONDS}s wait; pull requests need a non-empty, green statusCheckRollup"
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
echo "READY: every preflight check passed. The run-4 G7 Grant (grant-production-three-action-rehearsal-run4-2026-10-05) accepts this receipt for 30 minutes: $RECEIPT"
echo "Do not push to Arcadia main, reinstall, restart services or press any G8 until that press: each voids this receipt."
