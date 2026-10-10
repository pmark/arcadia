#!/usr/bin/env bash
# Reset ONE Action of the disposable rehearsal fixture so a single-Action run
# (operator or standing launch, draft pull request, merge on green) can repeat.
# It needs none of the 9-Action chain's production receipts and never touches
# production, a Grant or a G6/G7/G8 receipt. It reads the fixture's GitHub main
# fresh (git ls-remote), requires the clone clean and level with it, renders the
# one reopened Action (status open, a fresh next_action carrying the completion
# request id complete-<action>-<run-tag>, the Plan's and PROJECT.md's
# current_action, their updated: dates), removes that Action's own prior
# artifact when present, validates the result with Arcadia's own discovery,
# requirementIdentity, ready set and a read-only live dry-run docs sync, then
# makes exactly one commit on fixture main, pushes it without force, runs docs
# sync for the fixture Project and positions the Action in the operational queue
# through the governed `advance queue arrange`. `--dry-run` performs every read
# and validation, prints the exact diff and every refusal, and changes nothing
# outside a temporary evidence directory. It settles nothing, launches nothing,
# restarts nothing and leaves every earlier candidate branch and pull request
# untouched.
set -Eeuo pipefail

LIBRARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
SCRIPT_ID="reset-single-action-fixture"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
REPO="pmark/arcadia-three-action-rehearsal-20261004"
MANIFEST_NAME=".arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
PLAN_FILE="docs/plans/$FIXTURE_PLAN.md"
PROJECT_FILE="PROJECT.md"
DEFAULT_ACTION="write-start-marker"
USAGE="usage: $SCRIPT_ID.sh [run|--dry-run|--describe] --run-tag <lowercase-a-z0-9-> [--action <fixture-action-id>]"

# --- Arguments: collected here, validated after the receipt machinery exists. ---
MODE="run"
RUN_TAG=""
ACTION="$DEFAULT_ACTION"
while (( $# > 0 )); do
  case "$1" in
    run | --dry-run | --describe) MODE="$1" ;;
    --run-tag) [[ $# -ge 2 ]] || { echo "$USAGE" >&2; exit 2; }; RUN_TAG="$2"; shift ;;
    --run-tag=*) RUN_TAG="${1#--run-tag=}" ;;
    --action) [[ $# -ge 2 ]] || { echo "$USAGE" >&2; exit 2; }; ACTION="$2"; shift ;;
    --action=*) ACTION="${1#--action=}" ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
  shift
done
if [[ "$MODE" == --describe ]]; then cat "$LIBRARY_DIR/$SCRIPT_ID.json"; exit 0; fi
DRY_RUN=false
[[ "$MODE" == --dry-run ]] && DRY_RUN=true

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [[ "$DRY_RUN" == true ]]; then
  # A dry run writes nothing in the library, the fixture, GitHub or the workspace: its evidence goes to a fresh temporary directory.
  RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/single-action-reset-dry-run.XXXXXX")"
else
  RUN_DIR="$LIBRARY_DIR/runs/$RUN_ID"
  mkdir -p "$RUN_DIR"
fi
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exec > >(tee -a "$LOG") 2>&1

STAGE=arguments
REASON=""
RECOVERY=""
EXTRA=""
REMOTE_CHANGED=false
LOCAL_COMMITTED=false
FIXTURE_STATE=""
WOULD_REFUSE=""
WOULD_REFUSE_COUNT=0
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"mode":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"productionPreviewedOrActivated":false,"grantsTouched":false,"agentAskSettled":false%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$MODE")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
# A refusal a dry run reports and continues past; a real run refuses at once.
would_refuse() {
  if [[ "$DRY_RUN" == true ]]; then
    WOULD_REFUSE_COUNT=$((WOULD_REFUSE_COUNT + 1))
    WOULD_REFUSE="$WOULD_REFUSE$WOULD_REFUSE_COUNT. [$STAGE] $*"$'\n'
    echo "WOULD REFUSE [$STAGE]: $*" >&2
    return 0
  fi
  refuse "$@"
}
on_error() {
  local code=$? command="$BASH_COMMAND"
  # A failure inside a command substitution or wrapper subshell is the parent's to judge.
  if (( BASH_SUBSHELL > 0 )); then exit "$code"; fi
  trap - ERR
  set +e
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  record "fixtureCommitted" "$LOCAL_COMMITTED"
  record "githubRepositoryChanged" "$REMOTE_CHANGED"
  [[ -z "$RECOVERY" ]] || record_str recovery "$RECOVERY"
  [[ -z "$WOULD_REFUSE" ]] || record_str wouldRefuse "$WOULD_REFUSE"
  write_receipt "$([[ "$DRY_RUN" == true ]] && echo dry_run_stopped || echo refused)"
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID ($MODE)"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT"
    echo
    echo "Production policy was not previewed, activated or deactivated, no Grant was created or pressed, no Agent Ask"
    echo "was settled, no service was restarted and no Session was launched. No earlier candidate branch, worktree or"
    echo "pull request was touched, and nothing was force-pushed, rewritten or deleted."
    [[ -z "$FIXTURE_STATE" ]] || echo "Fixture state found at the start of this run: $FIXTURE_STATE."
    if [[ "$DRY_RUN" == true ]]; then
      echo "This was a dry run: it wrote nothing outside $RUN_DIR."
      [[ -z "$WOULD_REFUSE" ]] || { echo; echo "Refusals noted before it stopped:"; printf '%s' "$WOULD_REFUSE"; }
    elif [[ "$REMOTE_CHANGED" == true ]]; then
      echo "This run pushed (never forced) its commit to fixture main before stopping, or attempted to. Rerunning with the same arguments recognises that commit and resumes at docs sync once it is on GitHub main."
    elif [[ "$LOCAL_COMMITTED" == true ]]; then
      echo "This run committed on local fixture main but pushed nothing. Rerunning with the same arguments re-validates that exact commit and pushes it."
    else
      echo "This run made no fixture change: no ref moved, no commit, no push."
    fi
    echo
    if [[ -n "$RECOVERY" ]]; then echo "## Recovery"; echo; echo "$RECOVERY"
    else echo "Correct the named precondition and rerun. Do not edit the script, the fixture Plan, the fixture history or the workspace database by hand."
    fi
  } > "$HANDOFF"
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
trap on_error ERR

arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }
# Probes read the program on stdin so ./src imports resolve against the checkout.
probe() { (cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$@"); }
fx() { git -C "$FIXTURE_REPO" "$@"; }

echo "== Single-Action fixture reset: $ACTION, run tag ${RUN_TAG:-<missing>} ($MODE; no production change) =="
record_str actionId "$ACTION"
record_str runTag "$RUN_TAG"
record_str githubRepository "$REPO"
record_str fixtureRoot "$FIXTURE_REPO"
[[ "$DRY_RUN" == false ]] || echo "Dry run: evidence in $RUN_DIR; nothing is written to the library, the fixture, GitHub or the workspace."

for tool in git jq mise timeout node tar diff; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
# Reviewed, not merely rendered: this launcher and its descriptor must be tracked and unmodified at the checkout's HEAD
# (artifacts/generated is gitignored, so a reviewed entry is force-added).
for reviewed in "$LIBRARY_DIR/$SCRIPT_ID.sh" "$LIBRARY_DIR/$SCRIPT_ID.json"; do
  git -C "$ARCADIA_REPO" ls-files --error-unmatch -- "$reviewed" >/dev/null 2>&1 && git -C "$ARCADIA_REPO" diff --quiet HEAD -- "$reviewed" \
    || refuse "$reviewed is not tracked and unmodified at the checkout's HEAD; the script and its descriptor must be reviewed and committed before they run"
done
[[ -n "$RUN_TAG" ]] || refuse "--run-tag is required (lowercase a-z, 0-9 and hyphens): it makes the fresh completion request id complete-$ACTION-<run-tag>"
cat > "$RUN_DIR/arguments.mjs" <<'NODE'
import { singleActionProblems } from "./src/operatorActions/singleActionFixtureReset.ts";
const [action, runTag] = process.argv.slice(2);
console.log(JSON.stringify(singleActionProblems(action, runTag)));
NODE
ARG_PROBLEMS="$(probe "$ACTION" "$RUN_TAG" < "$RUN_DIR/arguments.mjs")" || refuse "the arguments could not be validated"
[[ "$ARG_PROBLEMS" == "[]" ]] || refuse "invalid arguments: $ARG_PROBLEMS"
COMPLETION_ID="complete-$ACTION-$RUN_TAG"
ACTION_REF="plan/$FIXTURE_PLAN#$ACTION"
record_str completionId "$COMPLETION_ID"

# --- The Arcadia checkout: the same reviewed-head rule the chain reset applies. ---
STAGE=preflight
[[ "$(git -C "$ARCADIA_REPO" rev-parse --show-toplevel 2>/dev/null)" == "$ARCADIA_REPO" ]] || refuse "the operator-script library is not inside the Arcadia checkout"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || would_refuse "the Arcadia checkout must be on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || would_refuse "the Arcadia checkout must be clean"
ARCADIA_HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)"
[[ "$ARCADIA_HEAD" == "$(git -C "$ARCADIA_REPO" rev-parse -q --verify origin/main 2>/dev/null)" ]] || would_refuse "the Arcadia checkout's HEAD $ARCADIA_HEAD is not level with its last-fetched origin/main; fetch and fast-forward main, then rerun"
REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main 2>/dev/null)" || REMOTE_LINE=""
ARCADIA_REMOTE_HEAD="${REMOTE_LINE%%[[:space:]]*}"
[[ "$ARCADIA_REMOTE_HEAD" == "$ARCADIA_HEAD" ]] || would_refuse "origin main observed now (${ARCADIA_REMOTE_HEAD:-unobserved within 30 seconds}) is not the checkout's HEAD $ARCADIA_HEAD; fetch and fast-forward main, then rerun"
record_str arcadiaHead "$ARCADIA_HEAD"
[[ -z "${ARCADIA_WORKSPACE+x}" ]] || refuse "ARCADIA_WORKSPACE is set in this shell, so the workspace would not resolve from user config; run 'unset ARCADIA_WORKSPACE' and rerun"
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve from user config"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the CLI's default workspace is $WORKSPACE, not martianrover; refusing to sync the fixture elsewhere"
record_str workspace "$WORKSPACE"

# --- The local fixture clone and GitHub main, read fresh. ---
STAGE=local_fixture
[[ -f "$FIXTURE_REPO/$MANIFEST_NAME" ]] || refuse "$FIXTURE_REPO is not the G1 fixture (no $MANIFEST_NAME)"
jq -e --arg repo "$REPO" --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" \
  '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .githubRepository == $repo and .fixtureProject == $p and .fixturePlan == $plan' \
  "$FIXTURE_REPO/$MANIFEST_NAME" >/dev/null || refuse "the fixture manifest does not name $REPO with the fixture Project and Plan"
[[ "$(fx branch --show-current)" == main ]] || refuse "the local fixture is not on main"
[[ -z "$(fx status --porcelain --untracked-files=all)" ]] || would_refuse "the local fixture working tree is dirty or has untracked files"
ORIGIN="$(fx config --get remote.origin.url)" || refuse "the local fixture has no origin remote"
[[ "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ]] || refuse "the local fixture origin is $ORIGIN, not $REPO"
LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
remote_ref() { local line; line="$(timeout 60 git -C "$FIXTURE_REPO" ls-remote origin "$1")" || return 1; printf '%s' "${line%%[[:space:]]*}"; }
REMOTE_MAIN="$(remote_ref refs/heads/main)" || refuse "could not read GitHub main of $REPO (git ls-remote failed)"
[[ "$REMOTE_MAIN" =~ ^[0-9a-f]{40}$ ]] || refuse "GitHub main of $REPO is unreadable or absent"
record_str localMainBefore "$LOCAL_MAIN"
record_str remoteMainBefore "$REMOTE_MAIN"
other_refs() {
  # Every GitHub branch except main (the earlier candidates), and the clone's local branches except main: read twice, compared.
  { timeout 60 git -C "$FIXTURE_REPO" ls-remote origin 'refs/heads/*' | grep -v -E '[[:space:]]refs/heads/main$' | sort || true
    fx for-each-ref --format='local %(refname) %(objectname)' refs/heads | grep -v ' refs/heads/main ' | sort || true; }
}
OTHER_REFS_BEFORE="$(other_refs)"
record "otherRefsBefore" "$(printf '%s\n' "$OTHER_REFS_BEFORE" | jq -R . | jq -sc 'map(select(length > 0))')"

SUBJECT="Reopen $ACTION for single-Action rehearsal $RUN_TAG"
BASE=""
if [[ "$LOCAL_MAIN" == "$REMOTE_MAIN" ]]; then
  if [[ "$(fx log -1 --format=%s "$LOCAL_MAIN")" == "$SUBJECT" ]]; then
    FIXTURE_STATE=pushed
    BASE="$(fx rev-parse "$LOCAL_MAIN^")"
    PRIOR="$(for candidate in "$LIBRARY_DIR"/runs/*/receipt.json; do [[ -f "$candidate" ]] && jq -e --arg id "$SCRIPT_ID" --arg head "$LOCAL_MAIN" '.id == $id and .outcome == "succeeded" and .newHead == $head' "$candidate" >/dev/null 2>&1 && echo "$candidate"; done | tail -n 1)"
    [[ -z "$PRIOR" ]] || refuse "this reset already succeeded at fixture head $LOCAL_MAIN ($PRIOR); it is not applied twice. Choose a new --run-tag for another run"
  else
    FIXTURE_STATE=at_base
    BASE="$LOCAL_MAIN"
  fi
elif [[ "$(fx rev-parse "$LOCAL_MAIN^" 2>/dev/null)" == "$REMOTE_MAIN" && "$(fx log -1 --format=%s "$LOCAL_MAIN")" == "$SUBJECT" ]]; then
  FIXTURE_STATE=committed_unpushed
  BASE="$REMOTE_MAIN"
else
  RECOVERY="Read 'git -C $FIXTURE_REPO log --oneline --graph --all -12' and the GitHub main of $REPO. This script never rewrites history, forces anything or moves local main. Bring the clone level with GitHub main through your normal Git steps (for example 'git -C $FIXTURE_REPO pull --ff-only' when it is only behind), then rerun."
  refuse "the local fixture main $LOCAL_MAIN is not GitHub main $REMOTE_MAIN (and is not this reset's own unpushed commit); the clone must be level with GitHub main"
fi
record_str fixtureState "$FIXTURE_STATE"
record_str baseHead "$BASE"
echo "Fixture state: $FIXTURE_STATE (local main $LOCAL_MAIN, GitHub main $REMOTE_MAIN, rendering from $BASE)."

# --- Render the single reopened Action from the base head. ---
STAGE=render
RESET_DATE="$(date -u +%F)"
if [[ "$FIXTURE_STATE" != at_base ]]; then
  # Resuming a commit made on an earlier UTC date renders with that commit's own date.
  COMMIT_DATE="$(fx show "$LOCAL_MAIN:$PLAN_FILE" 2>/dev/null | grep -E '^updated: [0-9]{4}-[0-9]{2}-[0-9]{2}$' | head -n 1 || true)"
  [[ -z "$COMMIT_DATE" ]] || RESET_DATE="${COMMIT_DATE#updated: }"
fi
BEFORE_DIR="$RUN_DIR/.fixture-previous"
AMEND_DIR="$RUN_DIR/.fixture-amended"
mkdir -p "$BEFORE_DIR" "$AMEND_DIR"
fx archive "$BASE" | tar -x -C "$BEFORE_DIR"
fx archive "$BASE" | tar -x -C "$AMEND_DIR"
cat > "$RUN_DIR/render.mjs" <<'NODE'
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderSingleActionReopen, singleActionOutputs, SingleActionResetError } from "./src/operatorActions/singleActionFixtureReset.ts";
const [beforeRoot, amendRoot, planFile, projectFile, actionId, runTag, resetDate] = process.argv.slice(2);
try {
  const rendered = renderSingleActionReopen(readFileSync(path.join(beforeRoot, planFile), "utf8"), readFileSync(path.join(beforeRoot, projectFile), "utf8"), { actionId, runTag, resetDate });
  const outputs = singleActionOutputs(actionId, (file) => existsSync(path.join(beforeRoot, file)) ? readFileSync(path.join(beforeRoot, file), "utf8") : null);
  writeFileSync(path.join(amendRoot, planFile), rendered.plan);
  writeFileSync(path.join(amendRoot, projectFile), rendered.project);
  for (const file of outputs.remove) rmSync(path.join(amendRoot, file));
  console.log(JSON.stringify({ ok: true, ...rendered, plan: undefined, project: undefined, remove: outputs.remove, outputProblems: outputs.problems }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, reason: error instanceof SingleActionResetError ? error.reason : "RENDER_FAILED", message: error.message }));
}
NODE
RENDER="$(probe "$BEFORE_DIR" "$AMEND_DIR" "$PLAN_FILE" "$PROJECT_FILE" "$ACTION" "$RUN_TAG" "$RESET_DATE" < "$RUN_DIR/render.mjs")" || refuse "the Plan and PROJECT.md could not be rendered"
printf '%s\n' "$RENDER" > "$RUN_DIR/render.json"
if ! jq -e '.ok == true' <<<"$RENDER" >/dev/null; then
  if [[ "$(jq -r '.reason' <<<"$RENDER")" == RESET_DATE_BEFORE_RECORD ]]; then
    RECOVERY="This host's UTC date ($RESET_DATE) is before a fixture document's updated: date, so docs sync would skip the reopened Action as older than its record. Correct the host clock, or rerun on or after that date UTC. Do not hand-edit the date."
  fi
  refuse "the reopened Action was not rendered from $BASE: $(jq -r '.message' <<<"$RENDER")"
fi
jq -e '.outputProblems == []' <<<"$RENDER" >/dev/null || would_refuse "$ACTION's earlier output cannot be removed cleanly: $(jq -c '.outputProblems' <<<"$RENDER")"
PROJECT_CHANGED="$(jq -r '.projectChanged' <<<"$RENDER")"
REMOVED_JSON="$(jq -c '.remove' <<<"$RENDER")"
# The commit changes the Plan, PROJECT.md when its pointer moves, and the Action's own removed artifacts: nothing else.
EXPECTED_CHANGED="$( { echo "$PLAN_FILE"; [[ "$PROJECT_CHANGED" != true ]] || echo "$PROJECT_FILE"; jq -r '.[]' <<<"$REMOVED_JSON"; } | LC_ALL=C sort)"
CHANGED="$( (cd "$RUN_DIR" && diff -rq .fixture-previous .fixture-amended || true) \
  | sed -E -e 's#^Files \.fixture-previous/(.*) and \.fixture-amended/.* differ$#\1#' -e 's#^Only in \.fixture-previous/(.*): (.*)$#\1/\2#' -e 's#^Only in \.fixture-previous: (.*)$#\1#' | LC_ALL=C sort)"
[[ "$CHANGED" == "$EXPECTED_CHANGED" ]] || refuse "the rendered change is not exactly the Plan, PROJECT.md's pointer and the Action's own artifacts: $(tr '\n' ' ' <<<"$CHANGED")"
AMENDED_PLAN_BLOB="$(git hash-object "$AMEND_DIR/$PLAN_FILE")"
AMENDED_PROJECT_BLOB="$(git hash-object "$AMEND_DIR/$PROJECT_FILE")"
record_str amendedPlanBlob "$AMENDED_PLAN_BLOB"
record_str amendedProjectBlob "$AMENDED_PROJECT_BLOB"
record_str statusBefore "$(jq -r '.statusBefore' <<<"$RENDER")"
record_str planUpdatedBefore "$(jq -r '.planUpdatedBefore' <<<"$RENDER")"
record_str planUpdated "$RESET_DATE"
record "projectChanged" "$PROJECT_CHANGED"
record "removedFiles" "$REMOVED_JSON"
(cd "$RUN_DIR" && diff -u ".fixture-previous/$PLAN_FILE" ".fixture-amended/$PLAN_FILE") > "$RUN_DIR/plan.diff" || true
(cd "$RUN_DIR" && diff -u ".fixture-previous/$PROJECT_FILE" ".fixture-amended/$PROJECT_FILE") > "$RUN_DIR/project.diff" || true

# The commit that already exists (a resumed state) must be byte for byte this rendering.
if [[ "$FIXTURE_STATE" != at_base ]]; then
  STAGE=resume_check
  [[ "$(fx rev-parse "$LOCAL_MAIN:$PLAN_FILE")" == "$AMENDED_PLAN_BLOB" && "$(fx rev-parse "$LOCAL_MAIN:$PROJECT_FILE")" == "$AMENDED_PROJECT_BLOB" \
    && "$(fx diff --name-only "$BASE" "$LOCAL_MAIN" | LC_ALL=C sort)" == "$EXPECTED_CHANGED" ]] \
    || refuse "the fixture's commit $LOCAL_MAIN is not exactly the validated rendering of this reset on $BASE; it was not pushed or synced"
fi

# --- Arcadia's own judgement of the amended tree. ---
STAGE=validate_amendment
cat > "$RUN_DIR/validate.mjs" <<'NODE'
import { discoverDocs } from "./src/docs/discover.ts";
import { resolveReadySet } from "./src/docs/dispatch.ts";
import { requirementIdentity } from "./src/sessions/roleLineage.ts";
const [beforeRoot, amendRoot, project, plan, actionId] = process.argv.slice(2);
const describe = (error) => `${error.relativePath}${error.field ? ` (${error.field})` : ""}: ${error.message}`;
const planOf = (root) => { const discovered = discoverDocs(root); return { discovered, doc: discovered.docs.find((entry) => entry.type === "plan" && entry.slug === plan) }; };
const before = planOf(beforeRoot), after = planOf(amendRoot);
const problems = [...before.discovered.errors.map((e) => `base discovery error: ${describe(e)}`), ...after.discovered.errors.map((e) => `docs sync error: ${describe(e)}`)];
const projectDoc = after.discovered.docs.find((doc) => doc.type === "project");
if (!projectDoc || projectDoc.slug !== project || projectDoc.activePlan !== plan || projectDoc.currentAction !== actionId) problems.push(`PROJECT.md does not point at ${plan}#${actionId}`);
const find = (doc, id) => doc?.actions.find((action) => action.id === id);
const identity = (doc) => { const action = find(doc, actionId); return action ? requirementIdentity({ projectSlug: project, planSlug: plan, action }) : null; };
const was = identity(before.doc), now = identity(after.doc);
if (!after.doc || !before.doc) problems.push(`Plan ${plan} was not discovered`);
else {
  const target = find(after.doc, actionId);
  if (!target) problems.push(`the amended Plan has no Action ${actionId}`);
  else if (target.status !== "open" || target.responsibility !== "agent") problems.push(`${actionId} must be open and agent-owned`);
  if (JSON.stringify(before.doc.actions.map((a) => a.id)) !== JSON.stringify(after.doc.actions.map((a) => a.id))) problems.push("the amendment changed the Plan's Action list");
  for (const action of after.doc.actions) {
    if (action.id !== actionId && JSON.stringify(action) !== JSON.stringify(find(before.doc, action.id))) problems.push(`the amendment changed ${action.id}, which is not the reopened Action`);
  }
  if (was && now) {
    if (was.inputRevision === now.inputRevision) problems.push(`the amendment did not give ${actionId} a fresh requirement input revision`);
    if (was.criteriaFingerprint !== now.criteriaFingerprint) problems.push(`the amendment changed the acceptance criteria fingerprint of ${actionId}`);
  }
}
const readySet = resolveReadySet(amendRoot, project);
problems.push(...readySet.blockers.map((e) => `ready-set blocker: ${describe(e)}`));
if (!readySet.ready.some((entry) => entry.actionId === actionId)) {
  const candidate = readySet.candidates.find((entry) => entry.actionId === actionId);
  problems.push(`${actionId} would not be ready (ready set: [${readySet.ready.map((entry) => entry.actionId).join(", ")}]${candidate ? `; blocked by ${candidate.blockers.map((b) => b.field).join(", ") || "its gate"}` : ""})`);
}
console.log(JSON.stringify({ problems, identity: { before: was, after: now }, ready: readySet.ready.map((entry) => entry.actionId) }));
NODE
VALIDATION="$RUN_DIR/amendment-validation.json"
probe "$BEFORE_DIR" "$AMEND_DIR" "$FIXTURE_PROJECT" "$FIXTURE_PLAN" "$ACTION" < "$RUN_DIR/validate.mjs" > "$VALIDATION" || refuse "Arcadia's discovery could not run against the amended fixture (see $VALIDATION and the run log); nothing was changed"
jq -e '.problems | type == "array"' "$VALIDATION" >/dev/null 2>&1 || refuse "the amended fixture's validation output is unreadable (see $VALIDATION); nothing was changed"
jq -e '.problems == []' "$VALIDATION" >/dev/null || refuse "the amended fixture fails Arcadia's own validation, so nothing was changed: $(jq -c '.problems' "$VALIDATION")"
record "inputRevisionBefore" "$(jq -c '.identity.before.inputRevision // null' "$VALIDATION")"
record "inputRevisionAfter" "$(jq -c '.identity.after.inputRevision' "$VALIDATION")"
echo "Amended fixture validated by Arcadia's discovery and ready set: $ACTION is open and ready with a fresh requirement input revision."

# --- Read-only against the live workspace: registration, live Sessions, pending proposals, a dry-run docs sync, the queue. ---
STAGE=workspace_observation
cat > "$RUN_DIR/observe.mjs" <<'NODE'
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { getProjectBySlug, getProjectMetadata } from "./src/db/repositories.ts";
import { listActiveAgentSessions } from "./src/sessions/index.ts";
import { syncProjectDocs } from "./src/docs/sync.ts";
import { buildAgentQueue } from "./src/dispatch/queue.ts";
import { readChainAskState } from "./src/operatorActions/rehearsalChainProbe.ts";
import { completionIdProblems } from "./src/operatorActions/rehearsalChain.ts";
const [workspace, slug, amendRoot, actionId, completionId] = process.argv.slice(2);
const askFiles = [];
const walk = (dir, rel) => { for (const name of readdirSync(dir)) { const full = path.join(dir, name); const next = path.join(rel, name); if (statSync(full).isDirectory()) walk(full, next); else if (name.endsWith(".yaml")) askFiles.push(next); } };
try { walk(path.join(amendRoot, ".arcadia"), ".arcadia"); } catch { /* no ask directory */ }
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const project = getProjectBySlug(db, slug);
  const metadata = project ? getProjectMetadata(db, project.id) : null;
  const active = listActiveAgentSessions(db);
  const gate = project ? readChainAskState(db, { repoRoot: amendRoot, projectSlug: slug, actionIds: [actionId], requestIds: [completionId] }) : null;
  const sync = project ? syncProjectDocs(db, project, { apply: false, repoRoot: amendRoot }) : null;
  const queue = buildAgentQueue(db);
  return {
    registration: { projectId: project?.id ?? null, repoPath: metadata?.repo_path ?? null, fixtureActive: active.filter((s) => s.project_slug === slug).map((s) => s.id) },
    gate,
    completionProblems: gate ? completionIdProblems([completionId], gate.usedRequestIds, askFiles) : [],
    liveDryRun: sync ? {
      errors: sync.errors.map((error) => `${error.relativePath}: ${error.message}`),
      actions: sync.changes.filter((change) => change.entity === "action").map((change) => ({ ref: change.ref, action: change.action, reason: change.reason ?? null })),
      projects: sync.changes.filter((change) => change.entity === "project").map((change) => ({ ref: change.ref, action: change.action, reason: change.reason ?? null }))
    } : null,
    queue: { revision: queue.revision, orderValid: queue.orderValid, unpositionedCount: queue.unpositionedCount, entries: queue.ordered.filter((entry) => entry.orderKey != null).map((entry) => ({ key: entry.orderKey, status: entry.orderStatus })) }
  };
})));
NODE
OBSERVED="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" "$AMEND_DIR" "$ACTION" "$COMPLETION_ID" < "$RUN_DIR/observe.mjs")" || refuse "the live workspace could not be read for the fixture Project"
printf '%s\n' "$OBSERVED" > "$RUN_DIR/observed.json"
MARKER="$FIXTURE_REPO/.git/arcadia-three-action-project-id"
[[ -s "$MARKER" ]] || refuse "the local fixture has no G1 registration marker (.git/arcadia-three-action-project-id)"
MARKER_ID="$(<"$MARKER")"
FIXTURE_REAL="$(cd "$FIXTURE_REPO" && pwd -P)"
jq -e --arg id "$MARKER_ID" --arg root "$FIXTURE_REPO" --arg real "$FIXTURE_REAL" '.registration.projectId == $id and (.registration.repoPath == $root or .registration.repoPath == $real)' <<<"$OBSERVED" >/dev/null \
  || refuse "Project $FIXTURE_PROJECT is not registered from $FIXTURE_REPO under G1's marker $MARKER_ID: $(jq -c '.registration' <<<"$OBSERVED")"
record_str projectId "$MARKER_ID"
STAGE=live_session
jq -e '.registration.fixtureActive == []' <<<"$OBSERVED" >/dev/null || would_refuse "a Session for the fixture Project is prepared or running: $(jq -c '.registration.fixtureActive' <<<"$OBSERVED")"
STAGE=proposal_gate
PENDING="$(jq -c --arg action "$ACTION" '[(.gate.fixturePending[] | select((.targetRef // "") | contains($action)) | "pending proposal \(.requestId) (\(.id), \(.intent) \(.targetRef // "-"))"), (.gate.blocking[] | "\(.kind) \(.id) gating \(.action): \(.title)\(if .settle then " (settle with: \(.settle))" else "" end)")] | unique' <<<"$OBSERVED")"
record "fixtureProposalsBefore" "$(jq -c '.gate.fixtureProposals' <<<"$OBSERVED")"
if [[ "$PENDING" != "[]" ]]; then
  RECOVERY="Pending operator items sit on $ACTION: $PENDING. This reset settles none of them. Give each its own governed disposition first, then rerun."
  would_refuse "pending operator items gate $ACTION: $PENDING"
fi
COMPLETION_PROBLEMS="$(jq -c '.completionProblems' <<<"$OBSERVED")"
[[ "$COMPLETION_PROBLEMS" == "[]" ]] || would_refuse "the fresh completion id is not unused: $COMPLETION_PROBLEMS; choose a new --run-tag"
STAGE=live_sync_preview
jq -e --arg ref "$ACTION_REF" --arg state "$FIXTURE_STATE" --argjson projectChanged "$PROJECT_CHANGED" '.liveDryRun != null and (.liveDryRun.errors | length) == 0
  and (.liveDryRun.actions | map(select(.action == "skipped")) | length) == 0
  and (($projectChanged | not) or ((.liveDryRun.projects | map(select(.action == "skipped")) | length) == 0))
  and ([.liveDryRun.actions[] | select(.ref == $ref) | .action] as $a | ($a | length) == 1 and ($a[0] == "update" or ($a[0] == "unchanged" and $state == "pushed")))' \
  <<<"$OBSERVED" >/dev/null \
  || would_refuse "the live workspace's dry-run docs sync would not apply $ACTION as exactly one update (an error, a skipped change, or another change): $(jq -c '.liveDryRun' <<<"$OBSERVED" 2>/dev/null)"
record "liveSyncPreview" "$(jq -c '.liveDryRun.actions // null' <<<"$OBSERVED")"
STAGE=queue_plan
QUEUE_KEY="$FIXTURE_PROJECT/$ACTION"
cat > "$RUN_DIR/queue-plan.mjs" <<'NODE'
import { planChainQueueOrder } from "./src/operatorActions/rehearsalChain.ts";
import { singleActionQueueRequestId } from "./src/operatorActions/singleActionFixtureReset.ts";
const [facts, key, actionId, runTag] = process.argv.slice(2);
const parsed = JSON.parse(facts);
console.log(JSON.stringify({ ...planChainQueueOrder(parsed, [key]), requestId: singleActionQueueRequestId(actionId, runTag, parsed.revision) }));
NODE
QUEUE_NOW="$(jq -c '.queue' <<<"$OBSERVED")"
record "queueObservedBeforeSync" "$(jq -c '{revision, orderValid, unpositionedCount}' <<<"$QUEUE_NOW")"

# --- A dry run stops here: it prints the exact planned change and every refusal. ---
if [[ "$DRY_RUN" == true ]]; then
  STAGE=dry_run_report
  echo
  echo "== DRY RUN: planned fixture change for $ACTION (run tag $RUN_TAG), nothing written =="
  echo "Fixture: $REPO, clone $FIXTURE_REPO; state $FIXTURE_STATE; local main $LOCAL_MAIN, GitHub main $REMOTE_MAIN."
  case "$FIXTURE_STATE" in
    at_base) echo "Step 1: one commit '$SUBJECT' on $BASE changing only: $(tr '\n' ' ' <<<"$EXPECTED_CHANGED")(Plan blob $AMENDED_PLAN_BLOB, PROJECT.md blob $AMENDED_PROJECT_BLOB), pushed to fixture main without force." ;;
    committed_unpushed) echo "Step 1: resume: the commit $LOCAL_MAIN is already on local main; push it to fixture main without force." ;;
    pushed) echo "Step 1: none; the commit $LOCAL_MAIN is already on GitHub main. Resume at docs sync." ;;
  esac
  echo "Step 2: arcadia docs sync --project $FIXTURE_PROJECT --apply (the live dry run already shows $ACTION as: $(jq -c '[.liveDryRun.actions[] | select(.ref == "'"$ACTION_REF"'") | .action]' <<<"$OBSERVED"))."
  echo "Step 3: position $QUEUE_KEY in the queue if needed (arcadia advance queue arrange, previewed then applied at the exact revision, refused unless orderValid with 0 unpositioned). Queue now: $(jq -c '{revision, orderValid, unpositionedCount}' <<<"$QUEUE_NOW")."
  echo "Action: $ACTION ($(jq -r '.statusBefore' <<<"$RENDER") -> open); completion id $COMPLETION_ID; requirement input $(jq -r '(.identity.before.inputRevision // "new")[0:12]' "$VALIDATION") -> $(jq -r '.identity.after.inputRevision[0:12]' "$VALIDATION")."
  echo "Files removed (the Action's own prior artifact): $(jq -r 'if length == 0 then "none" else join(", ") end' <<<"$REMOVED_JSON")."
  echo "Earlier candidates (branches left untouched): $(printf '%s\n' "$OTHER_REFS_BEFORE" | grep -c . || true) ref(s) other than main."
  echo "Plan diff: $RUN_DIR/plan.diff"
  cat "$RUN_DIR/plan.diff"
  echo "PROJECT.md diff: $RUN_DIR/project.diff"
  if [[ -s "$RUN_DIR/project.diff" ]]; then cat "$RUN_DIR/project.diff"; else echo "(unchanged: PROJECT.md already points at $ACTION)"; fi
  while IFS= read -r removed_file; do [[ -z "$removed_file" ]] || echo "REMOVED: $removed_file ($(wc -c < "$BEFORE_DIR/$removed_file" | tr -d ' ') bytes)"; done < <(jq -r '.[]' <<<"$REMOVED_JSON")
  echo
  [[ -z "$WOULD_REFUSE" ]] || record_str wouldRefuse "$WOULD_REFUSE"
  record "wouldRefuseCount" "$WOULD_REFUSE_COUNT"
  if (( WOULD_REFUSE_COUNT > 0 )); then
    write_receipt dry_run_would_refuse
    echo "DRY RUN: a real run would REFUSE ($WOULD_REFUSE_COUNT):"
    printf '%s' "$WOULD_REFUSE"
    echo "Evidence: $RUN_DIR"
    exit 1
  fi
  write_receipt dry_run_ready
  echo "DRY RUN: no refusal; a real run would make exactly the change above. Evidence: $RUN_DIR"
  exit 0
fi

# --- Write mode: every check above passed. ---
if [[ "$FIXTURE_STATE" == at_base ]]; then
  STAGE=commit
  # Nothing may have moved since validation: clean, and local main and GitHub main still exactly where they were.
  [[ -z "$(fx status --porcelain --untracked-files=all)" && "$(fx rev-parse refs/heads/main)" == "$LOCAL_MAIN" && "$(fx symbolic-ref HEAD)" == refs/heads/main ]] || refuse "the fixture changed during validation; nothing was committed"
  [[ "$(remote_ref refs/heads/main)" == "$REMOTE_MAIN" ]] || refuse "GitHub main moved during validation; nothing was committed"
  cp "$AMEND_DIR/$PLAN_FILE" "$FIXTURE_REPO/$PLAN_FILE"
  cp "$AMEND_DIR/$PROJECT_FILE" "$FIXTURE_REPO/$PROJECT_FILE"
  while IFS= read -r removed_file; do [[ -z "$removed_file" ]] || fx rm -q -- "$removed_file"; done < <(jq -r '.[]' <<<"$REMOVED_JSON")
  fx add -- "$PLAN_FILE" "$PROJECT_FILE"
  [[ "$(fx diff --cached --name-only | LC_ALL=C sort)" == "$EXPECTED_CHANGED" ]] || refuse "the staged change is not exactly the validated amendment"
  [[ -z "$(fx status --porcelain --untracked-files=all | grep -v -E '^(M |D ) ' || true)" ]] || refuse "the working tree holds changes beyond the validated amendment"
  fx -c user.name='Arcadia Rehearsal Fixture' -c user.email='rehearsal@localhost' commit -q -m "$SUBJECT" \
    -m "Reopens $ACTION alone with the fresh completion request id $COMPLETION_ID: status open, a fresh next_action (new requirement input revision), the Plan's and PROJECT.md's current_action at $ACTION, their updated: dates at $RESET_DATE and the Action's own prior artifact removed when present; acceptance criteria and every other Action are unchanged; earlier candidates are untouched."
  LOCAL_COMMITTED=true
  LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
  [[ "$(fx rev-parse "$LOCAL_MAIN^")" == "$BASE" && "$(fx rev-parse "$LOCAL_MAIN:$PLAN_FILE")" == "$AMENDED_PLAN_BLOB" && "$(fx rev-parse "$LOCAL_MAIN:$PROJECT_FILE")" == "$AMENDED_PROJECT_BLOB" \
    && "$(fx diff --name-only "$BASE" "$LOCAL_MAIN" | LC_ALL=C sort)" == "$EXPECTED_CHANGED" ]] || refuse "the new fixture commit is not exactly the validated amendment on $BASE"
  FIXTURE_STATE=committed_unpushed
fi
NEW_HEAD="$LOCAL_MAIN"
record_str newHead "$NEW_HEAD"

if [[ "$FIXTURE_STATE" == committed_unpushed ]]; then
  STAGE=push
  REMOTE_CHANGED=true
  # Never forced: a GitHub main that moved off the base head makes this push fail closed.
  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main
fi
REMOTE_AFTER="$(remote_ref refs/heads/main)" || refuse "could not read GitHub main of $REPO after the push"
[[ "$REMOTE_AFTER" == "$NEW_HEAD" ]] || refuse "GitHub main ($REMOTE_AFTER) is not the new fixture head ($NEW_HEAD)"
record_str remoteMainAfter "$REMOTE_AFTER"
STAGE=refs_after
OTHER_REFS_AFTER="$(other_refs)"
[[ "$OTHER_REFS_AFTER" == "$OTHER_REFS_BEFORE" ]] || refuse "a branch other than main changed during the reset (before/after differ): the earlier candidates must stay untouched"
record "otherRefsUnchanged" true

STAGE=docs_sync
SYNC="$(arcadia docs sync --project "$FIXTURE_PROJECT" --apply --workspace "$WORKSPACE" --json)" || SYNC=""
printf '%s\n' "$SYNC" > "$RUN_DIR/docs-sync.json"
jq -e '.ok == true and .data.errorCount == 0' <<<"$SYNC" >/dev/null 2>&1 || refuse "docs sync reported errors although the amended fixture validated before the push; see $RUN_DIR/docs-sync.json"
jq -e --arg ref "$ACTION_REF" --arg state "$FIXTURE_STATE" '[.data.projects[].changes[] | select(.entity == "action")] as $actions
  | ($actions | map(select(.action == "skipped")) | length) == 0
  and ([$actions[] | select(.ref == $ref) | .action] as $a | ($a | length) == 1 and ($a[0] == "update" or ($a[0] == "unchanged" and $state == "pushed")))' <<<"$SYNC" >/dev/null \
  || refuse "docs sync did not apply $ACTION as exactly one update (a change was skipped or missing); see $RUN_DIR/docs-sync.json"
jq -e --argjson projectChanged "$PROJECT_CHANGED" '($projectChanged | not) or (([.data.projects[].changes[] | select(.entity == "project" and .action == "skipped")] | length) == 0)' <<<"$SYNC" >/dev/null \
  || refuse "docs sync skipped the fixture Project's pointer change as older than its record; see $RUN_DIR/docs-sync.json"
WORK="$(arcadia work list --workspace "$WORKSPACE" --json)"
jq -e --arg ref "$ACTION_REF" '[.data.workItems[]? | select(.doc_ref == $ref)] | length == 1' <<<"$WORK" >/dev/null || refuse "Action $ACTION is not synced exactly once after the reset"

# docs sync reopens an Action without positioning it, and one unpositioned Action makes `advance queue make-next`
# refuse every Project (Issue #1015): position it through the governed arrange (preview, then apply at the same
# revision and request id), then require the queue orderValid with nothing unpositioned.
STAGE=queue_order
queue_facts() {
  local queue
  queue="$(arcadia advance queue --workspace "$WORKSPACE" --json)" || return 1
  jq -ce 'select(.ok == true and (.data.revision | type) == "number" and (.data.orderValid | type) == "boolean" and (.data.unpositionedCount | type) == "number")
    | {revision: .data.revision, orderValid: .data.orderValid, unpositionedCount: .data.unpositionedCount, entries: [.data.ordered[]? | select(.orderKey != null) | {key: .orderKey, status: .orderStatus}]}' <<<"$queue"
}
QUEUE_BEFORE="$(queue_facts)" || refuse "the Action queue could not be read after the docs sync"
QUEUE_PLAN="$(probe "$QUEUE_BEFORE" "$QUEUE_KEY" "$ACTION" "$RUN_TAG" < "$RUN_DIR/queue-plan.mjs")" || refuse "the queue order could not be planned"
printf '%s\n%s\n' "$QUEUE_BEFORE" "$QUEUE_PLAN" > "$RUN_DIR/queue-before.json"
jq -e '.missing == []' <<<"$QUEUE_PLAN" >/dev/null || refuse "the Action queue does not list $QUEUE_KEY, so docs sync did not make it an approved Action; nothing was arranged"
QUEUE_REVISION="$(jq -r '.revision' <<<"$QUEUE_BEFORE")"
if jq -e '.satisfied == true' <<<"$QUEUE_PLAN" >/dev/null; then
  QUEUE_AFTER="$QUEUE_BEFORE"
  record "queue" "$(jq -nc --argjson before "$QUEUE_BEFORE" '{state: "already_valid", revision: $before.revision, orderValid: $before.orderValid, unpositionedCount: $before.unpositionedCount}')"
  echo "Queue: already valid at revision $QUEUE_REVISION; nothing to arrange."
else
  QUEUE_REQUEST_ID="$(jq -r '.requestId' <<<"$QUEUE_PLAN")"
  QUEUE_ORDER_JSON="$(jq -c '.order' <<<"$QUEUE_PLAN")"
  ORDER_ARGS=()
  while IFS= read -r order_key; do ORDER_ARGS+=("$order_key"); done < <(jq -r '.[]' <<<"$QUEUE_ORDER_JSON")
  # Every key is its own argv element (the option is variadic), the workspace is the one verified above, and
  # ARCADIA_WORKSPACE is never set or exported.
  QUEUE_PREVIEW="$(arcadia advance queue arrange --order "${ORDER_ARGS[@]}" --request-id "$QUEUE_REQUEST_ID" --revision "$QUEUE_REVISION" --workspace "$WORKSPACE" --json)" || refuse "the queue arrange preview failed at revision $QUEUE_REVISION"
  printf '%s\n' "$QUEUE_PREVIEW" > "$RUN_DIR/queue-arrange-preview.json"
  jq -e --argjson order "$QUEUE_ORDER_JSON" --argjson revision "$QUEUE_REVISION" '.ok == true and .data.receipt.applied == false and .data.receipt.revisionBefore == $revision and .data.receipt.after == $order' <<<"$QUEUE_PREVIEW" >/dev/null \
    || refuse "the queue arrange preview is not the planned order at revision $QUEUE_REVISION; nothing was arranged"
  QUEUE_APPLIED="$(arcadia advance queue arrange --order "${ORDER_ARGS[@]}" --request-id "$QUEUE_REQUEST_ID" --revision "$QUEUE_REVISION" --workspace "$WORKSPACE" --apply --json)" || refuse "the queue arrange apply failed at revision $QUEUE_REVISION"
  printf '%s\n' "$QUEUE_APPLIED" > "$RUN_DIR/queue-arrange-applied.json"
  jq -e --argjson order "$QUEUE_ORDER_JSON" --argjson revision "$QUEUE_REVISION" '.ok == true and .data.receipt.applied == true and .data.receipt.revisionBefore == $revision and .data.receipt.revisionAfter == ($revision + 1) and .data.receipt.after == $order' <<<"$QUEUE_APPLIED" >/dev/null \
    || refuse "the applied queue arrangement is not the planned order"
  QUEUE_AFTER="$(queue_facts)" || refuse "the Action queue could not be read after the arrangement"
  record "queue" "$(jq -nc --argjson receipt "$(jq -c '.data.receipt | {id, requestId, revisionBefore, revisionAfter, applied}' <<<"$QUEUE_APPLIED")" --argjson plan "$QUEUE_PLAN" --argjson after "$QUEUE_AFTER" \
    '{state: "arranged", receipt: $receipt, order: $plan.order, othersUnpositioned: $plan.othersUnpositioned, after: {revision: $after.revision, orderValid: $after.orderValid, unpositionedCount: $after.unpositionedCount}}')"
  echo "Queue: arranged at revision $QUEUE_REVISION (receipt $(jq -r '.data.receipt.id' <<<"$QUEUE_APPLIED")): $QUEUE_KEY follows every other key."
fi
# The governed answer, read back: never inferred from an exit code.
jq -e '.orderValid == true and .unpositionedCount == 0' <<<"$QUEUE_AFTER" >/dev/null || refuse "the Action queue is not orderValid with zero unpositioned Actions after the reset: $(jq -c '{revision, orderValid, unpositionedCount}' <<<"$QUEUE_AFTER")"

STAGE=complete
REASON=""
record "fixtureCommitted" "$LOCAL_COMMITTED"
record "githubRepositoryChanged" "$REMOTE_CHANGED"
write_receipt succeeded
echo "RESET: fixture $REPO main is now $NEW_HEAD, one commit on $BASE reopening $ACTION with completion id $COMPLETION_ID."
echo "Earlier candidates unchanged. No proposal settled. Production untouched. Action queue valid."
echo "Receipt: $RECEIPT"
