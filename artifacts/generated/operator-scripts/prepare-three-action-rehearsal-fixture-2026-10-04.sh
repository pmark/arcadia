#!/usr/bin/env bash
# G1: prepare the disposable three-Action rehearsal fixture. Preparation only.
# It first renders the fixture into a scratch directory and validates it with
# Arcadia's own discovery and docs-sync code (no Project registered, live
# workspace untouched). Only then does it create or reuse exactly one
# operator-named private GitHub repository, push only those same genesis bytes
# (one CI check so `statusCheckRollup` is not empty), register one fixture
# Project and seed its first build packet.
# It never previews or activates production policy, restarts a service,
# launches a Session, deletes or renames a repository, or rewrites history.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="prepare-three-action-rehearsal-fixture-2026-10-04"
ARCADIA_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
FIXTURE_REPO="$HOME/tmp/arcadia-three-action-rehearsal"
MANIFEST_NAME=".arcadia-three-action-rehearsal.json"
FIXTURE_PROJECT="three-action-rehearsal"
FIXTURE_NAME="Three Action Rehearsal"
FIXTURE_PLAN="autonomous-three-action-rehearsal"
ACTION_A="write-start-marker"
ACTION_B="transform-start-marker"
ACTION_C="verify-final-rehearsal"
PROVIDER="claude-code-cli"
PROFILE="claude_build"
VALIDATION_COMMAND="node scripts/check-rehearsal.mjs"
REPO_MARKER="arcadia-three-action-rehearsal-v1"
REPO_DESCRIPTION="Disposable Arcadia three-Action rehearsal fixture ($REPO_MARKER); safe to delete after its recorded review."
OWNER_PATTERN='^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
NAME_PATTERN='^arcadia-three-action-rehearsal(-[a-z0-9]{1,24})?$'

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
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"productionPreviewedOrActivated":false%s}\n' \
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
    echo "Production policy was not previewed or activated, no service was restarted and no Session was launched."
    if [[ "$REMOTE_CHANGED" == true ]]; then
      echo "This run created or pushed to the GitHub repository before stopping. Nothing was deleted or force-pushed;"
      echo "rerunning with the same ARCADIA_REHEARSAL_GITHUB_REPO reuses it once the named precondition is fixed."
    else
      echo "No GitHub repository was created or pushed by this run."
    fi
    if [[ -n "$RECOVERY" ]]; then
      echo
      echo "## Recovery"
      echo
      echo "$RECOVERY"
    else
      echo "Correct the named precondition and rerun this repeatable preparation. Do not edit the script by hand."
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
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

echo "== G1: prepare the three-Action rehearsal fixture (no production change) =="

# The repository identifier is the one free-form operator input. It is never
# defaulted, derived from the Project slug, or accepted from the dashboard.
REQUESTED_REPO="${ARCADIA_REHEARSAL_GITHUB_REPO:-}"
[[ -n "$REQUESTED_REPO" ]] || refuse "ARCADIA_REHEARSAL_GITHUB_REPO is required: set it to the exact owner/name of a disposable private GitHub repository whose name matches $NAME_PATTERN, then run this script from a terminal"
[[ "$REQUESTED_REPO" == */* && "${REQUESTED_REPO#*/}" != */* ]] || refuse "ARCADIA_REHEARSAL_GITHUB_REPO must be exactly owner/name"
OWNER="${REQUESTED_REPO%%/*}"
NAME="${REQUESTED_REPO#*/}"
[[ "$OWNER" =~ $OWNER_PATTERN ]] || refuse "repository owner '$OWNER' is not a valid GitHub login"
[[ "$NAME" =~ $NAME_PATTERN ]] || refuse "repository name '$NAME' does not match the disposable-fixture pattern $NAME_PATTERN"
REPO="$OWNER/$NAME"
record_str githubRepository "$REPO"
record_str fixtureRoot "$FIXTURE_REPO"

STAGE=preflight
for tool in git jq mise gh timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
[[ "$(git -C "$ARCADIA_REPO" rev-parse --show-toplevel 2>/dev/null)" == "$ARCADIA_REPO" ]] || refuse "the operator-script library is not inside the Arcadia checkout"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || refuse "the Arcadia checkout must be on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean"
STATUS="$(arcadia production status --json)"
printf '%s\n' "$STATUS" > "$RUN_DIR/production-status.json"
jq -e '.ok == true and .data.read.status == "ok"' <<<"$STATUS" >/dev/null || refuse "production status is unreadable; an unreadable store is not a confirmed Off"
# Import and sync use the CLI's default workspace; it must be the live martianrover workspace.
# An exported ARCADIA_WORKSPACE changes the resolution source, so it refuses by name.
[[ -z "${ARCADIA_WORKSPACE+x}" ]] || refuse "ARCADIA_WORKSPACE is set in this shell, so the workspace would not resolve from user config; run 'unset ARCADIA_WORKSPACE' and rerun (set it only inline on the recover-arcadia-host-services command)"
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve from user config"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the CLI's default workspace is $WORKSPACE, not martianrover; refusing to register the fixture elsewhere"
record_str workspace "$WORKSPACE"
POLICY_STATE="$(jq -r '.data.read.policy.desiredState' <<<"$STATUS")"
[[ "$POLICY_STATE" == inactive ]] || refuse "production must be Inactive while the fixture is prepared; it is $POLICY_STATE"
record "policyRevisionObserved" "$(jq '.data.read.policy.revision' <<<"$STATUS")"

# The exact genesis files. G1 renders them into a scratch directory and
# validates them there before any external mutation; the local fixture is then
# a copy of those same bytes. Host bash is 3.2: no heredoc sits inside $(...).
FIXTURE_DATE="$(date -u +%F)"
render_fixture() {
  local dir="$1"
  mkdir -p "$dir/scripts" "$dir/docs/plans" "$dir/.github/workflows"
  cat > "$dir/AGENTS.md" <<'EOF'
# AGENTS

Disposable Arcadia rehearsal fixture. Do not merge, deploy or publish from a
Session; integration is Arcadia's local fast-forward under its Grant.
EOF
  cat > "$dir/CONSTITUTION.md" <<'EOF'
# Constitution

- Do not merge, deploy, or publish from a Session.
- The genesis check `node scripts/check-rehearsal.mjs` judges every candidate; never edit it.
EOF
  cat > "$dir/scripts/check-rehearsal.mjs" <<'EOF'
// Genesis validation for the three-Action rehearsal. Committed before any
// Session, so no candidate can alter the check that judges it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const expected = ["three-action rehearsal start", "THREE-ACTION REHEARSAL START", "three-action rehearsal verified"];
if (existsSync("MARKER.md")) {
  const lines = readFileSync("MARKER.md", "utf8").split("\n");
  if (lines.at(-1) !== "") { console.error("MARKER.md must end with a newline"); process.exit(1); }
  lines.pop();
  if (lines.length > expected.length || lines.some((line, index) => line !== expected[index])) {
    console.error("MARKER.md is not a prefix of the expected lines: " + JSON.stringify(lines));
    process.exit(1);
  }
}
const tests = existsSync("tests") ? readdirSync("tests").filter((file) => file.endsWith(".test.mjs")).sort().map((file) => `tests/${file}`) : [];
if (tests.length > 0) {
  const run = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}
EOF
  cat > "$dir/.github/workflows/ci.yml" <<'EOF'
# The only CI: one check so pull requests carry a non-empty statusCheckRollup.
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/check-rehearsal.mjs
EOF
  cat > "$dir/PROJECT.md" <<EOF
---
arcadia: v1
type: project
slug: $FIXTURE_PROJECT
name: $FIXTURE_NAME
status: active
goal: Disposable fixture proving three serial Actions run unattended from one bounded production Grant.
outcome: Demonstrate three dependent Actions preserved, independently reviewed and integrated by the production tick; delete after recorded review.
milestone: Run the bounded three-Action rehearsal
active_plan: $FIXTURE_PLAN
current_action: $ACTION_A
updated: $FIXTURE_DATE
---

# $FIXTURE_NAME

Disposable fixture for the installed three-Action autonomous rehearsal.
EOF
  cat > "$dir/docs/plans/$FIXTURE_PLAN.md" <<EOF
---
arcadia: v1
type: plan
slug: $FIXTURE_PLAN
project: $FIXTURE_PROJECT
status: active
milestone: Run the bounded three-Action rehearsal
token_impact: small
token_budget: Three trivial file-edit Actions; model use is bounded to the three coding Sessions and their two independent reviews each.
updated: $FIXTURE_DATE
actions:
  - id: $ACTION_A
    title: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline.
    expected_artifact: MARKER.md with the start line
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md exists and contains exactly the line "three-action rehearsal start" followed by a trailing newline, with no other content.
      - The genesis check $VALIDATION_COMMAND passes.
    depends_on: []
    decisions: []
  - id: $ACTION_B
    title: Implement appending the start line transformed to upper case ("THREE-ACTION REHEARSAL START") to MARKER.md, and add tests/marker.test.mjs asserting both lines in order.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement appending the line "THREE-ACTION REHEARSAL START" to MARKER.md after the start line, and add tests/marker.test.mjs asserting node --test sees both lines in order.
    expected_artifact: MARKER.md with the start and transformed lines, plus a passing tests/marker.test.mjs
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md contains exactly the start line followed by "THREE-ACTION REHEARSAL START", each with a trailing newline.
      - tests/marker.test.mjs exists and passes under node --test, asserting both lines appear in order; "$VALIDATION_COMMAND" passes.
    depends_on: [$ACTION_A]
    decisions: []
  - id: $ACTION_C
    title: Implement appending the line "three-action rehearsal verified" to MARKER.md, and extend tests/marker.test.mjs to assert all three lines in order.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement appending the line "three-action rehearsal verified" to MARKER.md after the transformed line, and extend tests/marker.test.mjs to assert all three lines in order.
    expected_artifact: MARKER.md with all three lines, plus a passing tests/marker.test.mjs
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md contains exactly the start, transformed and verified lines in that order, each with a trailing newline.
      - tests/marker.test.mjs asserts all three lines in order and "$VALIDATION_COMMAND" passes.
    depends_on: [$ACTION_B]
    decisions: []
questions: []
decisions: []
recommended_model: claude-sonnet-5
recommended_reasoning_effort: medium
current_action: $ACTION_A
---

# Autonomous three-Action rehearsal

Disposable fixture Plan. Three serial Actions, each preserved to a draft pull
request, readied and independently reviewed by the production tick, then
integrated by local fast-forward. GitHub-side merge and base push stay out of
scope.
EOF
  cat > "$dir/$MANIFEST_NAME" <<EOF
{"schema":"arcadia-three-action-rehearsal-fixture-v1","githubRepository":"$REPO","fixtureProject":"$FIXTURE_PROJECT","fixturePlan":"$FIXTURE_PLAN","actions":["$ACTION_A","$ACTION_B","$ACTION_C"],"provider":"$PROVIDER","agentProfile":"$PROFILE","validationCommand":"$VALIDATION_COMMAND"}
EOF
} # end render_fixture

# Arcadia's own discovery and docs-sync validation, read-only against one
# fixture directory: discoverDocs parses every managed document, a dry-run
# syncProjectDocs (exactly what `docs sync` runs per Project) reports its
# errorCount, and resolveReadySet reports the depends_on ordering. The dry-run
# needs a Project row, so it uses a throwaway workspace inside this run's
# directory: no Project is registered and the live workspace is never opened.
# The run directory sits inside the Arcadia checkout, within discovery's depth
# limit, so the render and the throwaway workspace live in dot-directories that
# discoverDocs skips: the checkout must never discover a fixture PROJECT.md.
cat > "$RUN_DIR/validate-fixture.mjs" <<'NODE'
import { initWorkspace } from "./src/workspace/initWorkspace.ts";
import { withDatabase } from "./src/db/connection.ts";
import { createProjectWithInitialWork } from "./src/db/repositories.ts";
import { syncProjectDocs } from "./src/docs/sync.ts";
import { discoverDocs } from "./src/docs/discover.ts";
import { resolveReadySet } from "./src/docs/dispatch.ts";
const [fixtureRoot, scratchWorkspace, name, plan] = process.argv.slice(2);
const describe = (error) => `${error.relativePath}${error.field ? ` (${error.field})` : ""}: ${error.message}`;
initWorkspace(scratchWorkspace);
const sync = withDatabase(scratchWorkspace, (db) => {
  const { project } = createProjectWithInitialWork(db, {
    name, mission: "Disposable three-Action rehearsal fixture.", goal: "Disposable rehearsal fixture.", status: "active",
    currentMilestone: "Run the bounded three-Action rehearsal", nextAction: "Import fixture documents", workClassification: "agent"
  });
  return { slug: project.slug, result: syncProjectDocs(db, project, { apply: false, repoRoot: fixtureRoot }) };
});
const discovered = discoverDocs(fixtureRoot);
const projectDoc = discovered.docs.find((doc) => doc.type === "project");
const planDoc = discovered.docs.find((doc) => doc.type === "plan" && doc.slug === plan);
const readySet = resolveReadySet(fixtureRoot, sync.slug);
console.log(JSON.stringify({
  importSlug: sync.slug,
  errorCount: sync.result.errors.length,
  errors: sync.result.errors.map(describe),
  rejected: sync.result.rejected,
  project: projectDoc ? { slug: projectDoc.slug, activePlan: projectDoc.activePlan, currentAction: projectDoc.currentAction } : null,
  actions: planDoc ? planDoc.actions.map((action) => ({ id: action.id, status: action.status, responsibility: action.responsibility, dependsOn: action.dependsOn })) : null,
  readySetBlockers: readySet.blockers.map(describe),
  ready: readySet.ready.map((entry) => entry.actionId),
  candidates: readySet.candidates.map((entry) => ({ id: entry.actionId, ready: entry.ready, gate: entry.gate, blockers: entry.blockers.map((blocker) => blocker.field) }))
}));
NODE

# Every way the fixture can fail, joined; empty means valid. A missing Project,
# Plan or Action, any docs-sync error, or anything but A ready with B and C
# gated only by depends_on refuses.
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
   | "\(.id) is not gated only by depends_on")
] | join("; ") | gsub("\\s*\\n\\s*"; " ")'

# validate_fixture <dir> <label> sets VALIDATION_PROBLEM; empty means valid.
VALIDATION_PROBLEM=""
validate_fixture() {
  local dir="$1" label="$2" out="$RUN_DIR/fixture-validation-$2.json"
  VALIDATION_PROBLEM=""
  if ! probe "$dir" "$RUN_DIR/.validation-workspace-$label" "$FIXTURE_NAME" "$FIXTURE_PLAN" < "$RUN_DIR/validate-fixture.mjs" > "$out"; then
    VALIDATION_PROBLEM="Arcadia's discovery could not run against the $label fixture (see $out and the run log)"
    return 0
  fi
  VALIDATION_PROBLEM="$(jq -r --arg p "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --arg a "$ACTION_A" --arg b "$ACTION_B" --arg c "$ACTION_C" "$VALIDATION_RULES" "$out")" \
    || VALIDATION_PROBLEM="the $label fixture's validation output is unreadable (see $out)"
  record_str "fixtureValidation_$label" "$out"
}

# fixture_differences <dir> sets FIXTURE_DIFFERENCES; empty means the committed
# genesis is exactly the validated render (only the `updated:` date may differ)
# and nothing untracked or ignored sits beside it.
FIXTURE_DIFFERENCES=""
normalize_date() { sed -E 's/^updated: [0-9]{4}-[0-9]{2}-[0-9]{2}$/updated: <date>/'; }
fixture_differences() {
  local dir="$1" scratch="$RUN_DIR/.compare" file tracked expected extra
  FIXTURE_DIFFERENCES=""
  mkdir -p "$scratch"
  tracked="$(git -C "$dir" ls-files | LC_ALL=C sort | tr '\n' ' ')"
  expected="$(cd "$RENDER_DIR" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | tr '\n' ' ')"
  [[ "$tracked" == "$expected" ]] || FIXTURE_DIFFERENCES="tracked files are [${tracked% }], not [${expected% }]"
  for file in $expected; do
    git -C "$dir" show "HEAD:$file" 2>/dev/null | normalize_date > "$scratch/committed" || : > "$scratch/committed"
    normalize_date < "$RENDER_DIR/$file" > "$scratch/render"
    cmp -s "$scratch/committed" "$scratch/render" || FIXTURE_DIFFERENCES="${FIXTURE_DIFFERENCES:+$FIXTURE_DIFFERENCES; }committed $file differs from the validated render"
  done
  extra="$(git -C "$dir" status --porcelain --ignored --untracked-files=all | tr '\n' ' ')"
  [[ -z "$extra" ]] || FIXTURE_DIFFERENCES="${FIXTURE_DIFFERENCES:+$FIXTURE_DIFFERENCES; }untracked or ignored files sit beside the genesis: ${extra% }"
}

STAGE=validate_fixture
# Before any GitHub repository create, push, Project import or manifest write.
RENDER_DIR="$RUN_DIR/.fixture-render"
render_fixture "$RENDER_DIR"
validate_fixture "$RENDER_DIR" rendered
[[ -z "$VALIDATION_PROBLEM" ]] || refuse "the generated fixture fails Arcadia's own discovery and docs-sync validation, so nothing was created, pushed, imported or written: $VALIDATION_PROBLEM"
echo "Generated fixture validated by Arcadia's discovery and docs sync: $ACTION_A is ready; $ACTION_B and $ACTION_C wait only on depends_on."

STAGE=local_fixture_state
LOCAL_EXISTS=false
LOCAL_PROBLEM=""
ROOT_COMMIT=""
if [[ -e "$FIXTURE_REPO" ]]; then
  LOCAL_EXISTS=true
  [[ -f "$FIXTURE_REPO/$MANIFEST_NAME" ]] || refuse "$FIXTURE_REPO exists but is not this fixture (no $MANIFEST_NAME); move it aside yourself, nothing was changed"
  [[ "$(jq -r '.githubRepository' "$FIXTURE_REPO/$MANIFEST_NAME")" == "$REPO" ]] || refuse "the existing local fixture belongs to $(jq -r '.githubRepository' "$FIXTURE_REPO/$MANIFEST_NAME"), not $REPO; one fixture at a time"
  [[ "$(git -C "$FIXTURE_REPO" branch --show-current)" == main ]] || refuse "the existing local fixture is not on main"
  [[ -z "$(git -C "$FIXTURE_REPO" status --porcelain)" ]] || refuse "the existing local fixture is dirty"
  [[ "$(git -C "$FIXTURE_REPO" rev-list --max-parents=0 HEAD | wc -l | tr -d ' ')" == 1 ]] || refuse "the existing local fixture must have exactly one root commit"
  ROOT_COMMIT="$(git -C "$FIXTURE_REPO" rev-list --max-parents=0 HEAD)"
  [[ "$(git -C "$FIXTURE_REPO" rev-parse HEAD)" == "$ROOT_COMMIT" ]] || refuse "the local fixture has advanced past its genesis commit, so a rehearsal already ran on it; supply a new repository name"
  # Checked before any GitHub mutation: a fixture wired to another remote never creates a repository.
  if EXISTING_URL="$(git -C "$FIXTURE_REPO" remote get-url origin 2>/dev/null)"; then
    [[ "$EXISTING_URL" == "https://github.com/$REPO.git" || "$EXISTING_URL" == "git@github.com:$REPO.git" ]] || refuse "the local fixture origin is $EXISTING_URL, not $REPO"
  fi
  # An earlier (pre-validation) G1 may have committed an invalid genesis; it is judged by the same
  # rules, and every committed file (not only the managed documents) must be the validated render.
  validate_fixture "$FIXTURE_REPO" local
  LOCAL_PROBLEM="$VALIDATION_PROBLEM"
  fixture_differences "$FIXTURE_REPO"
  [[ -z "$FIXTURE_DIFFERENCES" ]] || LOCAL_PROBLEM="${LOCAL_PROBLEM:+$LOCAL_PROBLEM; }$FIXTURE_DIFFERENCES"
  echo "Found local fixture $FIXTURE_REPO at genesis $ROOT_COMMIT"
fi

# Read-only: detect a half-registered earlier attempt before any GitHub call.
STAGE=registration_state
REGISTERED_MARKER="$FIXTURE_REPO/.git/arcadia-three-action-project-id"
PROJECTS="$(arcadia project list --json)"
jq -e '.ok == true' <<<"$PROJECTS" >/dev/null || refuse "arcadia project list could not be read"
PROJECT_ID="$(jq -r --arg s "$FIXTURE_PROJECT" '[.data.projects[]? | select(.slug == $s) | .id][0] // empty' <<<"$PROJECTS")"
MARKER_ID=""
if [[ -s "$REGISTERED_MARKER" ]]; then MARKER_ID="$(<"$REGISTERED_MARKER")"; fi
MOVE_ASIDE="mv $FIXTURE_REPO $FIXTURE_REPO.invalid-$RUN_ID"
NO_GOVERNED_REMOVAL="No governed Arcadia command removes or renames a registered Project, and G1 never repoints one: keep this receipt and $FIXTURE_REPO as they are, inspect the Project with 'arcadia project show $PROJECT_ID --json', and record an Agent Ask proposal for a governed retirement of fixture Project $FIXTURE_PROJECT; only after that retirement lands, rerun G1. Never edit the workspace database by hand."
REGISTRATION=none
if [[ -n "$PROJECT_ID" ]]; then
  record_str registeredProjectId "$PROJECT_ID"
  if [[ "$LOCAL_EXISTS" != true ]]; then
    REGISTRATION=half_registered
    RECOVERY="If you moved the original fixture aside, move it back to $FIXTURE_REPO (its .git/arcadia-three-action-project-id holds $PROJECT_ID) and rerun with the same ARCADIA_REHEARSAL_GITHUB_REPO. Otherwise: $NO_GOVERNED_REMOVAL"
    record_str registrationState "$REGISTRATION"
    refuse "HALF-REGISTERED: Project $FIXTURE_PROJECT ($PROJECT_ID) is already registered in $WORKSPACE, but the local fixture $FIXTURE_REPO is missing, so this run cannot prove G1 registered it; nothing was changed"
  elif [[ "$MARKER_ID" != "$PROJECT_ID" ]]; then
    REGISTRATION=half_registered
    RECOVERY="$NO_GOVERNED_REMOVAL"
    record_str registrationState "$REGISTRATION"
    refuse "HALF-REGISTERED: Project $FIXTURE_PROJECT ($PROJECT_ID) is already registered in $WORKSPACE, but $FIXTURE_REPO records ${MARKER_ID:-no} registration (.git/arcadia-three-action-project-id), so G1 did not register it from this fixture; nothing was changed"
  elif [[ -n "$LOCAL_PROBLEM" ]]; then
    REGISTRATION=half_registered
    RECOVERY="A pushed genesis cannot be repaired without rewriting history, which G1 never does. $NO_GOVERNED_REMOVAL Then move the invalid fixture aside with '$MOVE_ASIDE' and rerun with a new ARCADIA_REHEARSAL_GITHUB_REPO; the private repository $REPO is left untouched for you to delete after review."
    record_str registrationState "$REGISTRATION"
    refuse "HALF-REGISTERED: an earlier G1 attempt registered Project $FIXTURE_PROJECT ($PROJECT_ID) from $FIXTURE_REPO (genesis $ROOT_COMMIT, repository $REPO), whose genesis is not the validated fixture: $LOCAL_PROBLEM; nothing was changed"
  fi
  REGISTRATION=registered_by_this_fixture
elif [[ -n "$LOCAL_PROBLEM" ]]; then
  REGISTRATION=invalid_local_fixture
  RECOVERY="No Project is registered, so no Arcadia change is needed: move the invalid fixture aside with '$MOVE_ASIDE' and rerun with a new ARCADIA_REHEARSAL_GITHUB_REPO. If $REPO was already created or pushed it is left untouched for you to delete after review."
  record_str registrationState "$REGISTRATION"
  refuse "the existing local fixture $FIXTURE_REPO (genesis $ROOT_COMMIT) is not the validated fixture and cannot be repaired at genesis: $LOCAL_PROBLEM; nothing was changed"
fi
record_str registrationState "$REGISTRATION"

STAGE=github_identity
LOGIN="$(ghx api user --jq .login)" || refuse "GitHub CLI is not authenticated or GitHub is unreachable (gh api user failed)"
[[ "$(lower "$LOGIN")" == "$(lower "$OWNER")" ]] || refuse "repository owner $OWNER is not the authenticated GitHub user $LOGIN; this fixture is only created in your own account"

STAGE=github_repository
CREATE=false
REMOTE_MAIN=""
if VIEW="$(ghx repo view "$REPO" --json name,owner,visibility,isPrivate,isArchived,isFork,isEmpty,description 2>"$RUN_DIR/gh-repo-view.err")"; then
  printf '%s\n' "$VIEW" > "$RUN_DIR/github-repository-before.json"
  jq -e '.isPrivate == true and (.visibility | ascii_upcase) == "PRIVATE"' <<<"$VIEW" >/dev/null || refuse "$REPO exists and is not private; refusing to place a fixture in it"
  jq -e '.isArchived == false and .isFork == false' <<<"$VIEW" >/dev/null || refuse "$REPO is archived or a fork; refusing to reuse it"
  if jq -e '.isEmpty == true' <<<"$VIEW" >/dev/null; then
    echo "Reusing empty private repository $REPO"
  else
    jq -e --arg d "$REPO_DESCRIPTION" '.description == $d' <<<"$VIEW" >/dev/null || refuse "$REPO already has content and is not a repository this script created; choose a new name"
    [[ "$LOCAL_EXISTS" == true ]] || refuse "$REPO holds an earlier fixture but its local fixture is missing; refusing to adopt remote history"
    REMOTE_MAIN="$(ghx api "repos/$REPO/commits/main" --jq .sha)" || refuse "could not read main of $REPO"
    [[ "$REMOTE_MAIN" == "$ROOT_COMMIT" ]] || refuse "$REPO main ($REMOTE_MAIN) is not this fixture's genesis ($ROOT_COMMIT); choose a new name"
    echo "Reusing previously created rehearsal repository $REPO at genesis"
  fi
elif grep -q 'Could not resolve to a Repository' "$RUN_DIR/gh-repo-view.err"; then
  CREATE=true
  echo "$REPO does not exist; it will be created private."
else
  refuse "GitHub could not report whether $REPO exists ($(head -c 300 "$RUN_DIR/gh-repo-view.err")); unknown is not absent"
fi

if [[ "$LOCAL_EXISTS" == false ]]; then
  STAGE=create_local_fixture
  # Exactly the bytes validated above.
  mkdir -p "$FIXTURE_REPO"
  cp -R "$RENDER_DIR/." "$FIXTURE_REPO/"
  git -C "$FIXTURE_REPO" init -q -b main
  git -C "$FIXTURE_REPO" add -A
  git -C "$FIXTURE_REPO" -c user.name='Arcadia Rehearsal Fixture' -c user.email='rehearsal@localhost' commit -q -m 'Bootstrap three-Action rehearsal fixture'
  ROOT_COMMIT="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
fi
record_str rootCommit "$ROOT_COMMIT"

if [[ "$CREATE" == true ]]; then
  STAGE=create_github_repository
  REMOTE_CHANGED=true
  ghx repo create "$REPO" --private --description "$REPO_DESCRIPTION" >/dev/null
  VIEW="$(ghx repo view "$REPO" --json visibility,isPrivate,isEmpty)"
  jq -e '.isPrivate == true and (.visibility | ascii_upcase) == "PRIVATE"' <<<"$VIEW" >/dev/null || refuse "the created repository did not report private visibility"
fi

STAGE=push_genesis
PROTOCOL="$(gh config get git_protocol -h github.com 2>/dev/null || true)"
if [[ "$PROTOCOL" == ssh ]]; then EXPECTED_URL="git@github.com:$REPO.git"; else EXPECTED_URL="https://github.com/$REPO.git"; fi
if CURRENT_URL="$(git -C "$FIXTURE_REPO" remote get-url origin 2>/dev/null)"; then
  [[ "$CURRENT_URL" == "https://github.com/$REPO.git" || "$CURRENT_URL" == "git@github.com:$REPO.git" ]] || refuse "fixture origin is $CURRENT_URL, not $REPO"
else
  git -C "$FIXTURE_REPO" remote add origin "$EXPECTED_URL"
fi
if [[ -z "$REMOTE_MAIN" ]]; then
  REMOTE_CHANGED=true
  # Never forced: an unexpected remote main makes this push fail closed.
  timeout 120 git -C "$FIXTURE_REPO" push -q -u origin main
  REMOTE_MAIN="$(ghx api "repos/$REPO/commits/main" --jq .sha)"
fi
[[ "$REMOTE_MAIN" == "$ROOT_COMMIT" ]] || refuse "GitHub main ($REMOTE_MAIN) does not equal the fixture genesis ($ROOT_COMMIT)"
record "githubRepositoryCreated" "$CREATE"

STAGE=register_project
# Re-read: the registration state was judged above, but a Project could appear in between.
PROJECTS="$(arcadia project list --json)"
PROJECT_ID="$(jq -r --arg s "$FIXTURE_PROJECT" '[.data.projects[]? | select(.slug == $s) | .id][0] // empty' <<<"$PROJECTS")"
if [[ -n "$PROJECT_ID" ]]; then
  [[ -s "$REGISTERED_MARKER" && "$(<"$REGISTERED_MARKER")" == "$PROJECT_ID" ]] || refuse "a Project with slug $FIXTURE_PROJECT already exists but this fixture did not register it; refusing to repoint it"
else
  IMPORT="$(arcadia project import --name "$FIXTURE_NAME" --mission 'Disposable three-Action rehearsal fixture.' --outcome 'Disposable rehearsal fixture.' --milestone 'Run the bounded three-Action rehearsal' --next-action 'Import fixture documents' --responsibility agent --status active --json)"
  PROJECT_ID="$(jq -r '.data.project.id // empty' <<<"$IMPORT")"
  [[ -n "$PROJECT_ID" ]] || refuse "project import returned no Project id"
  [[ "$(jq -r '.data.project.slug // empty' <<<"$IMPORT")" == "$FIXTURE_PROJECT" ]] || refuse "project import produced an unexpected slug"
  printf '%s\n' "$PROJECT_ID" > "$REGISTERED_MARKER"
fi
record_str projectId "$PROJECT_ID"
arcadia project metadata "$PROJECT_ID" --repo-path "$FIXTURE_REPO" --validation-command "$VALIDATION_COMMAND" --json | jq -e '.ok == true' >/dev/null || refuse "project metadata update failed"
SYNC="$(arcadia docs sync --project "$FIXTURE_PROJECT" --apply --json)" || SYNC=""
printf '%s\n' "$SYNC" > "$RUN_DIR/docs-sync.json"
jq -e '.ok == true and .data.errorCount == 0' <<<"$SYNC" >/dev/null 2>&1 || refuse "docs sync reported errors although the fixture validated before any mutation; see $RUN_DIR/docs-sync.json"

STAGE=verify_actions
WORK="$(arcadia work list --json)"
for action in "$ACTION_A" "$ACTION_B" "$ACTION_C"; do
  jq -e --arg ref "plan/$FIXTURE_PLAN#$action" '[.data.workItems[]? | select(.doc_ref == $ref)] | length == 1' <<<"$WORK" >/dev/null || refuse "Action $action did not sync exactly once"
done

STAGE=seed_packet
WORK_ID="$(jq -r --arg ref "plan/$FIXTURE_PLAN#$ACTION_A" '[.data.workItems[]? | select(.doc_ref == $ref) | .id][0] // empty' <<<"$WORK")"
PACKET_MARKER="$FIXTURE_REPO/.git/arcadia-three-action-first-packet-approval"
if [[ -s "$PACKET_MARKER" ]]; then
  # Re-running work plan could replace a live approval; the marker keeps this repeatable.
  APPROVAL_ID="$(<"$PACKET_MARKER")"
  REVIEW="$(arcadia review show "$APPROVAL_ID" --json)"
  jq -e '.ok == true and (.data.item.status == "open" or .data.item.status == "approved")' <<<"$REVIEW" >/dev/null || refuse "the recorded first packet approval is no longer open or approved"
else
  PACKET="$(arcadia work plan "$WORK_ID" --agent-profile "$PROFILE" --json)"
  jq -e '.ok == true' <<<"$PACKET" >/dev/null || refuse "first packet seed failed"
  APPROVAL_ID="$(jq -r '.data.buildApproval.id // empty' <<<"$PACKET")"
  [[ -n "$APPROVAL_ID" ]] || refuse "packet seed returned no build approval id"
  printf '%s\n' "$APPROVAL_ID" > "$PACKET_MARKER"
fi
record_str firstPacketApproval "$APPROVAL_ID"

STAGE=complete
REASON=""
# The restart implementation defaults to a workspace that does not exist; the
# recovery needs the absolute workspace inline. Exporting it instead makes
# G1, G6, G7 and G8 refuse, because the workspace then resolves from the
# environment variable rather than user config.
RECOVER_COMMAND="ARCADIA_WORKSPACE=$WORKSPACE $SCRIPT_DIR/recover-arcadia-host-services.sh run"
record_str recoverCommand "$RECOVER_COMMAND"
record "githubRepositoryChanged" "$REMOTE_CHANGED"
write_receipt succeeded
echo "READY: fixture $REPO prepared at genesis $ROOT_COMMIT; production untouched."
echo "Next: run recover-arcadia-host-services (reinstalls the broker so Codex trusts $FIXTURE_REPO and restarts the worker)"
echo "with ARCADIA_WORKSPACE set inline on that one command, never exported in your shell (an exported"
echo "ARCADIA_WORKSPACE makes G1, G6, G7 and G8 refuse). Run exactly:"
echo "  $RECOVER_COMMAND"
echo "Then run the G6 preflight."
echo "Receipt: $RECEIPT"
