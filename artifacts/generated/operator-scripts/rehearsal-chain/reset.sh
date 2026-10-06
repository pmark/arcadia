#!/usr/bin/env bash
# Rehearsal chain: reset the disposable rehearsal fixture for one run of an
# N-Action serial chain (N 3 to 12), driven only by that run's reviewed
# parameter file (rehearsal-chain/params/<run-id>.json), which its per-run
# library launcher passes. The new line always starts from the previous run's
# reset head on GitHub. If the previous run integrated work by local
# fast-forward (the fixture clone's local main ahead of GitHub main), the reset
# first proves that exact pinned commit is preserved on an earlier candidate's
# remote branch and pull request (every earlier candidate verified untouched,
# locally, on GitHub and as its pull request head) and then moves ONLY the
# clone's local main back to GitHub main, with a compare-and-swap ref update.
# It renders the fixture Plan as a serial chain (G1's three Actions amended,
# chain-step-04 onward appended, each reading its predecessor's output) with a
# fresh requirement input revision, a fresh unused completion id and the
# leave-git-status-clean rule on every Action, validates it with Arcadia's own
# discovery, docs sync, ready set, requirementIdentity and a read-only live
# dry-run docs sync, refuses any pending fixture proposal or open Decision that
# gates a chain Action (it settles none), then commits once, pushes without
# force, runs docs sync and writes a receipt. `--dry-run` performs every read
# and validation and prints the exact planned change and every refusal, writing
# nothing outside a temporary evidence directory. It never previews, activates
# or deactivates production, touches a Grant, an earlier candidate, branch or
# pull request, force-pushes, rewrites history, restarts anything or launches a
# Session.
set -Eeuo pipefail

IMPL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LIBRARY_DIR="$(cd "$IMPL_DIR/.." && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
KIND_PREFIX="reset-rehearsal-chain-fixture"
IMPL_FILE="reset.sh"
G1_ID="prepare-three-action-rehearsal-fixture-2026-10-04"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST_NAME=".arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_NAME="Three Action Rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
PLAN_FILE="docs/plans/$FIXTURE_PLAN.md"
G1_ACTIONS_JSON='["write-start-marker","transform-start-marker","verify-final-rehearsal"]'
PROVIDER="claude-code-cli"
REPO_DESCRIPTION="Disposable Arcadia three-Action rehearsal fixture (arcadia-three-action-rehearsal-v1); safe to delete after its recorded review."
OWNER_PATTERN='^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
NAME_PATTERN='^arcadia-three-action-rehearsal(-[a-z0-9]{1,24})?$'
RUN_PARAM_PATTERN='^run[0-9]{1,3}-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
DATE_LINE_PATTERN='^updated: [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$'

# --- Launcher binding: only this run's published launcher and parameter file. ---
PARAMS_FILE="${1:-}"
MODE="${2:-run}"
case "$MODE" in run | --dry-run | --describe) ;; *) echo "usage: <launcher> [run|--dry-run|--describe]" >&2; exit 2 ;; esac
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
DRY_RUN=false
[[ "$MODE" == --dry-run ]] && DRY_RUN=true

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [[ "$DRY_RUN" == true ]]; then
  # A dry run writes nothing in the library, the fixture, GitHub or the workspace: its evidence goes to a fresh temporary directory.
  RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rehearsal-chain-dry-run.XXXXXX")"
else
  RUN_DIR="$LIBRARY_DIR/runs/$RUN_ID"
  mkdir -p "$RUN_DIR"
fi
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/receipt.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exec > >(tee -a "$LOG") 2>&1

STAGE=parameters
REASON=""
RECOVERY=""
EXTRA=""
REMOTE_CHANGED=false
LOCAL_COMMITTED=false
LOCAL_MAIN_MOVED=false
RESET_STATE=""
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
  record "localMainMoved" "$LOCAL_MAIN_MOVED"
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
    [[ -z "$RESET_STATE" ]] || echo "Fixture state found at the start of this run: $RESET_STATE."
    if [[ "$DRY_RUN" == true ]]; then
      echo "This was a dry run: it wrote nothing outside $RUN_DIR."
      [[ -z "$WOULD_REFUSE" ]] || { echo; echo "Refusals noted before it stopped:"; printf '%s' "$WOULD_REFUSE"; }
    elif [[ "$REMOTE_CHANGED" == true ]]; then
      echo "This run pushed (never forced) the reset commit to fixture main before stopping, or attempted to. Rerunning re-reads GitHub main and resumes at docs sync once it is the reset head."
    elif [[ "$LOCAL_COMMITTED" == true ]]; then
      echo "This run committed the reset on local fixture main but pushed nothing. Rerunning re-validates that exact commit and pushes it."
    elif [[ "$LOCAL_MAIN_MOVED" == true ]]; then
      echo "This run moved only the fixture clone's local main back to GitHub main ${RESET_HEAD:-} (the previous local main stays on its preserved candidate branch and pull request, and in the clone's reflog) and committed nothing. Rerunning starts from GitHub main."
    else
      echo "This run made no fixture change: no ref moved, no commit, no push."
    fi
    echo
    if [[ -n "$RECOVERY" ]]; then echo "## Recovery"; echo; echo "$RECOVERY"
    else echo "Correct the named precondition and rerun. Do not edit the script, the parameter file's reviewed values, the fixture Plan, the fixture history or the workspace database by hand."
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

echo "== Rehearsal chain reset for $RUN_PARAM_ID ($MODE; no production change) =="
record_str paramsFile "$PARAMS_FILE"
[[ "$DRY_RUN" == false ]] || echo "Dry run: evidence in $RUN_DIR; nothing is written to the library, the fixture, GitHub or the workspace."

# --- The reviewed parameter file, validated and expanded by the tested pure module. ---
for tool in git jq mise gh timeout node tar diff; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
# Reviewed, not merely rendered: this run's parameter file, launcher, descriptor and the shared
# implementation must all be tracked and unmodified at the checkout's HEAD (artifacts/generated is gitignored).
for reviewed in "$PARAMS_FILE" "$LIBRARY_DIR/$SCRIPT_ID.sh" "$LIBRARY_DIR/$SCRIPT_ID.json" "$IMPL_DIR/$IMPL_FILE"; do
  git -C "$ARCADIA_REPO" ls-files --error-unmatch -- "$reviewed" >/dev/null 2>&1 && git -C "$ARCADIA_REPO" diff --quiet HEAD -- "$reviewed" \
    || refuse "$reviewed is not tracked and unmodified at the checkout's HEAD; a run's parameter file, launcher, descriptor and implementation must be reviewed and committed before they run"
done
cat > "$RUN_DIR/params.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { validateChainParams, chainActionIds, completionRequestId, chainLibraryIds, resetCommitSubject } from "./src/operatorActions/rehearsalChain.ts";
const [file] = process.argv.slice(2);
let raw;
try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (error) { console.log(JSON.stringify({ problems: [`unreadable parameter file: ${error.message}`], unfilled: [] })); process.exit(0); }
const { params, problems, unfilled } = validateChainParams(raw);
if (!params) { console.log(JSON.stringify({ problems, unfilled })); process.exit(0); }
const actionIds = chainActionIds(params.actionCount);
console.log(JSON.stringify({
  problems, unfilled, params,
  actionIds, completionIds: actionIds.map((id) => completionRequestId(id, params.runId)),
  ids: chainLibraryIds(params.runId), subject: resetCommitSubject(params)
}));
NODE
PARAMS="$(probe "$PARAMS_FILE" < "$RUN_DIR/params.mjs")" || refuse "the parameter file could not be validated"
printf '%s\n' "$PARAMS" > "$RUN_DIR/params-validation.json"
jq -e '.problems == []' <<<"$PARAMS" >/dev/null || refuse "the parameter file $PARAMS_FILE is invalid: $(jq -c '.problems' <<<"$PARAMS")"
jq -e --arg run "$RUN_PARAM_ID" --arg id "$SCRIPT_ID" '.params.runId == $run and .ids.reset == $id' <<<"$PARAMS" >/dev/null || refuse "the parameter file's runId does not match its file name $RUN_PARAM_ID"
# The reset needs every previous-run binding; the required commits are G6's and G7's.
BINDINGS_UNFILLED="$(jq -c '[.unfilled[] | select(startswith("params.previousRun"))]' <<<"$PARAMS")"
[[ "$BINDINGS_UNFILLED" == "[]" ]] || refuse "the parameter file still has UNFILLED previous-run bindings: $BINDINGS_UNFILLED; fill them from the previous run's receipts (see its notes) through a reviewed change"
COMMITS_UNFILLED="$(jq -c '[.unfilled[] | select(startswith("params.requiredCommits"))]' <<<"$PARAMS")"
[[ "$COMMITS_UNFILLED" == "[]" ]] || echo "Note: required commits $COMMITS_UNFILLED are UNFILLED; the reset does not use them, but G6 and G7 refuse until they are filled."
N="$(jq -r '.params.actionCount' <<<"$PARAMS")"
RUN_LABEL="$(jq -r '.params.runLabel' <<<"$PARAMS")"
ACTION_IDS_JSON="$(jq -c '.actionIds' <<<"$PARAMS")"
COMPLETION_IDS_JSON="$(jq -c '.completionIds' <<<"$PARAMS")"
RESET_SUBJECT="$(jq -r '.subject' <<<"$PARAMS")"
PREV_LABEL="$(jq -r '.params.previousRun.label' <<<"$PARAMS")"
PREV_RESET_ID="$(jq -r '.params.previousRun.resetId' <<<"$PARAMS")"
PREV_G8_ID="$(jq -r '.params.previousRun.terminalOffId' <<<"$PARAMS")"
PREV_RESET_RUN="$(jq -r '.params.previousRun.bindings.resetRunId' <<<"$PARAMS")"
RESET_HEAD="$(jq -r '.params.previousRun.bindings.resetHead' <<<"$PARAMS")"
PREV_G8_RUN="$(jq -r '.params.previousRun.bindings.terminalOffRunId' <<<"$PARAMS")"
PINNED_LOCAL_MAIN="$(jq -r '.params.previousRun.bindings.localMain' <<<"$PARAMS")"
CANDIDATES_JSON="$(jq -c '.params.previousRun.bindings.candidates' <<<"$PARAMS")"
record_str chainRunId "$RUN_PARAM_ID"
record actionCount "$N"
record actionIds "$ACTION_IDS_JSON"
record completionIds "$COMPLETION_IDS_JSON"
echo "Run $RUN_LABEL: $N Actions $(jq -r 'join(" -> ")' <<<"$ACTION_IDS_JSON"); the new line starts from $PREV_LABEL's reset head $RESET_HEAD."

# The repository identifier is operator input, never defaulted or derived.
REQUESTED_REPO="${ARCADIA_REHEARSAL_GITHUB_REPO:-}"
[[ -n "$REQUESTED_REPO" ]] || refuse "ARCADIA_REHEARSAL_GITHUB_REPO is required: set it to the exact owner/name of the fixture repository G1 prepared, then run this from a terminal"
[[ "$REQUESTED_REPO" == */* && "${REQUESTED_REPO#*/}" != */* ]] || refuse "ARCADIA_REHEARSAL_GITHUB_REPO must be exactly owner/name"
OWNER="${REQUESTED_REPO%%/*}"
NAME="${REQUESTED_REPO#*/}"
[[ "$OWNER" =~ $OWNER_PATTERN ]] || refuse "repository owner '$OWNER' is not a valid GitHub login"
[[ "$NAME" =~ $NAME_PATTERN ]] || refuse "repository name '$NAME' does not match the disposable-fixture pattern $NAME_PATTERN"
REPO="$OWNER/$NAME"
record_str githubRepository "$REPO"
record_str fixtureRoot "$FIXTURE_REPO"
record_str planFile "$PLAN_FILE"

STAGE=preflight
[[ "$(git -C "$ARCADIA_REPO" rev-parse --show-toplevel 2>/dev/null)" == "$ARCADIA_REPO" ]] || refuse "the operator-script library is not inside the Arcadia checkout"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || would_refuse "the Arcadia checkout must be on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || would_refuse "the Arcadia checkout must be clean"
# The reviewed head, as G6 and G7 require it: HEAD level with last-fetched origin/main and with a fresh ls-remote of it.
ARCADIA_HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)"
[[ "$ARCADIA_HEAD" == "$(git -C "$ARCADIA_REPO" rev-parse -q --verify origin/main 2>/dev/null)" ]] || would_refuse "the Arcadia checkout's HEAD $ARCADIA_HEAD is not level with its last-fetched origin/main; fetch and fast-forward main, then rerun"
REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main 2>/dev/null)" || REMOTE_LINE=""
ARCADIA_REMOTE_HEAD="${REMOTE_LINE%%[[:space:]]*}"
[[ "$ARCADIA_REMOTE_HEAD" == "$ARCADIA_HEAD" ]] || would_refuse "origin main observed now (${ARCADIA_REMOTE_HEAD:-unobserved within 30 seconds}) is not the checkout's HEAD $ARCADIA_HEAD; fetch and fast-forward main, then rerun"
record_str arcadiaHead "$ARCADIA_HEAD"
[[ -z "${ARCADIA_WORKSPACE+x}" ]] || refuse "ARCADIA_WORKSPACE is set in this shell, so the workspace would not resolve from user config; run 'unset ARCADIA_WORKSPACE' and rerun"
# Receipts are read from this library's runs/ only; a dry run run from a candidate checkout may read the main checkout's.
RECEIPTS_DIR="$LIBRARY_DIR/runs"
if [[ -n "${ARCADIA_REHEARSAL_RECEIPTS_DIR:-}" ]]; then
  [[ "$DRY_RUN" == true ]] || refuse "ARCADIA_REHEARSAL_RECEIPTS_DIR is honoured only by --dry-run; a real reset reads only its own library's receipts"
  RECEIPTS_DIR="$(cd "$ARCADIA_REHEARSAL_RECEIPTS_DIR" && pwd -P)" || refuse "ARCADIA_REHEARSAL_RECEIPTS_DIR is not a directory"
fi
record_str receiptsDir "$RECEIPTS_DIR"
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve from user config"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the CLI's default workspace is $WORKSPACE, not martianrover; refusing to sync the fixture elsewhere"
record_str workspace "$WORKSPACE"
# Production must be readable, Inactive and admit nothing while the fixture changes. A dry run
# reads it through the same command function, read-only, so it records no CLI activity row.
cat > "$RUN_DIR/probe-production.mjs" <<'NODE'
import { runProductionStatusCommand } from "./src/commands/production.ts";
const [workspace] = process.argv.slice(2);
console.log(JSON.stringify(runProductionStatusCommand({ workspace })));
NODE
production_quiet() {
  local status
  if [[ "$DRY_RUN" == true ]]; then status="$(probe "$WORKSPACE" < "$RUN_DIR/probe-production.mjs")" || return 1
  else status="$(arcadia production status --json)" || return 1
  fi
  printf '%s\n' "$status" > "$RUN_DIR/production-status-$1.json"
  jq -e '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive" and .data.liveAdmissions == 0' <<<"$status" >/dev/null
}
production_quiet before || would_refuse "production must be readable, Inactive and have zero live admissions while the fixture is reset (an unreadable store is not a confirmed Off)"
record "policyRevisionObserved" "$(jq '.data.read.policy.revision // null' "$RUN_DIR/production-status-before.json" 2>/dev/null || echo null)"

# --- The previous run's own records, bound exactly by the parameter file. ---
STAGE=prior_evidence
latest_receipt() {
  local id="$1" outcome="$2" candidate found=""
  for candidate in "$RECEIPTS_DIR"/*/receipt.json; do
    [[ -f "$candidate" ]] || continue
    if jq -e --arg id "$id" --arg outcome "$outcome" --arg repo "$3" '.id == $id and ($outcome == "" or .outcome == $outcome) and ($repo == "" or .githubRepository == $repo)' "$candidate" >/dev/null 2>&1; then found="$candidate"; fi
  done
  printf '%s' "$found"
}
G1_RECEIPT="$(latest_receipt "$G1_ID" succeeded "$REPO")"
[[ -n "$G1_RECEIPT" ]] || refuse "no succeeded G1 ($G1_ID) receipt exists for $REPO in $RECEIPTS_DIR; this script resets only the fixture G1 prepared"
GENESIS="$(jq -r '.rootCommit // empty' "$G1_RECEIPT")"
[[ "$GENESIS" =~ ^[0-9a-f]{40}$ ]] || refuse "the G1 receipt $G1_RECEIPT records no genesis commit"
record_str g1Receipt "$G1_RECEIPT"
record_str genesis "$GENESIS"
PREV_RESET_RECEIPT="$RECEIPTS_DIR/$PREV_RESET_RUN/receipt.json"
[[ -f "$PREV_RESET_RECEIPT" ]] && jq -e --arg id "$PREV_RESET_ID" --arg repo "$REPO" --arg head "$RESET_HEAD" --arg genesis "$GENESIS" \
  '.id == $id and .outcome == "succeeded" and .githubRepository == $repo and .newHead == $head and .remoteMainAfter == $head and .genesis == $genesis' "$PREV_RESET_RECEIPT" >/dev/null \
  || refuse "$PREV_LABEL's reset is not recorded as the parameter file binds it: $PREV_RESET_RECEIPT must be a succeeded $PREV_RESET_ID receipt for $REPO with newHead and remoteMainAfter $RESET_HEAD and genesis $GENESIS"
record_str previousResetReceipt "$PREV_RESET_RECEIPT"
record_str previousMain "$RESET_HEAD"
PREV_G8_RECEIPT="$RECEIPTS_DIR/$PREV_G8_RUN/receipt.json"
[[ -f "$PREV_G8_RECEIPT" ]] && jq -e --arg id "$PREV_G8_ID" --arg run "$PREV_G8_RUN" --arg main "$PINNED_LOCAL_MAIN" \
  '.id == $id and .runId == $run and .outcome == "succeeded" and .offState == "confirmed" and .fixtureMain == $main' "$PREV_G8_RECEIPT" >/dev/null \
  || refuse "$PREV_LABEL's terminal Off is not recorded as the parameter file binds it: $PREV_G8_RECEIPT must be a succeeded, Off-confirmed $PREV_G8_ID receipt with fixtureMain $PINNED_LOCAL_MAIN"
# No later run of that G8 past its launch guard may have refused since (a launch-guard refusal ran no Arcadia command).
LATEST_G8=""
for candidate in "$RECEIPTS_DIR"/*/receipt.json; do
  [[ -f "$candidate" ]] || continue
  if jq -e --arg id "$PREV_G8_ID" '.id == $id and .stage != "launch_context"' "$candidate" >/dev/null 2>&1; then LATEST_G8="$candidate"; fi
done
jq -e --arg run "$PREV_G8_RUN" --arg main "$PINNED_LOCAL_MAIN" '.outcome == "succeeded" and .offState == "confirmed" and (.runId | type == "string") and .runId >= $run and .fixtureMain == $main' "$LATEST_G8" >/dev/null 2>&1 \
  || refuse "the latest $PREV_G8_ID receipt past its launch guard ($LATEST_G8) is not a succeeded, Off-confirmed run at or after $PREV_G8_RUN with fixtureMain $PINNED_LOCAL_MAIN"
record_str previousTerminalOffReceipt "$PREV_G8_RECEIPT"
WORK_RECONCILIATION="$RECEIPTS_DIR/$PREV_G8_RUN/work-reconciliation.jsonl"
[[ -f "$WORK_RECONCILIATION" ]] || refuse "$PREV_LABEL's terminal Off has no work-reconciliation.jsonl at $WORK_RECONCILIATION"
cat > "$RUN_DIR/reconciliation.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { reconciliationProblems } from "./src/operatorActions/rehearsalChain.ts";
const [file, candidates] = process.argv.slice(2);
const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
console.log(JSON.stringify({ sessions: lines.length, problems: reconciliationProblems(lines, JSON.parse(candidates)) }));
NODE
RECONCILED="$(probe "$WORK_RECONCILIATION" "$CANDIDATES_JSON" < "$RUN_DIR/reconciliation.mjs")" || refuse "the previous terminal Off's work reconciliation could not be read"
jq -e '.problems == []' <<<"$RECONCILED" >/dev/null || would_refuse "the parameter file's candidates do not cover $PREV_LABEL's terminal-Off reconciliation exactly: $(jq -c '.problems' <<<"$RECONCILED")"

STAGE=local_fixture
[[ -f "$FIXTURE_REPO/$MANIFEST_NAME" ]] || refuse "$FIXTURE_REPO is not the G1 fixture (no $MANIFEST_NAME)"
jq -e --arg repo "$REPO" --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --argjson actions "$G1_ACTIONS_JSON" --arg provider "$PROVIDER" \
  '.schema == "arcadia-three-action-rehearsal-fixture-v1" and .githubRepository == $repo and .fixtureProject == $p and .fixturePlan == $plan and .actions == $actions and .provider == $provider' \
  "$FIXTURE_REPO/$MANIFEST_NAME" >/dev/null || refuse "the fixture manifest does not name $REPO with G1's exact Project, Plan, Actions and provider"
[[ "$(fx branch --show-current)" == main ]] || refuse "the local fixture is not on main"
[[ -z "$(fx status --porcelain --untracked-files=all)" ]] || refuse "the local fixture working tree is dirty or has untracked files"
ORIGIN="$(fx remote get-url origin)" || refuse "the local fixture has no origin remote"
[[ "$ORIGIN" == "https://github.com/$REPO.git" || "$ORIGIN" == "git@github.com:$REPO.git" ]] || refuse "the local fixture origin is $ORIGIN, not $REPO"
[[ "$(fx rev-list --max-parents=0 HEAD)" == "$GENESIS" ]] || refuse "the local fixture's single root is not G1's genesis $GENESIS"
[[ "$(fx rev-parse --verify -q "$RESET_HEAD^{commit}" 2>/dev/null)" == "$RESET_HEAD" ]] && fx merge-base --is-ancestor "$GENESIS" "$RESET_HEAD" \
  || refuse "the local fixture does not hold $PREV_LABEL's reset head $RESET_HEAD on genesis $GENESIS"
PROJECT_MARKER="$FIXTURE_REPO/.git/arcadia-three-action-project-id"
[[ -s "$PROJECT_MARKER" ]] || refuse "the local fixture has no G1 registration marker (.git/arcadia-three-action-project-id)"
MARKER_ID="$(<"$PROJECT_MARKER")"
LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
record_str localMainBefore "$LOCAL_MAIN"
record_str startingHead "$LOCAL_MAIN"

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
  return { projectId: project?.id ?? null, repoPath: metadata?.repo_path ?? null, active: active.length, fixtureActive: active.filter((s) => s.project_slug === slug).map((s) => s.id) };
})));
NODE
REGISTRATION="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" < "$RUN_DIR/probe-registration.mjs")" || refuse "the fixture Project's registration and Session leases could not be read"
printf '%s\n' "$REGISTRATION" > "$RUN_DIR/registration.json"
FIXTURE_REAL="$(cd "$FIXTURE_REPO" && pwd -P)"
jq -e --arg id "$MARKER_ID" --arg root "$FIXTURE_REPO" --arg real "$FIXTURE_REAL" '.projectId == $id and (.repoPath == $root or .repoPath == $real)' <<<"$REGISTRATION" >/dev/null \
  || refuse "Project $FIXTURE_PROJECT is not registered from $FIXTURE_REPO under G1's marker $MARKER_ID: $(jq -c '{projectId, repoPath}' <<<"$REGISTRATION")"
jq -e '.fixtureActive == []' <<<"$REGISTRATION" >/dev/null || would_refuse "fixture Sessions are prepared or running: $(jq -c '.fixtureActive' <<<"$REGISTRATION")"
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

# Every earlier candidate exactly as the parameter file pins it: local branch, GitHub
# branch and pull request head, before and after; with whether it contains the pinned local main.
check_candidates() {
  local label="$1" count index branch tip number local_tip remote_tip pr contains entries=""
  count="$(jq 'length' <<<"$CANDIDATES_JSON")"
  for ((index = 0; index < count; index++)); do
    branch="$(jq -r ".[$index].branch" <<<"$CANDIDATES_JSON")"
    tip="$(jq -r ".[$index].tip" <<<"$CANDIDATES_JSON")"
    number="$(jq -r ".[$index].pullRequest" <<<"$CANDIDATES_JSON")"
    local_tip="$(fx rev-parse --verify -q "refs/heads/$branch" 2>/dev/null || true)"
    [[ "$local_tip" == "$tip" ]] || would_refuse "local branch $branch is ${local_tip:-missing}, not the pinned $tip"
    remote_tip="$(ghx api "repos/$REPO/branches/$branch" --jq .commit.sha)" || { remote_tip=""; would_refuse "could not read $branch on $REPO"; }
    [[ "$remote_tip" == "$tip" ]] || would_refuse "GitHub branch $branch is ${remote_tip:-unreadable}, not the pinned $tip"
    pr="$(ghx api "repos/$REPO/pulls/$number")" || { pr='{}'; would_refuse "could not read pull request #$number of $REPO"; }
    jq -e --arg tip "$tip" --arg branch "$branch" '.head.sha == $tip and .head.ref == $branch' <<<"$pr" >/dev/null 2>&1 \
      || would_refuse "pull request #$number is not the pinned candidate $tip on $branch: $(jq -c '{head: .head.ref, sha: .head.sha}' <<<"$pr" 2>/dev/null)"
    contains=false
    fx merge-base --is-ancestor "$PINNED_LOCAL_MAIN" "$tip" 2>/dev/null && contains=true
    entries="${entries:+$entries,}$(jq -nc --arg branch "$branch" --arg tip "$tip" --arg localTip "$local_tip" --arg remoteTip "$remote_tip" --argjson pr "$pr" --argjson number "$number" --argjson contains "$contains" \
      '{branch: $branch, tip: $tip, pullRequest: $number, localTip: $localTip, remoteTip: $remoteTip, prTip: ($pr.head.sha // null), prState: ($pr.state // null), containsExpectedLocalMain: $contains}')"
  done
  printf '%s\n' "[$entries]" > "$RUN_DIR/candidates-$label.json"
}
STAGE=candidates
check_candidates before
record "candidatesBefore" "$(cat "$RUN_DIR/candidates-before.json")"

# --- Render the chain Plan from the previous run's reset head (never from local main). ---
STAGE=render_amendment
# Resuming a reset commit made on an earlier UTC date renders with that commit's own date.
RESET_DATE="$(date -u +%F)"
for head in "$LOCAL_MAIN" "$REMOTE_MAIN"; do
  if [[ "$head" != "$RESET_HEAD" && "$(fx rev-parse "$head^" 2>/dev/null)" == "$RESET_HEAD" && "$(fx log -1 --format=%s "$head" 2>/dev/null)" == "$RESET_SUBJECT" ]]; then
    COMMIT_DATE="$(fx show "$head:$PLAN_FILE" 2>/dev/null | grep -- "$DATE_LINE_PATTERN" | head -n 1 || true)"
    [[ -n "$COMMIT_DATE" ]] && RESET_DATE="${COMMIT_DATE#updated: }"
  fi
done
GENESIS_DIR="$RUN_DIR/.fixture-genesis"
BEFORE_DIR="$RUN_DIR/.fixture-previous"
AMEND_DIR="$RUN_DIR/.fixture-amended"
mkdir -p "$GENESIS_DIR" "$BEFORE_DIR" "$AMEND_DIR"
fx archive "$GENESIS" | tar -x -C "$GENESIS_DIR"
fx archive "$RESET_HEAD" | tar -x -C "$BEFORE_DIR"
fx archive "$RESET_HEAD" | tar -x -C "$AMEND_DIR"
cat > "$RUN_DIR/render.mjs" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { renderChainPlan, ChainPlanError } from "./src/operatorActions/rehearsalChain.ts";
const [paramsFile, basePlan, outPlan, resetDate] = process.argv.slice(2);
try {
  const rendered = renderChainPlan(readFileSync(basePlan, "utf8"), JSON.parse(readFileSync(paramsFile, "utf8")), resetDate);
  writeFileSync(outPlan, rendered.plan);
  console.log(JSON.stringify({ ok: true, planUpdatedBefore: rendered.planUpdatedBefore, actions: rendered.actions }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, reason: error instanceof ChainPlanError ? error.reason : "RENDER_FAILED", message: error.message }));
}
NODE
RENDER="$(probe "$PARAMS_FILE" "$BEFORE_DIR/$PLAN_FILE" "$AMEND_DIR/$PLAN_FILE" "$RESET_DATE" < "$RUN_DIR/render.mjs")" || refuse "the chain Plan could not be rendered"
printf '%s\n' "$RENDER" > "$RUN_DIR/render.json"
if ! jq -e '.ok == true' <<<"$RENDER" >/dev/null; then
  if [[ "$(jq -r '.reason' <<<"$RENDER")" == RESET_DATE_BEFORE_PLAN ]]; then
    RECOVERY="This host's UTC date ($RESET_DATE) is before the base Plan's updated: date, so docs sync would skip the amended Actions as older than their records and the Grant would dispatch nothing. Correct the host clock, or rerun on or after that date UTC. Do not hand-edit the date."
  fi
  refuse "the chain Plan was not rendered from $PREV_LABEL's reset head: $(jq -r '.message' <<<"$RENDER")"
fi
NEXT_ACTIONS_JSON="$(jq -c '[.actions[].nextAction]' <<<"$RENDER")"
jq -e --argjson ids "$ACTION_IDS_JSON" --argjson completions "$COMPLETION_IDS_JSON" '[.actions[].id] == $ids and [.actions[].completionId] == $completions' <<<"$RENDER" >/dev/null || refuse "the rendered chain does not carry exactly this run's Actions and completion ids"
CHANGED="$( (cd "$RUN_DIR" && diff -rq .fixture-previous .fixture-amended) | tr '\n' ' ' || true)"
[[ "$CHANGED" == "Files .fixture-previous/$PLAN_FILE and .fixture-amended/$PLAN_FILE differ " ]] || refuse "the rendered amendment changed more than the fixture Plan: $CHANGED"
AMENDED_BLOB="$(git hash-object "$AMEND_DIR/$PLAN_FILE")"
record_str amendedPlanBlob "$AMENDED_BLOB"
record_str planUpdatedBefore "$(jq -r '.planUpdatedBefore' <<<"$RENDER")"
record_str planUpdated "$RESET_DATE"
(cd "$RUN_DIR" && diff -u ".fixture-previous/$PLAN_FILE" ".fixture-amended/$PLAN_FILE") > "$RUN_DIR/plan.diff" || true

STAGE=validate_amendment
cat > "$RUN_DIR/validate-amendment.mjs" <<'NODE'
import { initWorkspace } from "./src/workspace/initWorkspace.ts";
import { withDatabase } from "./src/db/connection.ts";
import { createProjectWithInitialWork } from "./src/db/repositories.ts";
import { syncProjectDocs } from "./src/docs/sync.ts";
import { discoverDocs } from "./src/docs/discover.ts";
import { resolveReadySet } from "./src/docs/dispatch.ts";
import { requirementIdentity } from "./src/sessions/roleLineage.ts";
import { amendmentProblems } from "./src/operatorActions/rehearsalChain.ts";
const [genesisRoot, beforeRoot, fixtureRoot, scratchWorkspace, name, plan, project, actionIdsJson, nextActionsJson] = process.argv.slice(2);
const describe = (error) => `${error.relativePath}${error.field ? ` (${error.field})` : ""}: ${error.message}`;
initWorkspace(scratchWorkspace);
const sync = withDatabase(scratchWorkspace, (db) => {
  const { project: created } = createProjectWithInitialWork(db, {
    name, mission: "Disposable three-Action rehearsal fixture.", goal: "Disposable rehearsal fixture.", status: "active",
    currentMilestone: "Run the bounded three-Action rehearsal", nextAction: "Import fixture documents", workClassification: "agent"
  });
  return { slug: created.slug, result: syncProjectDocs(db, created, { apply: false, repoRoot: fixtureRoot }) };
});
const planOf = (root) => { const discovered = discoverDocs(root); return { discovered, doc: discovered.docs.find((entry) => entry.type === "plan" && entry.slug === plan) }; };
const genesis = planOf(genesisRoot), before = planOf(beforeRoot), after = planOf(fixtureRoot);
const projectDoc = after.discovered.docs.find((doc) => doc.type === "project");
const identities = (doc) => doc ? Object.fromEntries(doc.actions.map((action) => {
  const identity = requirementIdentity({ projectSlug: sync.slug, planSlug: plan, action });
  return [action.id, { requirementId: identity.requirementId, inputRevision: identity.inputRevision, criteriaFingerprint: identity.criteriaFingerprint }];
})) : null;
const readySet = resolveReadySet(fixtureRoot, sync.slug);
const observation = {
  importSlug: sync.slug,
  errors: sync.result.errors.map(describe).concat(after.discovered.errors.map(describe)),
  rejected: sync.result.rejected,
  readySetBlockers: readySet.blockers.map(describe),
  project: projectDoc ? { slug: projectDoc.slug, activePlan: projectDoc.activePlan, currentAction: projectDoc.currentAction } : null,
  actions: after.doc ? after.doc.actions.map((action) => ({ id: action.id, status: action.status, responsibility: action.responsibility, dependsOn: action.dependsOn })) : null,
  ready: readySet.ready.map((entry) => entry.actionId),
  candidates: readySet.candidates.map((entry) => ({ id: entry.actionId, ready: entry.ready, gate: entry.gate, blockers: entry.blockers.map((blocker) => blocker.field) })),
  beforeErrors: before.discovered.errors.map(describe).concat(genesis.discovered.errors.map(describe)),
  beforeActions: before.doc ? before.doc.actions : null,
  afterActions: after.doc ? after.doc.actions : null,
  genesisIdentity: identities(genesis.doc), beforeIdentity: identities(before.doc), afterIdentity: identities(after.doc)
};
const problems = amendmentProblems(observation, { project, plan, actionIds: JSON.parse(actionIdsJson), nextActions: JSON.parse(nextActionsJson) });
console.log(JSON.stringify({ problems, identities: { genesis: observation.genesisIdentity, before: observation.beforeIdentity, after: observation.afterIdentity }, ready: observation.ready }));
NODE
VALIDATION_OUT="$RUN_DIR/amendment-validation.json"
probe "$GENESIS_DIR" "$BEFORE_DIR" "$AMEND_DIR" "$RUN_DIR/.validation-workspace" "$FIXTURE_NAME" "$FIXTURE_PLAN" "$FIXTURE_PROJECT" "$ACTION_IDS_JSON" "$NEXT_ACTIONS_JSON" < "$RUN_DIR/validate-amendment.mjs" > "$VALIDATION_OUT" \
  || refuse "Arcadia's discovery could not run against the amended fixture (see $VALIDATION_OUT and the run log); nothing was changed"
jq -e '.problems | type == "array"' "$VALIDATION_OUT" >/dev/null 2>&1 || refuse "the amended fixture's validation output is unreadable (see $VALIDATION_OUT); nothing was changed"
jq -e '.problems == []' "$VALIDATION_OUT" >/dev/null || refuse "the amended fixture fails Arcadia's own validation, so nothing was changed: $(jq -c '.problems' "$VALIDATION_OUT")"
ACTIONS_RECORD="$(jq -c --argjson ids "$ACTION_IDS_JSON" --argjson completions "$COMPLETION_IDS_JSON" '[range(0; $ids | length) as $i | {id: $ids[$i], completionId: $completions[$i],
  requirementId: .identities.after[$ids[$i]].requirementId, inputRevisionBefore: (.identities.before[$ids[$i]].inputRevision // null),
  inputRevisionAfter: .identities.after[$ids[$i]].inputRevision, criteriaFingerprint: .identities.after[$ids[$i]].criteriaFingerprint}]' "$VALIDATION_OUT")"
record actions "$ACTIONS_RECORD"
echo "Amended fixture validated by Arcadia's discovery and docs sync: $N Actions, each with a fresh requirement input revision; only $(jq -r '.ready | join(", ")' "$VALIDATION_OUT") is ready."

# Read-only against the live workspace: no amended input has an attempt yet, and every
# Session that passed a development attempt for an earlier input of a chain Action is
# finished, preserved by the worker and clean, so the tick and the Action claim step past it.
STAGE=lineage
cat > "$RUN_DIR/probe-lineage.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
const [workspace, actionsJson] = process.argv.slice(2);
const actions = JSON.parse(actionsJson);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const sessionOf = (row) => { try { return JSON.parse(row.terminal_receipt_json ?? "null")?.sessionId ?? null; } catch { return null; } };
  return actions.map((action) => {
    const rows = tables.has("session_role_attempts") ? db.prepare("SELECT input_revision, role, ordinal, status, terminal_receipt_json FROM session_role_attempts WHERE requirement_id = ? ORDER BY created_at, rowid").all(action.requirementId) : [];
    const holders = rows.filter((row) => row.role === "development" && row.status === "passed" && row.input_revision !== action.inputRevisionAfter).map((row) => {
      const id = sessionOf(row);
      const session = id && tables.has("agent_sessions") ? db.prepare("SELECT id, status, worktree_path FROM agent_sessions WHERE id = ?").get(id) : null;
      const preserved = id && tables.has("candidate_preservation_receipts") ? Boolean(db.prepare("SELECT 1 FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${id}`)) : false;
      return { action: action.id, input: row.input_revision.slice(0, 12), sessionId: id, status: session ? session.status : "absent", worktree: session ? session.worktree_path : null, preserved };
    });
    return { action: action.id, attempts: rows.map((row) => ({ input: row.input_revision === action.inputRevisionAfter ? "amended" : row.input_revision.slice(0, 12), role: row.role, ordinal: row.ordinal, status: row.status })), holders };
  });
})));
NODE
LINEAGE="$(probe "$WORKSPACE" "$ACTIONS_RECORD" < "$RUN_DIR/probe-lineage.mjs")" || refuse "the attempt lineage could not be read"
printf '%s\n' "$LINEAGE" > "$RUN_DIR/lineage.json"
jq -e 'all(.[].attempts[]; .input != "amended")' <<<"$LINEAGE" >/dev/null || would_refuse "attempts already exist for an amended requirement input; the reset is not fresh: $(jq -c '[.[] | select(any(.attempts[]; .input == "amended")) | .action]' <<<"$LINEAGE")"
record "priorAttempts" "$(jq -c '[.[] | {action, attempts}]' <<<"$LINEAGE")"
record "priorHolders" "$(jq -c '[.[].holders[]]' <<<"$LINEAGE")"
jq -e 'all(.[].holders[]; .sessionId != null and (.status == "absent" or (.status != "prepared" and .status != "running" and .preserved == true)))' <<<"$LINEAGE" >/dev/null \
  || would_refuse "an earlier Session that passed a chain Action is live, unpreserved by the worker or unnamed, so the run could not dispatch past it: $(jq -c '[.[].holders[]]' <<<"$LINEAGE")"
while IFS= read -r HOLDER_WT; do
  [[ -n "$HOLDER_WT" && -d "$HOLDER_WT" ]] || continue
  HOLDER_STATUS="$(git -C "$HOLDER_WT" status --porcelain --untracked-files=all 2>/dev/null)" || { would_refuse "the earlier worktree $HOLDER_WT could not be read"; continue; }
  [[ -z "$HOLDER_STATUS" ]] || would_refuse "the earlier worktree $HOLDER_WT holds uncommitted work, so its Action claim stays and the run could not dispatch; it was not touched"
done < <(jq -r '.[].holders[].worktree // empty' <<<"$LINEAGE")

# Where the fixture is, decided by the tested pure rule.
STAGE=fixture_state
is_reset_commit() {
  local commit="$1"
  [[ "$commit" != "$RESET_HEAD" ]] \
    && [[ "$(fx rev-parse "$commit^" 2>/dev/null)" == "$RESET_HEAD" ]] \
    && [[ "$(fx rev-list --count "$RESET_HEAD..$commit" 2>/dev/null)" == 1 ]] \
    && [[ "$(fx log -1 --format=%s "$commit" 2>/dev/null)" == "$RESET_SUBJECT" ]] \
    && [[ "$(fx diff --name-only "$RESET_HEAD" "$commit" 2>/dev/null)" == "$PLAN_FILE" ]] \
    && [[ "$(fx rev-parse "$commit:$PLAN_FILE" 2>/dev/null)" == "$AMENDED_BLOB" ]]
}
LOCAL_IS_RESET=false; is_reset_commit "$LOCAL_MAIN" && LOCAL_IS_RESET=true
REMOTE_IS_RESET=false
if [[ "$(fx rev-parse --verify -q "$REMOTE_MAIN^{commit}" 2>/dev/null)" == "$REMOTE_MAIN" ]] && is_reset_commit "$REMOTE_MAIN"; then REMOTE_IS_RESET=true; fi
ANCESTOR=false; fx merge-base --is-ancestor "$RESET_HEAD" "$PINNED_LOCAL_MAIN" 2>/dev/null && ANCESTOR=true
FACTS="$(jq -nc --arg remoteMain "$REMOTE_MAIN" --arg localMain "$LOCAL_MAIN" --arg resetHead "$RESET_HEAD" --arg expected "$PINNED_LOCAL_MAIN" --argjson ancestor "$ANCESTOR" \
  --argjson candidates "$(jq -c '[.[] | {branch, tip, pullRequest, containsExpectedLocalMain}]' "$RUN_DIR/candidates-before.json")" --argjson localReset "$LOCAL_IS_RESET" --argjson remoteReset "$REMOTE_IS_RESET" \
  '{remoteMain: $remoteMain, localMain: $localMain, resetHead: $resetHead, expectedLocalMain: $expected, resetHeadIsAncestorOfExpectedLocalMain: $ancestor, candidates: $candidates, localMainIsResetCommit: $localReset, remoteMainIsResetCommit: $remoteReset}')"
cat > "$RUN_DIR/decide.mjs" <<'NODE'
import { decideFixtureStart } from "./src/operatorActions/rehearsalChain.ts";
console.log(JSON.stringify(decideFixtureStart(JSON.parse(process.argv[2]))));
NODE
DECISION="$(probe "$FACTS" < "$RUN_DIR/decide.mjs")" || refuse "the fixture's starting state could not be decided"
printf '%s\n' "$DECISION" > "$RUN_DIR/fixture-start.json"
RESET_STATE="$(jq -r '.state // "refused"' <<<"$DECISION")"
record_str resetState "$RESET_STATE"
record "localMainPreservedOn" "$(jq -c '.preservedOn' <<<"$DECISION")"
if ! jq -e '.refusals == []' <<<"$DECISION" >/dev/null; then
  RECOVERY="The fixture is not where $PREV_LABEL left it, or its locally integrated work is not provably preserved remotely. This script never rewrites history or forces anything. Read 'git -C $FIXTURE_REPO log --oneline --graph --all -12', the GitHub main of $REPO and its pull requests, and ask for a reviewed parameter change (or a new reviewed reset) that matches the real state."
  would_refuse "the fixture's starting state refuses: $(jq -c '.refusals' <<<"$DECISION")"
fi
if [[ "$RESET_STATE" == pushed ]]; then
  PRIOR="$(latest_receipt "$SCRIPT_ID" succeeded "$REPO")"
  if [[ -n "$PRIOR" ]] && jq -e --arg head "$LOCAL_MAIN" '.newHead == $head' "$PRIOR" >/dev/null; then
    refuse "the reset already succeeded at fixture head $LOCAL_MAIN ($PRIOR); it is not applied twice. Run this run's G6 preflight next"
  fi
fi
echo "Fixture state: $RESET_STATE (local main $LOCAL_MAIN, GitHub main $REMOTE_MAIN, $PREV_LABEL's reset head $RESET_HEAD)."

# Read-only against the live workspace: a dry-run docs sync of the amended tree must apply
# every chain Action (an update or a create, none skipped as older than its record).
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
  return { liveDryRun: {
    errors: result.errors.map((error) => `${error.relativePath}: ${error.message}`),
    actions: result.changes.filter((change) => change.entity === "action").map((change) => ({ ref: change.ref, action: change.action, reason: change.reason ?? null }))
  } };
})));
NODE
LIVE_SYNC="$(probe "$WORKSPACE" "$FIXTURE_PROJECT" "$AMEND_DIR" < "$RUN_DIR/probe-live-sync.mjs")" || refuse "the live workspace's dry-run docs sync of the amended fixture could not run"
printf '%s\n' "$LIVE_SYNC" > "$RUN_DIR/live-sync-preview.json"
jq -e --arg plan "$FIXTURE_PLAN" --argjson ids "$ACTION_IDS_JSON" --arg state "$RESET_STATE" '.liveDryRun != null and (.liveDryRun.errors | length) == 0
  and (.liveDryRun.actions | map(select(.action == "skipped")) | length) == 0
  and (.liveDryRun.actions as $changes | all($ids[]; . as $id | ([$changes[] | select(.ref == "plan/\($plan)#\($id)") | .action] as $a | ($a | length) == 1 and ($a[0] == "update" or $a[0] == "create" or ($a[0] == "unchanged" and $state == "pushed")))))' \
  <<<"$LIVE_SYNC" >/dev/null \
  || would_refuse "the live workspace's dry-run docs sync would not apply every chain Action (an error, a skipped Action, or an Action that is not exactly one update or create): $(jq -c '.liveDryRun' <<<"$LIVE_SYNC" 2>/dev/null)"
record "liveSyncPreview" "$(jq -c '.liveDryRun.actions // null' <<<"$LIVE_SYNC")"

# Issue #968: a pending proposal or open Decision naming an in-scope Action makes the
# dispatch gate answer "decision", and the tick launches nothing. This reset settles none:
# each one refuses here, named with its own governed path. Settled ones are recorded as they are.
STAGE=proposal_gate
cat > "$RUN_DIR/probe-asks.mjs" <<'NODE'
import { withReadOnlyDatabase } from "./src/db/connection.ts";
import { readChainAskState } from "./src/operatorActions/rehearsalChainProbe.ts";
const [workspace, repoRoot, slug, actionsJson, requestsJson] = process.argv.slice(2);
console.log(JSON.stringify(withReadOnlyDatabase(workspace, (db) => readChainAskState(db, { repoRoot, projectSlug: slug, actionIds: JSON.parse(actionsJson), requestIds: JSON.parse(requestsJson) }))));
NODE
GATE="$(probe "$WORKSPACE" "$AMEND_DIR" "$FIXTURE_PROJECT" "$ACTION_IDS_JSON" "$COMPLETION_IDS_JSON" < "$RUN_DIR/probe-asks.mjs")" || refuse "the pending proposals and Decisions gating the fixture could not be read"
printf '%s\n' "$GATE" > "$RUN_DIR/proposal-gate.json"
record "fixtureProposalsBefore" "$(jq -c '.fixtureProposals' <<<"$GATE")"
PENDING="$(jq -c '[(.fixturePending[] | "pending proposal \(.requestId) (\(.id), \(.intent) \(.targetRef // "-"))"), (.blocking[] | "\(.kind) \(.id) gating \(.action): \(.title)\(if .settle then " (settle with: \(.settle))" else "" end)")] | unique' <<<"$GATE")"
if [[ "$PENDING" != "[]" ]]; then
  RECOVERY="Pending operator items gate the chain or sit on the fixture Project: $PENDING. This reset settles none of them. Give each its own governed disposition first (for a stale completion proposal of an earlier run, a rejection through its settle command with the operator's yes), then rerun."
  would_refuse "pending operator items would gate the chain: $PENDING"
fi
cat > "$RUN_DIR/completion-ids.mjs" <<'NODE'
import { completionIdProblems } from "./src/operatorActions/rehearsalChain.ts";
const [completions, used, files] = process.argv.slice(2);
console.log(JSON.stringify(completionIdProblems(JSON.parse(completions), JSON.parse(used), files.split("\n").filter(Boolean))));
NODE
ASK_FILES="$( (cd "$AMEND_DIR" && find .arcadia -name '*.yaml' 2>/dev/null) || true)"
COMPLETION_PROBLEMS="$(probe "$COMPLETION_IDS_JSON" "$(jq -c '.usedRequestIds' <<<"$GATE")" "$ASK_FILES" < "$RUN_DIR/completion-ids.mjs")" || refuse "completion-id freshness could not be checked"
[[ "$COMPLETION_PROBLEMS" == "[]" ]] || would_refuse "the fresh completion ids are not unused: $COMPLETION_PROBLEMS; ask for a reviewed parameter change with a new run id"

# --- A dry run stops here: it prints the exact planned change and every refusal. ---
if [[ "$DRY_RUN" == true ]]; then
  STAGE=dry_run_report
  echo
  echo "== DRY RUN: planned fixture change for $RUN_LABEL ($RUN_PARAM_ID), nothing written =="
  echo "Fixture: $REPO, clone $FIXTURE_REPO; state $RESET_STATE."
  echo "Starting head: local main $LOCAL_MAIN; GitHub main $REMOTE_MAIN."
  case "$RESET_STATE" in
    move_local_main) echo "Step 1: move ONLY the clone's local main from $LOCAL_MAIN back to GitHub main $RESET_HEAD (compare-and-swap; $LOCAL_MAIN stays on $(jq -r '[.preservedOn[] | "\(.branch) (PR #\(.pullRequest), tip \(.tip[0:8]))"] | join(", ")' <<<"$DECISION"))." ;;
    at_base) echo "Step 1: none; local main is already GitHub main $RESET_HEAD." ;;
    committed_unpushed) echo "Step 1: resume: the reset commit $LOCAL_MAIN is already on local main." ;;
    pushed) echo "Step 1: resume at docs sync: the reset commit $LOCAL_MAIN is already on GitHub main." ;;
    *) echo "Step 1: refused (see below)." ;;
  esac
  echo "Step 2: one commit '$RESET_SUBJECT' on $RESET_HEAD changing only $PLAN_FILE (blob $AMENDED_BLOB), pushed to fixture main without force; the new line starts from $RESET_HEAD."
  echo "Step 3: arcadia docs sync --project $FIXTURE_PROJECT --apply."
  echo "Actions and fresh completion ids:"
  jq -r '.[] | "  \(.id): completion \(.completionId); input \((.inputRevisionBefore // "new")[0:12]) -> \(.inputRevisionAfter[0:12])"' <<<"$ACTIONS_RECORD"
  echo "Live dry-run docs sync: $(jq -c '[.liveDryRun.actions[]? | "\(.ref | sub("^plan/[^#]+#"; ""))=\(.action)"]' <<<"$LIVE_SYNC")"
  echo "Earlier candidates (left untouched): $(jq -r '[.[] | "#\(.pullRequest) \(.branch)@\(.tip[0:8])"] | join(", ")' "$RUN_DIR/candidates-before.json")"
  echo "Plan diff: $RUN_DIR/plan.diff"
  cat "$RUN_DIR/plan.diff"
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
if [[ "$RESET_STATE" == move_local_main ]]; then
  STAGE=move_local_main
  production_quiet before_move || refuse "production left Inactive or admitted work before the local main move; nothing was changed"
  [[ -z "$(fx status --porcelain --untracked-files=all)" && "$(fx rev-parse refs/heads/main)" == "$LOCAL_MAIN" && "$(fx symbolic-ref HEAD)" == refs/heads/main ]] || refuse "the fixture changed during validation; nothing was moved"
  # Compare-and-swap: only from the exact pinned commit, recorded in the clone's reflog; then the
  # clean working tree follows the ref (a two-tree switch that refuses on any local change).
  # The move and the working tree following it are not interrupted by INT or TERM.
  trap '' INT TERM
  fx update-ref -m "$SCRIPT_ID: move local main back to GitHub main $RESET_HEAD; $LOCAL_MAIN is preserved on $(jq -r '[.preservedOn[].branch] | join(", ")' <<<"$DECISION")" refs/heads/main "$RESET_HEAD" "$LOCAL_MAIN"
  LOCAL_MAIN_MOVED=true
  if ! fx read-tree -m -u "$LOCAL_MAIN" "$RESET_HEAD"; then
    # The working tree did not follow: put local main back exactly where it was (compare-and-swap again), so nothing changed.
    if fx update-ref -m "$SCRIPT_ID: undo the local main move after the working tree did not follow" refs/heads/main "$LOCAL_MAIN" "$RESET_HEAD" && [[ -z "$(fx status --porcelain --untracked-files=all)" ]]; then
      LOCAL_MAIN_MOVED=false
      refuse "the working tree did not follow local main to $RESET_HEAD; local main was put back at $LOCAL_MAIN and nothing changed"
    fi
    if [[ "$(fx rev-parse refs/heads/main)" == "$LOCAL_MAIN" ]]; then
      RECOVERY="Local main is back at $LOCAL_MAIN but the working tree is not clean. Nothing is lost: $LOCAL_MAIN is on its preserved candidate branch and pull request and in the clone's reflog. Read 'git -C $FIXTURE_REPO status' and resolve the listed files before rerunning; do not discard anything you have not read."
    else
      RECOVERY="Local main points at $RESET_HEAD while the working tree may still hold $LOCAL_MAIN's files. Nothing is lost: $LOCAL_MAIN is on its preserved candidate branch and pull request and in the clone's reflog. Read 'git -C $FIXTURE_REPO status' and 'git -C $FIXTURE_REPO reflog -3 main', and restore local main with 'git -C $FIXTURE_REPO update-ref refs/heads/main $LOCAL_MAIN $RESET_HEAD' before rerunning."
    fi
    refuse "the working tree did not follow local main to $RESET_HEAD, and putting local main back could not be confirmed"
  fi
  trap - INT TERM
  [[ "$(fx rev-parse HEAD)" == "$RESET_HEAD" && -z "$(fx status --porcelain --untracked-files=all)" ]] || refuse "after the move the fixture is not clean at $RESET_HEAD"
  record "localMainMove" "$(jq -nc --arg from "$LOCAL_MAIN" --arg to "$RESET_HEAD" --argjson on "$(jq -c '.preservedOn' <<<"$DECISION")" '{from: $from, to: $to, preservedOn: $on}')"
  echo "Moved only the clone's local main from $LOCAL_MAIN back to GitHub main $RESET_HEAD."
  LOCAL_MAIN="$RESET_HEAD"
  RESET_STATE=at_base
fi

if [[ "$RESET_STATE" == at_base ]]; then
  STAGE=commit
  production_quiet before_commit || refuse "production left Inactive or admitted work before the commit; nothing was committed"
  cp "$AMEND_DIR/$PLAN_FILE" "$FIXTURE_REPO/$PLAN_FILE"
  [[ "$(fx status --porcelain --untracked-files=all)" == " M $PLAN_FILE" ]] || refuse "the working tree change is not exactly the fixture Plan"
  fx add -- "$PLAN_FILE"
  fx -c user.name='Arcadia Rehearsal Fixture' -c user.email='rehearsal@localhost' commit -q -m "$RESET_SUBJECT" \
    -m "Renders the fixture Plan as a $N-Action serial chain from $PREV_LABEL's reset head $RESET_HEAD: each Action's next_action carries a fresh run note (new requirement input revision, unused completion id, clean-tree rule); acceptance criteria of existing Actions are unchanged; earlier candidates are untouched."
  LOCAL_COMMITTED=true
  LOCAL_MAIN="$(fx rev-parse refs/heads/main)"
  is_reset_commit "$LOCAL_MAIN" || refuse "the new fixture commit is not exactly the validated amendment on $RESET_HEAD"
  RESET_STATE=committed_unpushed
fi
NEW_HEAD="$LOCAL_MAIN"
record_str newHead "$NEW_HEAD"

if [[ "$RESET_STATE" == committed_unpushed ]]; then
  STAGE=push
  production_quiet before_push || refuse "production left Inactive or admitted work before the push; nothing was pushed"
  REMOTE_CHANGED=true
  # Never forced: a GitHub main that moved off the previous reset head makes this push fail closed.
  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main
fi
REMOTE_AFTER="$(remote_main)" || refuse "could not read main of $REPO after the push"
[[ "$REMOTE_AFTER" == "$NEW_HEAD" ]] || refuse "GitHub main ($REMOTE_AFTER) is not the reset head ($NEW_HEAD)"
record_str remoteMainAfter "$REMOTE_AFTER"

STAGE=candidates_after
check_candidates after
record "candidatesAfter" "$(cat "$RUN_DIR/candidates-after.json")"

STAGE=docs_sync
SYNC="$(arcadia docs sync --project "$FIXTURE_PROJECT" --apply --json)" || SYNC=""
printf '%s\n' "$SYNC" > "$RUN_DIR/docs-sync.json"
jq -e '.ok == true and .data.errorCount == 0' <<<"$SYNC" >/dev/null 2>&1 || refuse "docs sync reported errors although the amended fixture validated before the push; see $RUN_DIR/docs-sync.json"
jq -e --arg plan "$FIXTURE_PLAN" --argjson ids "$ACTION_IDS_JSON" --arg state "$RESET_STATE" '[.data.projects[].changes[] | select(.entity == "action")] as $actions
  | ($actions | map(select(.action == "skipped")) | length) == 0
  and all($ids[]; . as $id | ([$actions[] | select(.ref == "plan/\($plan)#\($id)") | .action] as $a | ($a | length) == 1 and ($a[0] == "update" or $a[0] == "create" or ($a[0] == "unchanged" and $state == "pushed"))))' <<<"$SYNC" >/dev/null \
  || refuse "docs sync did not apply every chain Action (a change was skipped or missing); see $RUN_DIR/docs-sync.json"
WORK="$(arcadia work list --json)"
for action in $(jq -r '.[]' <<<"$ACTION_IDS_JSON"); do
  jq -e --arg ref "plan/$FIXTURE_PLAN#$action" '[.data.workItems[]? | select(.doc_ref == $ref)] | length == 1' <<<"$WORK" >/dev/null || refuse "Action $action is not synced exactly once after the reset"
done

STAGE=complete
REASON=""
record "fixtureCommitted" "$LOCAL_COMMITTED"
record "localMainMoved" "$LOCAL_MAIN_MOVED"
record "githubRepositoryChanged" "$REMOTE_CHANGED"
write_receipt succeeded
echo "RESET: fixture $REPO main is now $NEW_HEAD, one commit on $PREV_LABEL's reset head $RESET_HEAD: a $N-Action serial chain for $RUN_LABEL."
echo "Earlier candidates unchanged: $(jq -r '[.[] | "#\(.pullRequest)"] | join(", ")' "$RUN_DIR/candidates-after.json"). No proposal settled. Production untouched."
echo "Next: run this run's G6 preflight (preflight-rehearsal-chain-$RUN_PARAM_ID); it binds this receipt."
echo "Receipt: $RECEIPT"
