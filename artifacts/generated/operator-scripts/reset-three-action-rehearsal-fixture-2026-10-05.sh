#!/usr/bin/env bash
# Reset the disposable three-Action rehearsal fixture for rehearsal run 2.
# A passed development attempt for an unchanged requirement input is never
# relaunched (src/sessions/roleLineage.ts), so run 2 needs a new input revision
# for write-start-marker. This script rewrites only that Action's next_action
# line in the fixture Plan (and the Plan's own `updated:` date, without which
# docs sync skips the change as older than the synced record), validates the amended fixture with Arcadia's own
# discovery, docs-sync and requirementIdentity code before any commit or push,
# commits it once on fixture main, pushes it without force, runs docs sync and
# writes a receipt carrying the new fixture head. It never previews, activates
# or deactivates production, creates or presses a Grant, touches another Action,
# the run-1 candidate branch or its pull request, restarts anything, or
# launches a Session.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="reset-three-action-rehearsal-fixture-2026-10-05"
G1_ID="prepare-three-action-rehearsal-fixture-2026-10-04"
RUN1_G8_ID="restore-terminal-off-three-action-rehearsal-2026-10-04"
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
# Run 1's preserved candidate: left exactly as it is, locally and on GitHub.
RUN1_BRANCH="claude/write-start-marker-20261004T170245861Z"
RUN1_TIP="58bcd9155cf64836994045ca63a7707d8b9ebe75"
RUN1_PR=1
# The one line this script changes. Only next_action feeds the requirement
# input revision among the Action's prose fields (title does not); the
# acceptance criteria, responsibility and execution stay byte-identical, so
# the marker contract and its verdict criteria are unchanged.
OLD_NEXT_ACTION='    next_action: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline.'
NEW_NEXT_ACTION='    next_action: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline (rehearsal run 2, from the reset fixture main; the run 1 attempts and candidate stay as evidence).'
RESET_SUBJECT="Reset write-start-marker for three-Action rehearsal run 2"
# docs sync applies a document only when its `updated:` date is not older than
# the synced record's, so the Plan carries the reset's UTC date.
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
    echo "was restarted and no Session was launched. The run-1 branch $RUN1_BRANCH and pull request #$RUN1_PR were not touched."
    [[ -z "$RESET_STATE" ]] || echo "Fixture state found at the start of this run: $RESET_STATE."
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
      echo "Correct the named precondition and rerun. Do not edit the script, the fixture Plan or the fixture history by hand."
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

echo "== Reset the three-Action rehearsal fixture for run 2 (no production change) =="

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
record_str candidateBranch "$RUN1_BRANCH"
record "pullRequest" "$RUN1_PR"

STAGE=preflight
for tool in git jq mise gh timeout node tar; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
[[ "$(git -C "$ARCADIA_REPO" rev-parse --show-toplevel 2>/dev/null)" == "$ARCADIA_REPO" ]] || refuse "the operator-script library is not inside the Arcadia checkout"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || refuse "the Arcadia checkout must be on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean"
[[ -z "${ARCADIA_WORKSPACE+x}" ]] || refuse "ARCADIA_WORKSPACE is set in this shell, so the workspace would not resolve from user config; run 'unset ARCADIA_WORKSPACE' and rerun"
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

# Run 1's own records: G1's genesis for this repository and run 1's proven terminal Off.
STAGE=run1_evidence
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
record_str previousMain "$GENESIS"
RUN1_G8_RECEIPT="$(latest_receipt "$RUN1_G8_ID" "" "")"
[[ -n "$RUN1_G8_RECEIPT" ]] && jq -e '.outcome == "succeeded" and .offState == "confirmed"' "$RUN1_G8_RECEIPT" >/dev/null \
  || refuse "run 1's terminal Off is not proven: the latest $RUN1_G8_ID receipt (${RUN1_G8_RECEIPT:-none}) did not succeed; rerun that G8 for run 1 first"
record_str run1TerminalOffReceipt "$RUN1_G8_RECEIPT"

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

# Run 1's candidate must be exactly as G8 reconciled it, locally and on GitHub,
# before and after this run.
check_run1_candidate() {
  local local_tip remote_tip pr
  local_tip="$(fx rev-parse --verify -q "refs/heads/$RUN1_BRANCH" 2>/dev/null || true)"
  [[ "$local_tip" == "$RUN1_TIP" ]] || refuse "local branch $RUN1_BRANCH is ${local_tip:-missing}, not run 1's preserved $RUN1_TIP"
  remote_tip="$(ghx api "repos/$REPO/branches/$RUN1_BRANCH" --jq .commit.sha)" || refuse "could not read $RUN1_BRANCH on $REPO"
  [[ "$remote_tip" == "$RUN1_TIP" ]] || refuse "GitHub branch $RUN1_BRANCH is $remote_tip, not run 1's preserved $RUN1_TIP"
  pr="$(ghx api "repos/$REPO/pulls/$RUN1_PR")" || refuse "could not read pull request #$RUN1_PR of $REPO"
  jq -e --arg tip "$RUN1_TIP" --arg branch "$RUN1_BRANCH" '.head.sha == $tip and .head.ref == $branch' <<<"$pr" >/dev/null \
    || refuse "pull request #$RUN1_PR is not run 1's candidate at $RUN1_TIP on $RUN1_BRANCH: $(jq -c '{head: .head.ref, sha: .head.sha}' <<<"$pr" 2>/dev/null)"
  PR_TIP="$(jq -r '.head.sha' <<<"$pr")"
  PR_STATE="$(jq -r '.state' <<<"$pr")"
}
STAGE=run1_candidate
check_run1_candidate
record_str candidateTip "$RUN1_TIP"
record_str prTip "$PR_TIP"
record_str prStateBefore "$PR_STATE"

# The amendment is rendered from G1's genesis tree into dot-directories of the
# run directory, which Arcadia's discovery skips, and validated there by
# Arcadia's real discovery, a dry-run docs sync in a throwaway workspace,
# resolveReadySet and requirementIdentity, before any commit or push.
STAGE=render_amendment
# Resuming a reset commit made on an earlier UTC date renders with that
# commit's own date, so the resumed commit is compared byte for byte.
if [[ "$LOCAL_MAIN" != "$GENESIS" && "$(fx rev-parse "$LOCAL_MAIN^" 2>/dev/null)" == "$GENESIS" && "$(fx log -1 --format=%s "$LOCAL_MAIN")" == "$RESET_SUBJECT" ]]; then
  COMMIT_DATE="$(fx show "$LOCAL_MAIN:$PLAN_FILE" 2>/dev/null | grep -- "$DATE_LINE_PATTERN" | head -n 1 || true)"
  [[ -n "$COMMIT_DATE" ]] && RESET_DATE="${COMMIT_DATE#updated: }"
fi
BEFORE_DIR="$RUN_DIR/.fixture-genesis"
AMEND_DIR="$RUN_DIR/.fixture-amended"
mkdir -p "$BEFORE_DIR" "$AMEND_DIR"
fx archive "$GENESIS" | tar -x -C "$BEFORE_DIR"
fx archive "$GENESIS" | tar -x -C "$AMEND_DIR"
[[ "$(grep -cxF -- "$OLD_NEXT_ACTION" "$BEFORE_DIR/$PLAN_FILE" || true)" == 1 ]] || refuse "the genesis Plan does not contain write-start-marker's original next_action line exactly once"
[[ "$(grep -cF -- "rehearsal run 2" "$BEFORE_DIR/$PLAN_FILE" || true)" == 0 ]] || refuse "the genesis Plan already mentions rehearsal run 2"
[[ "$(grep -c -- "$DATE_LINE_PATTERN" "$BEFORE_DIR/$PLAN_FILE" || true)" == 1 ]] || refuse "the genesis Plan does not carry exactly one updated: date line"
awk -v old="$OLD_NEXT_ACTION" -v new="$NEW_NEXT_ACTION" -v date="updated: $RESET_DATE" -v pattern="$DATE_LINE_PATTERN" \
  '{ if ($0 == old) print new; else if ($0 ~ pattern) print date; else print }' "$BEFORE_DIR/$PLAN_FILE" > "$AMEND_DIR/$PLAN_FILE"
CHANGED="$( (cd "$RUN_DIR" && diff -rq .fixture-genesis .fixture-amended) | tr '\n' ' ' || true)"
[[ "$CHANGED" == "Files .fixture-genesis/$PLAN_FILE and .fixture-amended/$PLAN_FILE differ " ]] || refuse "the rendered amendment changed more than the fixture Plan: $CHANGED"
# Apart from the next_action line and the Plan's own updated: date, every line is identical.
others() { grep -vxF -e "$OLD_NEXT_ACTION" -e "$NEW_NEXT_ACTION" -- "$1" | grep -v -- "$DATE_LINE_PATTERN" || true; }
cmp -s <(others "$BEFORE_DIR/$PLAN_FILE") <(others "$AMEND_DIR/$PLAN_FILE") || refuse "the rendered amendment changed a fixture Plan line other than write-start-marker's next_action and the Plan's updated: date"
[[ "$(grep -cxF -- "$NEW_NEXT_ACTION" "$AMEND_DIR/$PLAN_FILE" || true)" == 1 && "$(grep -cxF -- "updated: $RESET_DATE" "$AMEND_DIR/$PLAN_FILE" || true)" == 1 ]] || refuse "the rendered amendment does not carry the run-2 next_action and the reset date exactly once"
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
const [beforeRoot, fixtureRoot, scratchWorkspace, name, plan] = process.argv.slice(2);
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
  beforeErrors: before.discovered.errors.map(describe),
  project: projectDoc ? { slug: projectDoc.slug, activePlan: projectDoc.activePlan, currentAction: projectDoc.currentAction } : null,
  actions: after.doc ? after.doc.actions.map((action) => ({ id: action.id, status: action.status, responsibility: action.responsibility, dependsOn: action.dependsOn })) : null,
  readySetBlockers: readySet.blockers.map(describe),
  ready: readySet.ready.map((entry) => entry.actionId),
  candidates: readySet.candidates.map((entry) => ({ id: entry.actionId, ready: entry.ready, gate: entry.gate, blockers: entry.blockers.map((blocker) => blocker.field) })),
  beforeActions: before.doc ? before.doc.actions : null,
  afterActions: after.doc ? after.doc.actions : null,
  beforeIdentity: identities(before.doc, sync.slug),
  afterIdentity: identities(after.doc, sync.slug)
}));
NODE

# Every way the amendment can fail, joined; empty means valid. The first
# block is G1's own fixture rules, unchanged: zero docs-sync errors, the
# pointer at write-start-marker, the serial chain, every Action open and
# agent-owned, write-start-marker alone ready. The second block proves the
# edit is exactly one Action's next_action and that it changes that Action's
# requirement input revision and nothing else's.
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
  (.beforeErrors[] | "genesis discovery error: " + .),
  (if .beforeActions == null or .afterActions == null then "the genesis or amended Plan was not discovered"
   elif (.beforeActions | map(.id)) != (.afterActions | map(.id)) then "the amendment changed the Plan Action ids"
   else
     (if (.beforeActions[1:] != .afterActions[1:]) then "the amendment changed an Action other than \($a)" else empty end),
     (if (.beforeActions[0] | del(.nextAction)) != (.afterActions[0] | del(.nextAction)) then "the amendment changed \($a) beyond its next_action" else empty end),
     (if .beforeActions[0].nextAction != $old then "the genesis \($a) next_action is not the original text" else empty end),
     (if .afterActions[0].nextAction != $new then "the amended \($a) next_action is not the run-2 text" else empty end)
   end),
  (if .beforeIdentity == null or .afterIdentity == null then "requirement identities could not be computed"
   else
     (if .beforeIdentity[$a].inputRevision == .afterIdentity[$a].inputRevision then "the amendment did not change the requirement input revision of \($a)" else empty end),
     (if .beforeIdentity[$a].criteriaFingerprint != .afterIdentity[$a].criteriaFingerprint then "the amendment changed the acceptance criteria fingerprint of \($a)" else empty end),
     (if .beforeIdentity[$b] != .afterIdentity[$b] or .beforeIdentity[$c] != .afterIdentity[$c] then "the amendment changed the requirement identity of another Action" else empty end)
   end)
] | join("; ") | gsub("\\s*\\n\\s*"; " ")'
VALIDATION_OUT="$RUN_DIR/amendment-validation.json"
probe "$BEFORE_DIR" "$AMEND_DIR" "$RUN_DIR/.validation-workspace" "$FIXTURE_NAME" "$FIXTURE_PLAN" < "$RUN_DIR/validate-amendment.mjs" > "$VALIDATION_OUT" \
  || refuse "Arcadia's discovery could not run against the amended fixture (see $VALIDATION_OUT and the run log); nothing was committed or pushed"
PROBLEM="$(jq -r --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --arg a "$ACTION_A" --arg b "$ACTION_B" --arg c "$ACTION_C" \
  --arg old "${OLD_NEXT_ACTION#    next_action: }" --arg new "${NEW_NEXT_ACTION#    next_action: }" "$VALIDATION_RULES" "$VALIDATION_OUT")" \
  || refuse "the amended fixture's validation output is unreadable (see $VALIDATION_OUT); nothing was committed or pushed"
[[ -z "$PROBLEM" ]] || refuse "the amended fixture fails Arcadia's own validation, so nothing was committed or pushed: $PROBLEM"
REQUIREMENT_ID="$(jq -r --arg a "$ACTION_A" '.afterIdentity[$a].requirementId' "$VALIDATION_OUT")"
OLD_REVISION="$(jq -r --arg a "$ACTION_A" '.beforeIdentity[$a].inputRevision' "$VALIDATION_OUT")"
NEW_REVISION="$(jq -r --arg a "$ACTION_A" '.afterIdentity[$a].inputRevision' "$VALIDATION_OUT")"
record "actionTextRevision" "$(jq -c --arg a "$ACTION_A" '{field: "next_action", before: .beforeActions[0].nextAction, after: .afterActions[0].nextAction,
  requirementId: .afterIdentity[$a].requirementId, inputRevisionBefore: .beforeIdentity[$a].inputRevision, inputRevisionAfter: .afterIdentity[$a].inputRevision,
  criteriaFingerprint: .afterIdentity[$a].criteriaFingerprint}' "$VALIDATION_OUT")"
echo "Amended fixture validated by Arcadia's discovery and docs sync; $ACTION_A's requirement input revision changes from ${OLD_REVISION:0:12} to ${NEW_REVISION:0:12}."

# Read-only against the live workspace: the amended input has no attempt yet,
# so the launch gate allocates a fresh development ordinal for it. Each Session
# that settled a passed attempt for the previous input must also be one the
# tick and the Action claim will step past once the input changes: finished,
# preserved by the worker (worker-tick-preserve-<session>) and clean, or the
# run-2 Grant would be consumed by a run that can never dispatch.
STAGE=lineage
cat > "$RUN_DIR/probe-lineage.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
const [workspace, requirementId, previous, amended] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const rows = tables.has("session_role_attempts") ? db.prepare("SELECT input_revision, role, ordinal, status, terminal_receipt_json FROM session_role_attempts WHERE requirement_id = ? ORDER BY created_at, rowid").all(requirementId) : [];
  const sessionOf = (row) => { try { return JSON.parse(row.terminal_receipt_json ?? "null")?.sessionId ?? null; } catch { return null; } };
  const holders = rows.filter((row) => row.role === "development" && row.status === "passed" && row.input_revision === previous).map((row) => {
    const id = sessionOf(row);
    const session = id && tables.has("agent_sessions") ? db.prepare("SELECT id, status, worktree_path FROM agent_sessions WHERE id = ?").get(id) : null;
    const preserved = id && tables.has("candidate_preservation_receipts") ? Boolean(db.prepare("SELECT 1 FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${id}`)) : false;
    return { sessionId: id, status: session ? session.status : "absent", worktree: session ? session.worktree_path : null, preserved };
  });
  return {
    attempts: rows.map((row) => ({ input: row.input_revision === previous ? "previous" : row.input_revision === amended ? "amended" : "other", role: row.role, ordinal: row.ordinal, status: row.status })),
    holders
  };
})));
NODE
LINEAGE="$(probe "$WORKSPACE" "$REQUIREMENT_ID" "$OLD_REVISION" "$NEW_REVISION" < "$RUN_DIR/probe-lineage.mjs")" || refuse "the attempt lineage could not be read"
printf '%s\n' "$LINEAGE" > "$RUN_DIR/lineage.json"
jq -e 'all(.attempts[]; .input != "amended")' <<<"$LINEAGE" >/dev/null || refuse "attempts already exist for the amended requirement input; the reset is not fresh"
record "run1Attempts" "$(jq -c '.attempts' <<<"$LINEAGE")"
record "run1Holders" "$(jq -c '.holders' <<<"$LINEAGE")"
# A passed attempt naming no Session row holds no claim or handoff; every named one must qualify.
jq -e 'all(.holders[]; .sessionId != null and (.status == "absent" or (.status != "prepared" and .status != "running" and .preserved == true)))' <<<"$LINEAGE" >/dev/null \
  || refuse "a run-1 Session that passed $ACTION_A is live, unpreserved by the worker or unnamed, so run 2 could not dispatch past it: $(jq -c '.holders' <<<"$LINEAGE")"
HOLDER_COUNT="$(jq '.holders | length' <<<"$LINEAGE")"
for ((h = 0; h < HOLDER_COUNT; h++)); do
  HOLDER_WT="$(jq -r ".holders[$h].worktree // empty" <<<"$LINEAGE")"
  if [[ -n "$HOLDER_WT" && -d "$HOLDER_WT" ]]; then
    HOLDER_STATUS="$(git -C "$HOLDER_WT" status --porcelain --untracked-files=all 2>/dev/null)" || refuse "run 1's worktree $HOLDER_WT could not be read"
    [[ -z "$HOLDER_STATUS" ]] || refuse "run 1's worktree $HOLDER_WT holds uncommitted work, so its Action claim stays and run 2 could not dispatch; it was not touched"
  fi
done

# Where the fixture is: at genesis, or a reset commit this script made earlier.
STAGE=fixture_state
is_reset_commit() {
  local commit="$1"
  [[ "$(fx rev-list --count "$GENESIS..$commit" 2>/dev/null)" == 1 ]] \
    && [[ "$(fx rev-parse "$commit^" 2>/dev/null)" == "$GENESIS" ]] \
    && [[ "$(fx log -1 --format=%s "$commit")" == "$RESET_SUBJECT" ]] \
    && [[ "$(fx diff --name-only "$GENESIS" "$commit")" == "$PLAN_FILE" ]] \
    && [[ "$(fx rev-parse "$commit:$PLAN_FILE")" == "$AMENDED_BLOB" ]]
}
if [[ "$LOCAL_MAIN" == "$GENESIS" && "$REMOTE_MAIN" == "$GENESIS" ]]; then
  RESET_STATE=at_genesis
elif [[ "$REMOTE_MAIN" == "$GENESIS" ]] && is_reset_commit "$LOCAL_MAIN"; then
  RESET_STATE=committed_unpushed
elif [[ "$LOCAL_MAIN" == "$REMOTE_MAIN" ]] && is_reset_commit "$LOCAL_MAIN"; then
  RESET_STATE=pushed
  PRIOR="$(latest_receipt "$SCRIPT_ID" succeeded "$REPO")"
  if [[ -n "$PRIOR" ]] && jq -e --arg head "$LOCAL_MAIN" '.newHead == $head' "$PRIOR" >/dev/null; then
    record_str resetState already_reset
    refuse "the reset already succeeded at fixture head $LOCAL_MAIN ($PRIOR); it is not applied twice. Run the G6 preflight next"
  fi
else
  RECOVERY="Neither main is at G1's genesis or at this script's own reset commit, so the fixture moved by another path (for example a run-2 integration). This script never rewrites history. Read 'git -C $FIXTURE_REPO log --oneline -5 main' and the GitHub main of $REPO, and ask for a new reviewed reset if a third run is wanted."
  refuse "fixture local main $LOCAL_MAIN and GitHub main $REMOTE_MAIN are not at genesis $GENESIS or this script's reset commit"
fi
record_str resetState "$RESET_STATE"

if [[ "$RESET_STATE" == at_genesis ]]; then
  STAGE=commit
  # Exactly the validated bytes: one file, one line.
  cp "$AMEND_DIR/$PLAN_FILE" "$FIXTURE_REPO/$PLAN_FILE"
  [[ "$(fx status --porcelain --untracked-files=all)" == " M $PLAN_FILE" ]] || refuse "the working tree change is not exactly the fixture Plan"
  fx add -- "$PLAN_FILE"
  fx -c user.name='Arcadia Rehearsal Fixture' -c user.email='rehearsal@localhost' commit -q -m "$RESET_SUBJECT" \
    -m "Rewrites only write-start-marker's next_action so its requirement input revision changes; acceptance criteria, the other Actions and the run-1 candidate are unchanged."
  LOCAL_COMMITTED=true
  LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
  is_reset_commit "$LOCAL_MAIN" || refuse "the new fixture commit is not exactly the validated amendment on genesis"
fi
NEW_HEAD="$LOCAL_MAIN"
record_str newHead "$NEW_HEAD"

if [[ "$RESET_STATE" != pushed ]]; then
  STAGE=push
  production_quiet before_push || refuse "production left Inactive or admitted work before the push; nothing was pushed"
  REMOTE_CHANGED=true
  # Never forced: a GitHub main that moved off genesis makes this push fail closed.
  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main
fi
REMOTE_AFTER="$(remote_main)" || refuse "could not read main of $REPO after the push"
[[ "$REMOTE_AFTER" == "$NEW_HEAD" ]] || refuse "GitHub main ($REMOTE_AFTER) is not the reset head ($NEW_HEAD)"
record_str remoteMainAfter "$REMOTE_AFTER"

STAGE=run1_candidate_after
check_run1_candidate
record_str prStateAfter "$PR_STATE"

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
write_receipt succeeded
echo "RESET: fixture $REPO main is now $NEW_HEAD (was genesis $GENESIS); only $ACTION_A's next_action changed."
echo "Run 1's branch $RUN1_BRANCH and pull request #$RUN1_PR stay at $RUN1_TIP. Production untouched."
echo "Next: run the G6 preflight preflight-three-action-rehearsal-2026-10-05 (it binds this receipt)."
echo "Receipt: $RECEIPT"
