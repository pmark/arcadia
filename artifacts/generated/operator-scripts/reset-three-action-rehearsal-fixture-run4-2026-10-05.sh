#!/usr/bin/env bash
# Reset the disposable three-Action rehearsal fixture for rehearsal run 4.
# Run 3 left fixture main at its own reset head and a passed development
# attempt for write-start-marker's run-3 input, with its candidate preserved on
# a branch and pull request #3; runs 1 and 2's candidates and PRs #1 and #2
# stay as well. A passed attempt is never relaunched for an unchanged
# requirement input (src/sessions/roleLineage.ts), so run 4 needs a fourth
# input revision. This script rewrites only that Action's next_action line in
# the fixture Plan (and the Plan's `updated:` date when the reset's UTC date is
# later), validates the amended fixture with Arcadia's own discovery,
# docs-sync and requirementIdentity code, keeps run 3's Issue #968 handling (a
# pending Agent Ask proposal naming the Action makes the dispatch gate answer
# "decision" and dispatch nothing) by refusing every pending fixture proposal
# except exactly run 3's complete proposal, which it rejects through the
# governed two-phase settle only while it is still pending (live, the tick
# already accepted it on run 3's candidate branch, which leaves it as is),
# requires the gate clear, and only then commits once on fixture main, pushes
# without force, runs docs sync and writes a receipt carrying the new fixture
# head. It never previews, activates or deactivates production, creates or
# presses a Grant, touches another Action, run 1's, run 2's or run 3's branch
# or pull request, settles any other proposal, restarts anything, or launches a
# Session.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="reset-three-action-rehearsal-fixture-run4-2026-10-05"
G1_ID="prepare-three-action-rehearsal-fixture-2026-10-04"
RUN3_RESET_ID="reset-three-action-rehearsal-fixture-run3-2026-10-05"
RUN3_G8_ID="restore-terminal-off-three-action-rehearsal-run3-2026-10-05"
# Run 3's terminal Off: this run or a later succeeded one.
RUN3_G8_MIN_RUN_ID="20261005T194025Z-26232"
ARCADIA_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST_NAME=".arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_NAME="Three Action Rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
PLAN_FILE="docs/plans/$FIXTURE_PLAN.md"
ACTION_A="write-start-marker"
ACTION_B="transform-start-marker"
ACTION_C="verify-final-rehearsal"
ACTIONS_JSON='["write-start-marker","transform-start-marker","verify-final-rehearsal"]'
PROVIDER="claude-code-cli"
REPO_DESCRIPTION="Disposable Arcadia three-Action rehearsal fixture (arcadia-three-action-rehearsal-v1); safe to delete after its recorded review."
OWNER_PATTERN='^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
NAME_PATTERN='^arcadia-three-action-rehearsal(-[a-z0-9]{1,24})?$'
# Fixture main as run 3's reset left it: one reset commit on run 2's reset
# head, itself one reset commit on G1's genesis.
RUN2_HEAD="0d3d2cedc5548da41896201688a1dc0210208ea4"
RUN3_HEAD="4375aafeef38f0ee339a300406c8a865dbb916dc"
# The preserved candidates of runs 1, 2 and 3: left exactly as they are, locally and on GitHub.
RUN1_BRANCH="claude/write-start-marker-20261004T170245861Z"
RUN1_TIP="58bcd9155cf64836994045ca63a7707d8b9ebe75"
RUN1_PR=1
RUN2_BRANCH="claude/write-start-marker-20261005T155147519Z"
RUN2_TIP="7f1390376f4d49215cd29fd98145d40198475613"
RUN2_PR=2
RUN3_BRANCH="claude/write-start-marker-20261005T184707757Z"
RUN3_TIP="50d1eab84e385a5566119831c82f5a6d32e752fd"
RUN3_PR=3
# write-start-marker's requirement input revisions so far: G1's original, run 2's and run 3's.
ORIGINAL_REVISION="959a3b12c686cf51449e93c2cc84dd26c3aebd2c912ac86b5a789222a14a009d"
RUN2_REVISION="7a8dd4f5960f1c2d154cef0d4944b3aaa2a2dbfa80ee2b6c7abb5d9e0ac4f4a8"
RUN3_REVISION="e22c8cfadd0bde72cf84288b3402bc67e4c7655bad5d544c1c15f23c6c09e7ee"
# The one pending proposal this script may close (Issue #968): run 3's own
# complete Ask, exactly as this action's descriptor declares it (agentAsk).
RUN3_PROPOSAL="complete-write-start-marker-run3-2026-10-05"
RUN3_PROPOSAL_INTENT="complete"
RUN3_PROPOSAL_TARGET="action/write-start-marker"
SUPERSEDE_REQUEST_ID="reset-three-action-rehearsal-fixture-run4-2026-10-05-reject-run3-complete"
# The one line this script changes, from run 3's text to a fourth. Only
# next_action feeds the requirement input revision among the Action's prose
# fields; the acceptance criteria, responsibility, execution and title stay
# byte-identical, so the marker contract and its verdict criteria are unchanged.
OLD_NEXT_ACTION='    next_action: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline (rehearsal run 3, from the run-2 reset fixture main; the run 1 and run 2 attempts and candidates stay as evidence; record completion under the unused Agent Ask request id complete-write-start-marker-run3-2026-10-05, because complete-write-start-marker-2026-10-05 is already settled).'
NEW_NEXT_ACTION='    next_action: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline (rehearsal run 4, from the run-3 reset fixture main; the run 1, run 2 and run 3 attempts and candidates stay as evidence; record completion under the unused Agent Ask request id complete-write-start-marker-run4-2026-10-05, because complete-write-start-marker-2026-10-05 and complete-write-start-marker-run3-2026-10-05 are already settled).'
# The completion request id that text names. The packet template's
# complete-<action-id>-<yyyy-mm-dd> would give run 2's already-settled id on
# 2026-10-05, and run 3's own id is settled too; discovery skips a settled id
# and preview refuses it for new content.
RUN4_COMPLETION_ID="complete-write-start-marker-run4-2026-10-05"
RESET_SUBJECT="Reset write-start-marker for three-Action rehearsal run 4"
# docs sync applies a Plan only when its `updated:` date is not older than the
# synced record's (day granularity: an equal date applies), so the Plan carries
# the reset's UTC date; a reset date before the Plan's own date refuses.
RESET_DATE="$(date -u +%F)"
DATE_LINE_PATTERN='^updated: [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$'

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

STAGE=parameters
REASON=""
RECOVERY=""
EXTRA=""
REMOTE_CHANGED=false
LOCAL_COMMITTED=false
PROPOSAL_SETTLED=false
SUPERSEDE_FINGERPRINT=""
RESET_STATE=""
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"productionPreviewedOrActivated":false,"grantsTouched":false%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
on_error() {
  local code=$? command="$BASH_COMMAND"
  # A failure inside a command substitution or wrapper subshell is the
  # parent's to judge; only the top-level shell writes the receipt.
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  trap - ERR
  set +e
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  record "fixtureCommitted" "$LOCAL_COMMITTED"
  record "githubRepositoryChanged" "$REMOTE_CHANGED"
  record "proposalSettledByThisRun" "$PROPOSAL_SETTLED"
  [[ -z "$SUPERSEDE_FINGERPRINT" ]] || record_str supersedePreviewFingerprint "$SUPERSEDE_FINGERPRINT"
  [[ -z "$RECOVERY" ]] || record_str recovery "$RECOVERY"
  write_receipt refused
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT"
    echo
    echo "Production policy was not previewed, activated or deactivated, no Grant was created or pressed, no service"
    echo "was restarted and no Session was launched. Run 1's branch $RUN1_BRANCH and pull request #$RUN1_PR, run 2's branch"
    echo "$RUN2_BRANCH and pull request #$RUN2_PR, and run 3's branch $RUN3_BRANCH and pull request #$RUN3_PR, were not touched."
    echo "No Agent Ask proposal other than $RUN3_PROPOSAL was settled."
    [[ -z "$RESET_STATE" ]] || echo "Fixture state found at the start of this run: $RESET_STATE."
    if [[ "$PROPOSAL_SETTLED" == true ]]; then
      echo "This run rejected run 3's pending proposal $RUN3_PROPOSAL through the governed settle (request id $SUPERSEDE_REQUEST_ID, preview fingerprint $SUPERSEDE_FINGERPRINT). Rerunning recognizes that rejection and does not settle again."
    elif [[ -n "$SUPERSEDE_FINGERPRINT" ]]; then
      echo "This run previewed rejecting $RUN3_PROPOSAL (fingerprint $SUPERSEDE_FINGERPRINT) but did not confirm the apply. Rerunning re-reads the proposal: a landed rejection under $SUPERSEDE_REQUEST_ID is recognized; otherwise it previews afresh."
    fi
    if [[ "$REMOTE_CHANGED" == true ]]; then
      echo "This run pushed (never forced) the reset commit to fixture main before stopping, or attempted to. Rerunning re-reads GitHub main and resumes at docs sync once it is the reset head."
    elif [[ "$LOCAL_COMMITTED" == true ]]; then
      echo "This run committed the reset on local fixture main but pushed nothing. Rerunning re-validates that exact commit and pushes it."
    else
      echo "This run made no fixture commit and no push."
    fi
    if [[ -n "$RECOVERY" ]]; then
      echo
      echo "## Recovery"
      echo
      echo "$RECOVERY"
    else
      echo "Correct the named precondition and rerun. Do not edit the script, the fixture Plan, the fixture history or the workspace database by hand."
    fi
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
trap on_error ERR

arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }
# Probes read the program on stdin so ./src imports resolve against the checkout.
probe() { (cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$@"); }
ghx() { timeout 60 gh "$@"; }
fx() { git -C "$FIXTURE_REPO" "$@"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

echo "== Reset the three-Action rehearsal fixture for run 4 (no production change) =="

# The repository identifier is operator input, never defaulted or derived.
REQUESTED_REPO="${ARCADIA_REHEARSAL_GITHUB_REPO:-}"
[[ -n "$REQUESTED_REPO" ]] || refuse "ARCADIA_REHEARSAL_GITHUB_REPO is required: set it to the exact owner/name of the fixture repository G1 prepared, then run this script from a terminal"
[[ "$REQUESTED_REPO" == */* && "${REQUESTED_REPO#*/}" != */* ]] || refuse "ARCADIA_REHEARSAL_GITHUB_REPO must be exactly owner/name"
OWNER="${REQUESTED_REPO%%/*}"
NAME="${REQUESTED_REPO#*/}"
[[ "$OWNER" =~ $OWNER_PATTERN ]] || refuse "repository owner '$OWNER' is not a valid GitHub login"
[[ "$NAME" =~ $NAME_PATTERN ]] || refuse "repository name '$NAME' does not match the disposable-fixture pattern $NAME_PATTERN"
REPO="$OWNER/$NAME"
record_str githubRepository "$REPO"
record_str fixtureRoot "$FIXTURE_REPO"
record_str planFile "$PLAN_FILE"
record_str actionId "$ACTION_A"

STAGE=preflight
for tool in git jq mise gh timeout node tar; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
[[ "$(git -C "$ARCADIA_REPO" rev-parse --show-toplevel 2>/dev/null)" == "$ARCADIA_REPO" ]] || refuse "the operator-script library is not inside the Arcadia checkout"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || refuse "the Arcadia checkout must be on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean"
[[ -z "${ARCADIA_WORKSPACE+x}" ]] || refuse "ARCADIA_WORKSPACE is set in this shell, so the workspace would not resolve from user config; run 'unset ARCADIA_WORKSPACE' and rerun"
# This action's own descriptor declares the one proposal it may settle; the constants must agree with it.
jq -e --arg p "$RUN3_PROPOSAL" --arg i "$RUN3_PROPOSAL_INTENT" --arg t "$RUN3_PROPOSAL_TARGET" '.agentAsk == {proposal: $p, intent: $i, targetRef: $t}' "$SCRIPT_DIR/$SCRIPT_ID.json" >/dev/null \
  || refuse "this action's descriptor does not declare exactly the proposal $RUN3_PROPOSAL ($RUN3_PROPOSAL_INTENT, $RUN3_PROPOSAL_TARGET) that it may settle"
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve from user config"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the CLI's default workspace is $WORKSPACE, not martianrover; refusing to sync the fixture elsewhere"
record_str workspace "$WORKSPACE"
# Production must be readable, Inactive and admit nothing while the fixture changes.
production_quiet() {
  local status
  status="$(arcadia production status --json)" || return 1
  printf '%s\n' "$status" > "$RUN_DIR/production-status-$1.json"
  jq -e '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive" and .data.liveAdmissions == 0' <<<"$status" >/dev/null
}
production_quiet before || refuse "production must be readable, Inactive and have zero live admissions while the fixture is reset (an unreadable store is not a confirmed Off)"
record "policyRevisionObserved" "$(jq '.data.read.policy.revision' "$RUN_DIR/production-status-before.json")"

# The earlier runs' own records: G1's genesis, run 3's reset head (on run 2's) and run 3's proven terminal Off.
STAGE=prior_evidence
latest_receipt() {
  local id="$1" outcome="$2" candidate found=""
  for candidate in "$SCRIPT_DIR"/runs/*/receipt.json; do
    [[ -f "$candidate" ]] || continue
    if jq -e --arg id "$id" --arg outcome "$outcome" --arg repo "$3" '.id == $id and ($outcome == "" or .outcome == $outcome) and ($repo == "" or .githubRepository == $repo)' "$candidate" >/dev/null 2>&1; then found="$candidate"; fi
  done
  printf '%s' "$found"
}
G1_RECEIPT="$(latest_receipt "$G1_ID" succeeded "$REPO")"
[[ -n "$G1_RECEIPT" ]] || refuse "no succeeded G1 ($G1_ID) receipt exists for $REPO; this script resets only the fixture G1 prepared"
GENESIS="$(jq -r '.rootCommit // empty' "$G1_RECEIPT")"
[[ "$GENESIS" =~ ^[0-9a-f]{40}$ ]] || refuse "the G1 receipt $G1_RECEIPT records no genesis commit"
record_str g1Receipt "$G1_RECEIPT"
record_str genesis "$GENESIS"
RUN3_RESET_RECEIPT="$(latest_receipt "$RUN3_RESET_ID" succeeded "$REPO")"
[[ -n "$RUN3_RESET_RECEIPT" ]] && jq -e --arg head "$RUN3_HEAD" --arg run2 "$RUN2_HEAD" --arg genesis "$GENESIS" '.newHead == $head and .previousMain == $run2 and .genesis == $genesis and .remoteMainAfter == $head' "$RUN3_RESET_RECEIPT" >/dev/null \
  || refuse "run 3's reset is not recorded at $RUN3_HEAD on run 2's reset head $RUN2_HEAD and genesis $GENESIS: the latest succeeded $RUN3_RESET_ID receipt for $REPO is ${RUN3_RESET_RECEIPT:-missing}"
record_str run3ResetReceipt "$RUN3_RESET_RECEIPT"
record_str previousMain "$RUN3_HEAD"
# The latest run-3 G8 that got past its launch guard (a launch-guard refusal ran
# no Arcadia command) must have succeeded with Off confirmed, at or after run 3's terminal Off.
RUN3_G8_RECEIPT=""
for candidate in "$SCRIPT_DIR"/runs/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$RUN3_G8_ID" '.id == $id and .stage != "launch_context"' "$candidate" >/dev/null 2>&1; then RUN3_G8_RECEIPT="$candidate"; fi
done
[[ -n "$RUN3_G8_RECEIPT" ]] && jq -e --arg min "$RUN3_G8_MIN_RUN_ID" '.outcome == "succeeded" and .offState == "confirmed" and (.runId | type == "string") and .runId >= $min' "$RUN3_G8_RECEIPT" >/dev/null \
  || refuse "run 3's terminal Off is not proven: the latest $RUN3_G8_ID receipt past its launch guard (${RUN3_G8_RECEIPT:-none}) is not a succeeded, Off-confirmed run at or after $RUN3_G8_MIN_RUN_ID; run that G8 from the Terminal panel or /runs first"
record_str run3TerminalOffReceipt "$RUN3_G8_RECEIPT"

STAGE=local_fixture
[[ -f "$FIXTURE_REPO/$MANIFEST_NAME" ]] || refuse "$FIXTURE_REPO is not the G1 fixture (no $MANIFEST_NAME)"
jq -e --arg repo "$REPO" --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --argjson actions "$ACTIONS_JSON" --arg provider "$PROVIDER" \
  '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .githubRepository == $repo and .fixtureProject == $p and .fixturePlan == $plan and .actions == $actions and .provider == $provider' \
  "$FIXTURE_REPO/$MANIFEST_NAME" >/dev/null || refuse "the fixture manifest does not name $REPO with the exact three-Action scope"
[[ "$(fx branch --show-current)" == main ]] || refuse "the local fixture is not on main"
[[ -z "$(fx status --porcelain --untracked-files=all)" ]] || refuse "the local fixture working tree is dirty or has untracked files"
ORIGIN="$(fx remote get-url origin)" || refuse "the local fixture has no origin remote"
[[ "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ]] || refuse "the local fixture origin is $ORIGIN, not $REPO"
[[ "$(fx rev-list --max-parents=0 HEAD)" == "$GENESIS" ]] || refuse "the local fixture's single root is not G1's genesis $GENESIS"
[[ "$(fx rev-parse --verify -q "$RUN3_HEAD^{commit}" 2>/dev/null)" == "$RUN3_HEAD" && "$(fx rev-parse "$RUN3_HEAD^" 2>/dev/null)" == "$RUN2_HEAD" && "$(fx rev-parse "$RUN2_HEAD^" 2>/dev/null)" == "$GENESIS" ]] \
  || refuse "the local fixture does not hold run 3's reset head $RUN3_HEAD as one commit on run 2's reset head $RUN2_HEAD, itself one commit on genesis $GENESIS"
PROJECT_MARKER="$FIXTURE_REPO/.git/arcadia-three-action-project-id"
[[ -s "$PROJECT_MARKER" ]] || refuse "the local fixture has no G1 registration marker (.git/arcadia-three-action-project-id)"
MARKER_ID="$(<"$PROJECT_MARKER")"
LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
record_str localMainBefore "$LOCAL_MAIN"

# Read-only: the registered Project is exactly this fixture, and no fixture Session is live.
STAGE=registration
cat > "$RUN_DIR/probe-registration.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { getProjectBySlug, getProjectMetadata } from "./src/db/repositories.ts";
import { listActiveAgentSessions } from "./src/sessions/index.ts";
const [workspace, slug] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const project = getProjectBySlug(db, slug);
  const metadata = project ? getProjectMetadata(db, project.id) : null;
  const active = listActiveAgentSessions(db);
  return {
    projectId: project?.id ?? null,
    repoPath: metadata?.repo_path ?? null,
    active: active.length,
    fixtureActive: active.filter((s) => s.project_slug === slug).map((s) => s.id)
  };
})));
NODE
REGISTRATION="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" < "$RUN_DIR/probe-registration.mjs")" || refuse "the fixture Project's registration and Session leases could not be read"
printf '%s\n' "$REGISTRATION" > "$RUN_DIR/registration.json"
FIXTURE_REAL="$(cd "$FIXTURE_REPO" && pwd -P)"
jq -e --arg id "$MARKER_ID" --arg root "$FIXTURE_REPO" --arg real "$FIXTURE_REAL" '.projectId == $id and (.repoPath == $root or .repoPath == $real)' <<<"$REGISTRATION" >/dev/null \
  || refuse "Project $FIXTURE_PROJECT is not registered from $FIXTURE_REPO under G1's marker $MARKER_ID: $(jq -c '{projectId, repoPath}' <<<"$REGISTRATION")"
jq -e '.fixtureActive == []' <<<"$REGISTRATION" >/dev/null || refuse "fixture Sessions are prepared or running: $(jq -c '.fixtureActive' <<<"$REGISTRATION")"
record_str projectId "$MARKER_ID"

STAGE=github_repository
LOGIN="$(ghx api user --jq .login)" || refuse "GitHub CLI is not authenticated or GitHub is unreachable (gh api user failed)"
[[ "$(lower "$LOGIN")" == "$(lower "$OWNER")" ]] || refuse "repository owner $OWNER is not the authenticated GitHub user $LOGIN"
VIEW="$(ghx repo view "$REPO" --json name,owner,visibility,isPrivate,isArchived,isFork,description)" || refuse "GitHub could not report $REPO"
printf '%s\n' "$VIEW" > "$RUN_DIR/github-repository.json"
jq -e '.isPrivate == true and (.visibility | ascii_upcase) == "PRIVATE"' <<<"$VIEW" >/dev/null || refuse "$REPO is not private"
jq -e '.isArchived == false and .isFork == false' <<<"$VIEW" >/dev/null || refuse "$REPO is archived or a fork"
jq -e --arg d "$REPO_DESCRIPTION" '.description == $d' <<<"$VIEW" >/dev/null || refuse "$REPO does not carry G1's disposable-fixture description, so G1 did not create it"
remote_main() { ghx api "repos/$REPO/commits/main" --jq .sha; }
REMOTE_MAIN="$(remote_main)" || refuse "could not read main of $REPO"
record_str remoteMainBefore "$REMOTE_MAIN"

# Runs 1, 2 and 3's candidates must be exactly as G8 reconciled them, locally, on
# GitHub and as their pull request heads, before and after this run.
CANDIDATES=""
check_candidate() {
  local label="$1" branch="$2" tip="$3" number="$4" local_tip remote_tip pr
  local_tip="$(fx rev-parse --verify -q "refs/heads/$branch" 2>/dev/null || true)"
  [[ "$local_tip" == "$tip" ]] || refuse "local branch $branch is ${local_tip:-missing}, not $label's preserved $tip"
  remote_tip="$(ghx api "repos/$REPO/branches/$branch" --jq .commit.sha)" || refuse "could not read $branch on $REPO"
  [[ "$remote_tip" == "$tip" ]] || refuse "GitHub branch $branch is $remote_tip, not $label's preserved $tip"
  pr="$(ghx api "repos/$REPO/pulls/$number")" || refuse "could not read pull request #$number of $REPO"
  jq -e --arg tip "$tip" --arg branch "$branch" '.head.sha == $tip and .head.ref == $branch' <<<"$pr" >/dev/null \
    || refuse "pull request #$number is not $label's candidate at $tip on $branch: $(jq -c '{head: .head.ref, sha: .head.sha}' <<<"$pr" 2>/dev/null)"
  CANDIDATES="${CANDIDATES:+$CANDIDATES,}$(jq -nc --arg label "$label" --arg branch "$branch" --arg localTip "$local_tip" --arg remoteTip "$remote_tip" --argjson pr "$pr" --argjson number "$number" \
    '{run: $label, branch: $branch, localTip: $localTip, remoteTip: $remoteTip, pullRequest: $number, prTip: $pr.head.sha, prState: $pr.state}')"
}
STAGE=candidates
check_candidate "run 1" "$RUN1_BRANCH" "$RUN1_TIP" "$RUN1_PR"
check_candidate "run 2" "$RUN2_BRANCH" "$RUN2_TIP" "$RUN2_PR"
check_candidate "run 3" "$RUN3_BRANCH" "$RUN3_TIP" "$RUN3_PR"
record "candidatesBefore" "[$CANDIDATES]"

# The amendment is rendered from run 3's reset tree into dot-directories of the
# run directory, which Arcadia's discovery skips, and validated there by
# Arcadia's real discovery, a dry-run docs sync in a throwaway workspace,
# resolveReadySet and requirementIdentity, before any settle, commit or push.
STAGE=render_amendment
# Resuming a reset commit made on an earlier UTC date renders with that
# commit's own date, so the resumed commit is compared byte for byte.
if [[ "$LOCAL_MAIN" != "$RUN3_HEAD" && "$(fx rev-parse "$LOCAL_MAIN^" 2>/dev/null)" == "$RUN3_HEAD" && "$(fx log -1 --format=%s "$LOCAL_MAIN")" == "$RESET_SUBJECT" ]]; then
  COMMIT_DATE="$(fx show "$LOCAL_MAIN:$PLAN_FILE" 2>/dev/null | grep -- "$DATE_LINE_PATTERN" | head -n 1 || true)"
  [[ -n "$COMMIT_DATE" ]] && RESET_DATE="${COMMIT_DATE#updated: }"
fi
GENESIS_DIR="$RUN_DIR/.fixture-genesis"
BEFORE_DIR="$RUN_DIR/.fixture-previous"
AMEND_DIR="$RUN_DIR/.fixture-amended"
mkdir -p "$GENESIS_DIR" "$BEFORE_DIR" "$AMEND_DIR"
fx archive "$GENESIS" | tar -x -C "$GENESIS_DIR"
fx archive "$RUN3_HEAD" | tar -x -C "$BEFORE_DIR"
fx archive "$RUN3_HEAD" | tar -x -C "$AMEND_DIR"
[[ "$(grep -cxF -- "$OLD_NEXT_ACTION" "$BEFORE_DIR/$PLAN_FILE" || true)" == 1 ]] || refuse "run 3's reset Plan does not contain write-start-marker's run-3 next_action line exactly once"
[[ "$(grep -cF -- "rehearsal run 4" "$BEFORE_DIR/$PLAN_FILE" || true)" == 0 ]] || refuse "run 3's reset Plan already mentions rehearsal run 4"
[[ "$(grep -c -- "$DATE_LINE_PATTERN" "$BEFORE_DIR/$PLAN_FILE" || true)" == 1 ]] || refuse "run 3's reset Plan does not carry exactly one updated: date line"
PLAN_DATE="$(grep -- "$DATE_LINE_PATTERN" "$BEFORE_DIR/$PLAN_FILE")"
PLAN_DATE="${PLAN_DATE#updated: }"
record_str planUpdatedBefore "$PLAN_DATE"
# A reset date before the Plan's own date would make docs sync skip the
# amendment as older than the record; an equal date applies (stalenessOf in
# src/docs/sync.ts compares days and lets same-day edits through).
if [[ "$RESET_DATE" < "$PLAN_DATE" ]]; then
  RECOVERY="This host's UTC date ($RESET_DATE) is before the fixture Plan's updated: date ($PLAN_DATE), so docs sync would skip the amended Action as older than its record and the Grant would dispatch nothing. Correct the host clock, or rerun on or after $PLAN_DATE UTC. Do not hand-edit the date."
  refuse "the reset's UTC date $RESET_DATE is before the Plan's updated: $PLAN_DATE; docs sync would skip the amendment"
fi
awk -v old="$OLD_NEXT_ACTION" -v new="$NEW_NEXT_ACTION" -v date="updated: $RESET_DATE" -v pattern="$DATE_LINE_PATTERN" \
  '{ if ($0 == old) print new; else if ($0 ~ pattern) print date; else print }' "$BEFORE_DIR/$PLAN_FILE" > "$AMEND_DIR/$PLAN_FILE"
CHANGED="$( (cd "$RUN_DIR" && diff -rq .fixture-previous .fixture-amended) | tr '\n' ' ' || true)"
[[ "$CHANGED" == "Files .fixture-previous/$PLAN_FILE and .fixture-amended/$PLAN_FILE differ " ]] || refuse "the rendered amendment changed more than the fixture Plan: $CHANGED"
# Apart from the next_action line and the Plan's own updated: date, every line is identical.
others() { grep -vxF -e "$OLD_NEXT_ACTION" -e "$NEW_NEXT_ACTION" -- "$1" | grep -v -- "$DATE_LINE_PATTERN" || true; }
cmp -s <(others "$BEFORE_DIR/$PLAN_FILE") <(others "$AMEND_DIR/$PLAN_FILE") || refuse "the rendered amendment changed a fixture Plan line other than write-start-marker's next_action and the Plan's updated: date"
[[ "$(grep -cxF -- "$NEW_NEXT_ACTION" "$AMEND_DIR/$PLAN_FILE" || true)" == 1 && "$(grep -cxF -- "updated: $RESET_DATE" "$AMEND_DIR/$PLAN_FILE" || true)" == 1 ]] || refuse "the rendered amendment does not carry the run-4 next_action and the reset date exactly once"
AMENDED_BLOB="$(git hash-object "$AMEND_DIR/$PLAN_FILE")"
record_str amendedPlanBlob "$AMENDED_BLOB"
record_str planUpdated "$RESET_DATE"

STAGE=validate_amendment
cat > "$RUN_DIR/validate-amendment.mjs" <<'NODE'
import { initWorkspace } from "./src/workspace/initWorkspace.ts";
import { withDatabase } from "./src/db/connection.ts";
import { createProjectWithInitialWork } from "./src/db/repositories.ts";
import { syncProjectDocs } from "./src/docs/sync.ts";
import { discoverDocs } from "./src/docs/discover.ts";
import { resolveReadySet } from "./src/docs/dispatch.ts";
import { requirementIdentity } from "./src/sessions/roleLineage.ts";
const [genesisRoot, beforeRoot, fixtureRoot, scratchWorkspace, name, plan] = process.argv.slice(2);
const describe = (error) => `${error.relativePath}${error.field ? ` (${error.field})` : ""}: ${error.message}`;
initWorkspace(scratchWorkspace);
const sync = withDatabase(scratchWorkspace, (db) => {
  const { project } = createProjectWithInitialWork(db, {
    name, mission: "Disposable three-Action rehearsal fixture.", goal: "Disposable rehearsal fixture.", status: "active",
    currentMilestone: "Run the bounded three-Action rehearsal", nextAction: "Import fixture documents", workClassification: "agent"
  });
  return { slug: project.slug, result: syncProjectDocs(db, project, { apply: false, repoRoot: fixtureRoot }) };
});
const planOf = (root) => {
  const discovered = discoverDocs(root);
  const doc = discovered.docs.find((entry) => entry.type === "plan" && entry.slug === plan);
  return { discovered, doc };
};
const genesis = planOf(genesisRoot);
const before = planOf(beforeRoot);
const after = planOf(fixtureRoot);
const projectDoc = after.discovered.docs.find((doc) => doc.type === "project");
const identities = (doc, project) => doc ? Object.fromEntries(doc.actions.map((action) => {
  const identity = requirementIdentity({ projectSlug: project, planSlug: plan, action });
  return [action.id, { requirementId: identity.requirementId, inputRevision: identity.inputRevision, criteriaFingerprint: identity.criteriaFingerprint }];
})) : null;
const readySet = resolveReadySet(fixtureRoot, sync.slug);
console.log(JSON.stringify({
  importSlug: sync.slug,
  errorCount: sync.result.errors.length,
  errors: sync.result.errors.map(describe).concat(after.discovered.errors.map(describe)),
  rejected: sync.result.rejected,
  beforeErrors: before.discovered.errors.map(describe).concat(genesis.discovered.errors.map(describe)),
  project: projectDoc ? { slug: projectDoc.slug, activePlan: projectDoc.activePlan, currentAction: projectDoc.currentAction } : null,
  actions: after.doc ? after.doc.actions.map((action) => ({ id: action.id, status: action.status, responsibility: action.responsibility, dependsOn: action.dependsOn })) : null,
  readySetBlockers: readySet.blockers.map(describe),
  ready: readySet.ready.map((entry) => entry.actionId),
  candidates: readySet.candidates.map((entry) => ({ id: entry.actionId, ready: entry.ready, gate: entry.gate, blockers: entry.blockers.map((blocker) => blocker.field) })),
  beforeActions: before.doc ? before.doc.actions : null,
  afterActions: after.doc ? after.doc.actions : null,
  genesisIdentity: identities(genesis.doc, sync.slug),
  beforeIdentity: identities(before.doc, sync.slug),
  afterIdentity: identities(after.doc, sync.slug)
}));
NODE

# Every way the amendment can fail, joined; empty means valid. The first
# block is G1's own fixture rules, unchanged: zero docs-sync errors, the
# pointer at write-start-marker, the serial chain, every Action open and
# agent-owned, write-start-marker alone ready. The second block proves the
# edit is exactly one Action's next_action, that the genesis and run-3 trees
# carry the recorded original and run-3 input revisions, and that the amendment
# gives a fourth input revision (none of the original, run-2 or run-3 ones) with
# the same criteria and changes no other Action's identity.
VALIDATION_RULES='[
  (.errors[] | "docs sync error: " + .),
  (.rejected[] | "rejected document: " + .),
  (.readySetBlockers[] | "ready-set blocker: " + .),
  (if .importSlug != $p then "project import would register slug \(.importSlug), not \($p)" else empty end),
  (if .project == null then "no PROJECT.md was discovered"
   elif .project.slug != $p or .project.activePlan != $plan or .project.currentAction != $a then "PROJECT.md does not point at \($plan)#\($a)"
   else empty end),
  (if .actions == null then "Plan \($plan) was not discovered"
   elif (.actions | map(.id)) != [$a, $b, $c] then "Plan Actions are [\(.actions | map(.id) | join(", "))], not [\($a), \($b), \($c)]"
   elif (.actions | map(.dependsOn)) != [[], [$a], [$b]] then "Plan depends_on is not the serial chain \($a) -> \($b) -> \($c)"
   elif any(.actions[]; .status != "open" or .responsibility != "agent") then "every Action must be open and agent-owned"
   else empty end),
  (if .ready != [$a] then "the ready set is [\(.ready | join(", "))], not exactly [\($a)]" else empty end),
  (.candidates[] | select(.id != $a)
   | select(.ready or .gate != null or (.blockers | length) == 0 or any(.blockers[]; endswith(".depends_on") | not))
   | "\(.id) is not gated only by depends_on"),
  (.beforeErrors[] | "genesis or run-3 discovery error: " + .),
  (if .beforeActions == null or .afterActions == null then "the run-3 or amended Plan was not discovered"
   elif (.beforeActions | map(.id)) != (.afterActions | map(.id)) then "the amendment changed the Plan Action ids"
   else
     (if (.beforeActions[1:] != .afterActions[1:]) then "the amendment changed an Action other than \($a)" else empty end),
     (if (.beforeActions[0] | del(.nextAction)) != (.afterActions[0] | del(.nextAction)) then "the amendment changed \($a) beyond its next_action" else empty end),
     (if .beforeActions[0].nextAction != $old then "the run-3 \($a) next_action is not run 3'"'"'s text" else empty end),
     (if .afterActions[0].nextAction != $new then "the amended \($a) next_action is not the run-4 text" else empty end)
   end),
  (if .genesisIdentity == null or .beforeIdentity == null or .afterIdentity == null then "requirement identities could not be computed"
   else
     (if .genesisIdentity[$a].inputRevision != $orig then "the genesis \($a) input revision is \(.genesisIdentity[$a].inputRevision), not the recorded original \($orig)" else empty end),
     (if .beforeIdentity[$a].inputRevision != $run3 then "the run-3 \($a) input revision is \(.beforeIdentity[$a].inputRevision), not the recorded run-3 \($run3)" else empty end),
     (if .afterIdentity[$a].inputRevision == $orig or .afterIdentity[$a].inputRevision == $run2 or .afterIdentity[$a].inputRevision == $run3 then "the amendment did not give \($a) a fourth requirement input revision" else empty end),
     (if .beforeIdentity[$a].criteriaFingerprint != .afterIdentity[$a].criteriaFingerprint or .genesisIdentity[$a].criteriaFingerprint != .afterIdentity[$a].criteriaFingerprint then "the amendment changed the acceptance criteria fingerprint of \($a)" else empty end),
     (if .beforeIdentity[$b] != .afterIdentity[$b] or .beforeIdentity[$c] != .afterIdentity[$c] then "the amendment changed the requirement identity of another Action" else empty end)
   end)
] | join("; ") | gsub("\\s*\\n\\s*"; " ")'
VALIDATION_OUT="$RUN_DIR/amendment-validation.json"
probe "$GENESIS_DIR" "$BEFORE_DIR" "$AMEND_DIR" "$RUN_DIR/.validation-workspace" "$FIXTURE_NAME" "$FIXTURE_PLAN" < "$RUN_DIR/validate-amendment.mjs" > "$VALIDATION_OUT" \
  || refuse "Arcadia's discovery could not run against the amended fixture (see $VALIDATION_OUT and the run log); nothing was settled, committed or pushed"
PROBLEM="$(jq -r --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --arg a "$ACTION_A" --arg b "$ACTION_B" --arg c "$ACTION_C" \
  --arg old "${OLD_NEXT_ACTION#    next_action: }" --arg new "${NEW_NEXT_ACTION#    next_action: }" --arg orig "$ORIGINAL_REVISION" --arg run2 "$RUN2_REVISION" --arg run3 "$RUN3_REVISION" "$VALIDATION_RULES" "$VALIDATION_OUT")" \
  || refuse "the amended fixture's validation output is unreadable (see $VALIDATION_OUT); nothing was settled, committed or pushed"
[[ -z "$PROBLEM" ]] || refuse "the amended fixture fails Arcadia's own validation, so nothing was settled, committed or pushed: $PROBLEM"
REQUIREMENT_ID="$(jq -r --arg a "$ACTION_A" '.afterIdentity[$a].requirementId' "$VALIDATION_OUT")"
NEW_REVISION="$(jq -r --arg a "$ACTION_A" '.afterIdentity[$a].inputRevision' "$VALIDATION_OUT")"
record "actionTextRevision" "$(jq -c --arg a "$ACTION_A" '{field: "next_action", before: .beforeActions[0].nextAction, after: .afterActions[0].nextAction,
  requirementId: .afterIdentity[$a].requirementId, inputRevisionOriginal: .genesisIdentity[$a].inputRevision, inputRevisionBefore: .beforeIdentity[$a].inputRevision,
  inputRevisionAfter: .afterIdentity[$a].inputRevision, criteriaFingerprint: .afterIdentity[$a].criteriaFingerprint}' "$VALIDATION_OUT")"
echo "Amended fixture validated by Arcadia's discovery and docs sync; $ACTION_A's requirement input revision changes from ${RUN3_REVISION:0:12} (run 3; run 2 ${RUN2_REVISION:0:12}, original ${ORIGINAL_REVISION:0:12}) to ${NEW_REVISION:0:12}."

# Read-only against the live workspace: the amended input has no attempt yet,
# so the launch gate allocates a fresh development ordinal for it. Each Session
# that settled a passed attempt for an earlier input (run 1's, run 2's or run 3's) must
# be one the tick and the Action claim step past once the input changes:
# finished, preserved by the worker (worker-tick-preserve-<session>) and clean,
# or the run-4 Grant would be consumed by a run that can never dispatch.
STAGE=lineage
cat > "$RUN_DIR/probe-lineage.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
const [workspace, requirementId, original, run2, run3, amended] = process.argv.slice(2);
const label = (revision) => revision === original ? "original" : revision === run2 ? "run2" : revision === run3 ? "run3" : revision === amended ? "amended" : "other";
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const rows = tables.has("session_role_attempts") ? db.prepare("SELECT input_revision, role, ordinal, status, terminal_receipt_json FROM session_role_attempts WHERE requirement_id = ? ORDER BY created_at, rowid").all(requirementId) : [];
  const sessionOf = (row) => { try { return JSON.parse(row.terminal_receipt_json ?? "null")?.sessionId ?? null; } catch { return null; } };
  const holders = rows.filter((row) => row.role === "development" && row.status === "passed" && (row.input_revision === original || row.input_revision === run2 || row.input_revision === run3)).map((row) => {
    const id = sessionOf(row);
    const session = id && tables.has("agent_sessions") ? db.prepare("SELECT id, status, worktree_path FROM agent_sessions WHERE id = ?").get(id) : null;
    const preserved = id && tables.has("candidate_preservation_receipts") ? Boolean(db.prepare("SELECT 1 FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${id}`)) : false;
    return { input: label(row.input_revision), sessionId: id, status: session ? session.status : "absent", worktree: session ? session.worktree_path : null, preserved };
  });
  return {
    attempts: rows.map((row) => ({ input: label(row.input_revision), role: row.role, ordinal: row.ordinal, status: row.status })),
    holders
  };
})));
NODE
LINEAGE="$(probe "$WORKSPACE" "$REQUIREMENT_ID" "$ORIGINAL_REVISION" "$RUN2_REVISION" "$RUN3_REVISION" "$NEW_REVISION" < "$RUN_DIR/probe-lineage.mjs")" || refuse "the attempt lineage could not be read"
printf '%s\n' "$LINEAGE" > "$RUN_DIR/lineage.json"
jq -e 'all(.attempts[]; .input != "amended")' <<<"$LINEAGE" >/dev/null || refuse "attempts already exist for the amended requirement input; the reset is not fresh"
record "priorAttempts" "$(jq -c '.attempts' <<<"$LINEAGE")"
record "priorHolders" "$(jq -c '.holders' <<<"$LINEAGE")"
# A passed attempt naming no Session row holds no claim or handoff; every named one must qualify.
jq -e 'all(.holders[]; .sessionId != null and (.status == "absent" or (.status != "prepared" and .status != "running" and .preserved == true)))' <<<"$LINEAGE" >/dev/null \
  || refuse "an earlier Session that passed $ACTION_A is live, unpreserved by the worker or unnamed, so run 4 could not dispatch past it: $(jq -c '.holders' <<<"$LINEAGE")"
HOLDER_COUNT="$(jq '.holders | length' <<<"$LINEAGE")"
for ((h = 0; h < HOLDER_COUNT; h++)); do
  HOLDER_WT="$(jq -r ".holders[$h].worktree // empty" <<<"$LINEAGE")"
  if [[ -n "$HOLDER_WT" && -d "$HOLDER_WT" ]]; then
    HOLDER_STATUS="$(git -C "$HOLDER_WT" status --porcelain --untracked-files=all 2>/dev/null)" || refuse "the earlier worktree $HOLDER_WT could not be read"
    [[ -z "$HOLDER_STATUS" ]] || refuse "the earlier worktree $HOLDER_WT holds uncommitted work, so its Action claim stays and run 4 could not dispatch; it was not touched"
  fi
done

# Where the fixture is: at run 3's reset head, or a reset commit this script made earlier.
STAGE=fixture_state
is_reset_commit() {
  local commit="$1"
  [[ "$(fx rev-list --count "$RUN3_HEAD..$commit" 2>/dev/null)" == 1 ]] \
    && [[ "$(fx rev-parse "$commit^" 2>/dev/null)" == "$RUN3_HEAD" ]] \
    && [[ "$(fx log -1 --format=%s "$commit")" == "$RESET_SUBJECT" ]] \
    && [[ "$(fx diff --name-only "$RUN3_HEAD" "$commit")" == "$PLAN_FILE" ]] \
    && [[ "$(fx rev-parse "$commit:$PLAN_FILE")" == "$AMENDED_BLOB" ]]
}
if [[ "$LOCAL_MAIN" == "$RUN3_HEAD" && "$REMOTE_MAIN" == "$RUN3_HEAD" ]]; then
  RESET_STATE=at_run3_head
elif [[ "$REMOTE_MAIN" == "$RUN3_HEAD" ]] && is_reset_commit "$LOCAL_MAIN"; then
  RESET_STATE=committed_unpushed
elif [[ "$LOCAL_MAIN" == "$REMOTE_MAIN" ]] && is_reset_commit "$LOCAL_MAIN"; then
  RESET_STATE=pushed
  PRIOR="$(latest_receipt "$SCRIPT_ID" succeeded "$REPO")"
  if [[ -n "$PRIOR" ]] && jq -e --arg head "$LOCAL_MAIN" '.newHead == $head' "$PRIOR" >/dev/null; then
    record_str resetState already_reset
    refuse "the reset already succeeded at fixture head $LOCAL_MAIN ($PRIOR); it is not applied twice. Run the run-4 G6 preflight next"
  fi
else
  RECOVERY="Neither main is at run 3's reset head or at this script's own reset commit, so the fixture moved by another path (for example a run-4 integration). This script never rewrites history. Read 'git -C $FIXTURE_REPO log --oneline -5 main' and the GitHub main of $REPO, and ask for a new reviewed reset if another run is wanted."
  refuse "fixture local main $LOCAL_MAIN and GitHub main $REMOTE_MAIN are not at run 3's reset head $RUN3_HEAD or this script's reset commit"
fi
record_str resetState "$RESET_STATE"

# Read-only against the live workspace: a dry-run docs sync of the amended
# tree must apply write-start-marker's new text (an "update", not skipped as
# older than its record) before anything is settled, committed or pushed.
STAGE=live_sync_preview
cat > "$RUN_DIR/probe-live-sync.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { getProjectBySlug } from "./src/db/repositories.ts";
import { syncProjectDocs } from "./src/docs/sync.ts";
const [workspace, slug, amendedRoot] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const project = getProjectBySlug(db, slug);
  if (!project) return { liveDryRun: null };
  const result = syncProjectDocs(db, project, { apply: false, repoRoot: amendedRoot });
  return {
    liveDryRun: {
      errors: result.errors.map((error) => `${error.relativePath}: ${error.message}`),
      actions: result.changes.filter((change) => change.entity === "action").map((change) => ({ ref: change.ref, action: change.action, reason: change.reason ?? null }))
    }
  };
})));
NODE
LIVE_SYNC="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" "$AMEND_DIR" < "$RUN_DIR/probe-live-sync.mjs")" || refuse "the live workspace's dry-run docs sync of the amended fixture could not run"
printf '%s\n' "$LIVE_SYNC" > "$RUN_DIR/live-sync-preview.json"
jq -e --arg ref "plan/$FIXTURE_PLAN#$ACTION_A" --arg state "$RESET_STATE" '.liveDryRun != null and (.liveDryRun.errors | length) == 0
  and (.liveDryRun.actions | map(select(.action == "skipped")) | length) == 0
  and ([.liveDryRun.actions[] | select(.ref == $ref) | .action] | length == 1 and (.[0] == "update" or (.[0] == "unchanged" and $state == "pushed")))' <<<"$LIVE_SYNC" >/dev/null \
  || refuse "the live workspace's dry-run docs sync would not apply $ACTION_A's amended text (an error, a skipped Action or no update); nothing was settled, committed or pushed: $(jq -c '.liveDryRun' <<<"$LIVE_SYNC" 2>/dev/null)"

# Issue #968: a pending Agent Ask proposal naming an in-scope Action makes the
# dispatch gate (resolveProjectTransition, through resolveOperatorGate) answer
# "decision", and the tick then launches nothing without saying why. Every
# pending item gating a fixture Action, and every pending fixture proposal,
# refuses here untouched, except exactly run 3's complete proposal: if it is
# still pending, this script rejects it through the governed settle (preview,
# then apply with that exact fingerprint, ARCADIA_WORKSPACE inline on that one
# command only); if it is already rejected or accepted, it is left as it is.
STAGE=proposal_gate
cat > "$RUN_DIR/probe-proposal-gate.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { resolveOperatorGate } from "./src/ask/operatorGate.ts";
import { listUnsettledAgentAskProposals } from "./src/ask/settlement.ts";
const [workspace, fixtureRoot, slug, actionsJson, run3Request, run4Completion] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const unsettled = listUnsettledAgentAskProposals(db);
  const requestOf = new Map(unsettled.map((row) => [row.id, row.requestId]));
  const blocking = [];
  for (const actionId of JSON.parse(actionsJson)) {
    const gate = resolveOperatorGate({ db, repoRoot: fixtureRoot, projectSlug: slug, selectedActionId: actionId });
    for (const item of gate.blocking) blocking.push({ action: actionId, kind: item.kind, id: item.id, requestId: requestOf.get(item.id) ?? null, title: item.title });
  }
  const fixturePending = unsettled.filter((row) => String(row.proposal.normalized.project).toLowerCase() === slug)
    .map((row) => ({ id: row.id, requestId: row.requestId, intent: row.proposal.normalized.intent, targetRef: row.proposal.normalized.targetRef ?? null }));
  const row = db.prepare("SELECT id, request_id, proposal_json FROM agent_ask_proposals WHERE request_id = ?").get(run3Request);
  let run3 = null;
  if (row) {
    const normalized = JSON.parse(row.proposal_json).normalized;
    const settlement = db.prepare("SELECT id, request_id, disposition FROM agent_ask_settlements WHERE proposal_id = ?").get(row.id) ?? null;
    run3 = { id: row.id, requestId: row.request_id, project: normalized.project, intent: normalized.intent, targetRef: normalized.targetRef ?? null,
      settlement: settlement ? { id: settlement.id, requestId: settlement.request_id, disposition: settlement.disposition } : null };
  }
  const run4CompletionUsed = Boolean(db.prepare("SELECT 1 FROM agent_ask_proposals WHERE request_id = ?").get(run4Completion));
  // Every fixture proposal and its disposition, for the receipt only (read-only; nothing here is acted on).
  const fixtureProposals = db.prepare("SELECT p.request_id, p.proposal_json, s.disposition FROM agent_ask_proposals p LEFT JOIN agent_ask_settlements s ON s.proposal_id = p.id ORDER BY p.rowid").all()
    .map((entry) => { let normalized = {}; try { normalized = JSON.parse(entry.proposal_json).normalized ?? {}; } catch {} return { entry, normalized }; })
    .filter(({ normalized }) => String(normalized.project).toLowerCase() === slug)
    .map(({ entry, normalized }) => ({ requestId: entry.request_id, intent: normalized.intent ?? null, targetRef: normalized.targetRef ?? null, disposition: entry.disposition ?? "pending" }));
  return { blocking, fixturePending, run3, run4CompletionUsed, fixtureProposals };
})));
NODE
read_gate() {
  probe "$WORKSPACE" "$FIXTURE_REPO" "$FIXTURE_PROJECT" "$ACTIONS_JSON" "$RUN3_PROPOSAL" "$RUN4_COMPLETION_ID" < "$RUN_DIR/probe-proposal-gate.mjs"
}
GATE="$(read_gate)" || refuse "the pending Agent Ask proposals and Decisions gating the fixture could not be read"
printf '%s\n' "$GATE" > "$RUN_DIR/proposal-gate-before.json"
record "fixtureProposalsBefore" "$(jq -c '.fixtureProposals // []' <<<"$GATE")"
FOREIGN="$(jq -c --arg run3 "$RUN3_PROPOSAL" '[(.fixturePending[] | select(.requestId != $run3) | "pending Agent Ask \(.requestId) (\(.id), \(.intent) \(.targetRef // "-"))"),
  (.blocking[] | select(.kind != "agent_ask" or .requestId != $run3) | "\(.kind) \(.id) gating \(.action): \(.title)")] | unique' <<<"$GATE")"
if [[ "$FOREIGN" != "[]" ]]; then
  RECOVERY="Pending operator items other than run 3's $RUN3_PROPOSAL gate or sit on the fixture Project: $FOREIGN. Each needs its own governed disposition (arcadia agent-ask pending lists proposals; a Decision is approved through its own path). This script settles none of them. Rerun once they are settled."
  refuse "pending operator items other than run 3's $RUN3_PROPOSAL would gate the fixture: $FOREIGN"
fi
# The run-4 agent records its completion under the id the amended next_action names; it must still be unused.
jq -e '.run4CompletionUsed == false' <<<"$GATE" >/dev/null \
  || refuse "the Agent Ask request id $RUN4_COMPLETION_ID that the run-4 next_action tells the agent to use is already used in the workspace, so run 4's completion would be skipped or refused; ask for a new reviewed reset with another id"
record_str run4CompletionRequestId "$RUN4_COMPLETION_ID"
RUN3_PROPOSAL_ID=""
PROPOSAL_STATE=""
# A settled run-3 proposal does not gate dispatch, and settling it never touched
# fixture main, which fixture_state above already proved is run 3's reset head
# (or this script's own reset commit on it); the gate is re-read below and must
# be clear. Only a pending one is rejected here. at_run3_base repeats that
# fixture_state check as defence in depth; it cannot fail after it.
at_run3_base() { [[ "$RESET_STATE" == at_run3_head || "$RESET_STATE" == committed_unpushed || "$RESET_STATE" == pushed ]]; }
if jq -e '.run3 == null' <<<"$GATE" >/dev/null; then
  PROPOSAL_STATE=absent
elif jq -e --arg sreq "$SUPERSEDE_REQUEST_ID" '.run3.settlement != null and .run3.settlement.requestId == $sreq and .run3.settlement.disposition == "rejected"' <<<"$GATE" >/dev/null; then
  PROPOSAL_STATE=already_superseded
elif jq -e '.run3.settlement != null and .run3.settlement.disposition == "rejected"' <<<"$GATE" >/dev/null; then
  # Rejected elsewhere: it no longer gates dispatch, and this script leaves it exactly as it is.
  at_run3_base || refuse "run 3's proposal is rejected but fixture main is not run 3's reset head $RUN3_HEAD or this script's reset commit on it"
  PROPOSAL_STATE=rejected_elsewhere
elif jq -e '.run3.settlement != null and .run3.settlement.disposition == "accepted"' <<<"$GATE" >/dev/null; then
  # Accepted on run 3's candidate branch (the live case: the tick settled it
  # there). It is left exactly as it is.
  at_run3_base || refuse "run 3's proposal is accepted but fixture main is not run 3's reset head $RUN3_HEAD or this script's reset commit on it"
  PROPOSAL_STATE=accepted_elsewhere
elif jq -e '.run3.settlement != null' <<<"$GATE" >/dev/null; then
  refuse "run 3's proposal $RUN3_PROPOSAL has an unrecognized settlement: $(jq -c '.run3.settlement' <<<"$GATE")"
else
  PROPOSAL_STATE=pending
fi
if [[ "$PROPOSAL_STATE" != absent ]]; then
  RUN3_PROPOSAL_ID="$(jq -r '.run3.id' <<<"$GATE")"
  [[ "$RUN3_PROPOSAL_ID" =~ ^[A-Za-z0-9_]+$ ]] || refuse "run 3's proposal row has an unexpected id: $RUN3_PROPOSAL_ID"
  jq -e --arg p "$FIXTURE_PROJECT" --arg r "$RUN3_PROPOSAL" --arg i "$RUN3_PROPOSAL_INTENT" --arg t "$RUN3_PROPOSAL_TARGET" \
    '.run3.requestId == $r and .run3.project == $p and .run3.intent == $i and .run3.targetRef == $t' <<<"$GATE" >/dev/null \
    || refuse "the proposal under $RUN3_PROPOSAL is not run 3's complete Ask as this action declares it ($RUN3_PROPOSAL_INTENT $RUN3_PROPOSAL_TARGET in $FIXTURE_PROJECT): $(jq -c '.run3' <<<"$GATE"); it was not touched"
fi

settle_run3() {
  (cd "$ARCADIA_REPO" && ARCADIA_WORKSPACE="$WORKSPACE" timeout 180 mise exec -- pnpm -s arcadia agent-ask settle --proposal "$RUN3_PROPOSAL_ID" --request-id "$SUPERSEDE_REQUEST_ID" --disposition rejected "$@" --json)
}
if [[ "$PROPOSAL_STATE" == pending ]]; then
  STAGE=supersede_proposal
  production_quiet before_settle || refuse "production left Inactive or admitted work before the proposal settle; nothing was settled"
  PREVIEW="$(settle_run3)" || PREVIEW=""
  printf '%s\n' "$PREVIEW" > "$RUN_DIR/supersede-preview.json"
  # The rejection must write no document anywhere (no fixture commit) and place nothing in the queue.
  jq -e --arg id "$RUN3_PROPOSAL_ID" --arg r "$RUN3_PROPOSAL" --arg sreq "$SUPERSEDE_REQUEST_ID" '.ok == true and .data.receipt.applied == false
    and .data.receipt.disposition == "rejected" and .data.receipt.proposalId == $id and .data.receipt.proposalRequestId == $r
    and .data.receipt.settlementRequestId == $sreq and (.data.receipt.review.documents | length) == 0
    and ((.data.receipt.queueActionKeys // []) | length) == 0 and (.data.receipt.previewFingerprint | type == "string" and test("^[0-9a-f]{64}$"))' <<<"$PREVIEW" >/dev/null 2>&1 \
    || refuse "the governed preview of rejecting $RUN3_PROPOSAL did not report exactly a document-free, queue-free rejection of that proposal; nothing was settled (see $RUN_DIR/supersede-preview.json)"
  SUPERSEDE_FINGERPRINT="$(jq -r '.data.receipt.previewFingerprint' <<<"$PREVIEW")"
  echo "Previewed rejecting run 3's pending $RUN3_PROPOSAL ($RUN3_PROPOSAL_ID): fingerprint $SUPERSEDE_FINGERPRINT."
  APPLIED="$(settle_run3 --apply --preview "$SUPERSEDE_FINGERPRINT")" || APPLIED=""
  printf '%s\n' "$APPLIED" > "$RUN_DIR/supersede-apply.json"
  if jq -e --arg id "$RUN3_PROPOSAL_ID" --arg fp "$SUPERSEDE_FINGERPRINT" '.ok == true and .data.receipt.applied == true and .data.receipt.disposition == "rejected"
      and .data.receipt.proposalId == $id and .data.receipt.previewFingerprint == $fp' <<<"$APPLIED" >/dev/null 2>&1; then
    PROPOSAL_SETTLED=true
    PROPOSAL_STATE=superseded
  else
    # The CLI's exit status is not proof either way: read the settlement back.
    GATE_AFTER_APPLY="$(read_gate)" || GATE_AFTER_APPLY='{}'
    if jq -e --arg sreq "$SUPERSEDE_REQUEST_ID" '.run3.settlement.requestId == $sreq and .run3.settlement.disposition == "rejected"' <<<"$GATE_AFTER_APPLY" >/dev/null 2>&1; then
      PROPOSAL_SETTLED=true
      PROPOSAL_STATE=superseded
    else
      refuse "the governed rejection of $RUN3_PROPOSAL (preview $SUPERSEDE_FINGERPRINT) did not apply; nothing was committed or pushed (see $RUN_DIR/supersede-apply.json)"
    fi
  fi
  echo "Rejected run 3's pending $RUN3_PROPOSAL under settlement request id $SUPERSEDE_REQUEST_ID."
fi
STAGE=proposal_gate
GATE="$(read_gate)" || refuse "the dispatch gate could not be re-read after the proposal step"
printf '%s\n' "$GATE" > "$RUN_DIR/proposal-gate-after.json"
jq -e '.blocking == [] and .fixturePending == []' <<<"$GATE" >/dev/null \
  || refuse "pending operator items still gate the fixture after the proposal step: $(jq -c '{blocking, fixturePending}' <<<"$GATE")"
record "fixtureProposalsAfter" "$(jq -c '.fixtureProposals // []' <<<"$GATE")"
record "supersededProposal" "$(jq -nc --arg requestId "$RUN3_PROPOSAL" --arg proposalId "$RUN3_PROPOSAL_ID" --arg state "$PROPOSAL_STATE" \
  --arg settlementRequestId "$SUPERSEDE_REQUEST_ID" --arg fp "$SUPERSEDE_FINGERPRINT" --argjson settlement "$(jq -c '.run3.settlement // null' <<<"$GATE")" \
  '{requestId: $requestId, proposalId: (if $proposalId == "" then null else $proposalId end), state: $state, settlementRequestId: $settlementRequestId,
    previewFingerprint: (if $fp == "" then null else $fp end), settlement: $settlement}')"

if [[ "$RESET_STATE" == at_run3_head ]]; then
  STAGE=commit
  # Exactly the validated bytes: one file, one line plus the date.
  cp "$AMEND_DIR/$PLAN_FILE" "$FIXTURE_REPO/$PLAN_FILE"
  [[ "$(fx status --porcelain --untracked-files=all)" == " M $PLAN_FILE" ]] || refuse "the working tree change is not exactly the fixture Plan"
  fx add -- "$PLAN_FILE"
  fx -c user.name='Arcadia Rehearsal Fixture' -c user.email='rehearsal@localhost' commit -q -m "$RESET_SUBJECT" \
    -m "Rewrites only write-start-marker's next_action so its requirement input revision changes a fourth time; acceptance criteria, the other Actions and the run-1, run-2 and run-3 candidates are unchanged."
  LOCAL_COMMITTED=true
  LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
  is_reset_commit "$LOCAL_MAIN" || refuse "the new fixture commit is not exactly the validated amendment on run 3's reset head"
fi
NEW_HEAD="$LOCAL_MAIN"
record_str newHead "$NEW_HEAD"

if [[ "$RESET_STATE" != pushed ]]; then
  STAGE=push
  production_quiet before_push || refuse "production left Inactive or admitted work before the push; nothing was pushed"
  REMOTE_CHANGED=true
  # Never forced: a GitHub main that moved off run 3's reset head makes this push fail closed.
  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main
fi
REMOTE_AFTER="$(remote_main)" || refuse "could not read main of $REPO after the push"
[[ "$REMOTE_AFTER" == "$NEW_HEAD" ]] || refuse "GitHub main ($REMOTE_AFTER) is not the reset head ($NEW_HEAD)"
record_str remoteMainAfter "$REMOTE_AFTER"

STAGE=candidates_after
CANDIDATES=""
check_candidate "run 1" "$RUN1_BRANCH" "$RUN1_TIP" "$RUN1_PR"
check_candidate "run 2" "$RUN2_BRANCH" "$RUN2_TIP" "$RUN2_PR"
check_candidate "run 3" "$RUN3_BRANCH" "$RUN3_TIP" "$RUN3_PR"
record "candidatesAfter" "[$CANDIDATES]"

STAGE=docs_sync
SYNC="$(arcadia docs sync --project "$FIXTURE_PROJECT" --apply --json)" || SYNC=""
printf '%s\n' "$SYNC" > "$RUN_DIR/docs-sync.json"
jq -e '.ok == true and .data.errorCount == 0' <<<"$SYNC" >/dev/null 2>&1 || refuse "docs sync reported errors although the amended fixture validated before the push; see $RUN_DIR/docs-sync.json"
# The Actions must actually sync: a skipped change would leave the old text in the workspace.
# "unchanged" is accepted only when resuming a pushed reset an earlier run already synced.
jq -e --arg ref "plan/$FIXTURE_PLAN#$ACTION_A" --arg state "$RESET_STATE" '[.data.projects[].changes[] | select(.entity == "action")] as $actions
  | ($actions | map(select(.action == "skipped")) | length) == 0
  and ([$actions[] | select(.ref == $ref) | .action] | length == 1 and (.[0] == "update" or (.[0] == "unchanged" and $state == "pushed")))' <<<"$SYNC" >/dev/null \
  || refuse "docs sync did not apply $ACTION_A's amended text (an Action change was skipped or missing); see $RUN_DIR/docs-sync.json"
WORK="$(arcadia work list --json)"
for action in "$ACTION_A" "$ACTION_B" "$ACTION_C"; do
  jq -e --arg ref "plan/$FIXTURE_PLAN#$action" '[.data.workItems[]? | select(.doc_ref == $ref)] | length == 1' <<<"$WORK" >/dev/null || refuse "Action $action is not synced exactly once after the reset"
done

STAGE=complete
REASON=""
record "fixtureCommitted" "$LOCAL_COMMITTED"
record "githubRepositoryChanged" "$REMOTE_CHANGED"
record "proposalSettledByThisRun" "$PROPOSAL_SETTLED"
write_receipt succeeded
echo "RESET: fixture $REPO main is now $NEW_HEAD (was run 3's reset head $RUN3_HEAD); only $ACTION_A's next_action (and the Plan date) changed."
echo "Run 3's proposal $RUN3_PROPOSAL: $PROPOSAL_STATE. Runs 1, 2 and 3's branches and pull requests #$RUN1_PR, #$RUN2_PR and #$RUN3_PR are unchanged. Production untouched."
echo "Next: run the G6 preflight preflight-three-action-rehearsal-run4-2026-10-05 (it binds this receipt)."
echo "Receipt: $RECEIPT"
