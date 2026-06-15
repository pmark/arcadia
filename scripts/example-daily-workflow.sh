#!/usr/bin/env bash
set -euo pipefail

# Arcadia daily workflow example.
#
# This is sample code for setting up a private Arcadia workspace and running
# the commands that are useful in ordinary daily operation.
#
# It mutates the target workspace. Re-running it is useful for practice, but it
# will add another set of sample work items and artifacts each time.
#
# Default target:
#   ../workspaces/martianrover
#
# Override the workspace without editing this file:
#   WORKSPACE=../workspaces/my-new-project ./scripts/example-daily-workflow.sh
#
# Arcadia operating checklist:
# - Current milestone: define the smallest useful outcome for the project.
# - Next action: record the next concrete action that moves the project forward.
# - Work classification: choose autonomous, codex, requires_review, or blocked.
# - Required artifacts: name any expected output before work starts.

WORKSPACE="${WORKSPACE:-../workspaces/martianrover}"
PROJECT_NAME="${PROJECT_NAME:-Martian Rover}"
INITIAL_MILESTONE="${INITIAL_MILESTONE:-Establish the project operating loop}"
INITIAL_NEXT_ACTION="${INITIAL_NEXT_ACTION:-Review the generated status report}"
INITIAL_ARTIFACT="${INITIAL_ARTIFACT:-Project status report}"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  if ! command_exists "$1"; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

arcadia() {
  pnpm arcadia "$@"
}

json_query() {
  # Read JSON from stdin and evaluate a small JavaScript expression against it.
  # Example:
  #   printf '%s' "$json" | json_query 'data.projects[0].id'
  local expression="$1"
  node -e '
    const fs = require("node:fs");
    const input = fs.readFileSync(0, "utf8");
    const payload = JSON.parse(input);
    const value = Function("payload", `with (payload) return (${process.argv[1]});`)(payload);
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  ' "$expression"
}

json_query_optional() {
  # Same as json_query, but prints nothing for null or missing values.
  local expression="$1"
  node -e '
    const fs = require("node:fs");
    const input = fs.readFileSync(0, "utf8");
    const payload = JSON.parse(input);
    const value = Function("payload", `with (payload) return (${process.argv[1]});`)(payload);
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$expression"
}

print_step() {
  printf '\n==> %s\n' "$1"
}

require_command node
require_command pnpm

print_step "Install Arcadia Core dependencies"
pnpm install

print_step "Build and test the CLI before using it for private project data"
pnpm build
pnpm test

print_step "Initialize or refresh the private workspace"
arcadia init "$WORKSPACE"

print_step "Confirm workspace status and generated report paths"
arcadia status --workspace "$WORKSPACE"

print_step "Create the first project if this workspace has no projects yet"
project_list_json="$(arcadia project list --workspace "$WORKSPACE" --json)"
project_count="$(printf '%s' "$project_list_json" | json_query 'data.projects.length')"

if [ "$project_count" = "0" ]; then
  cat <<EOF

No projects exist in this workspace yet.

Run the interactive bootstrap now. Suggested answers:
  Project name: $PROJECT_NAME
  Mission: Keep momentum visible for $PROJECT_NAME with minimal overhead.
  Current milestone: $INITIAL_MILESTONE
  Next action: $INITIAL_NEXT_ACTION
  Expected artifact: $INITIAL_ARTIFACT
  Work classification: codex

EOF
  arcadia project create --workspace "$WORKSPACE"
  project_list_json="$(arcadia project list --workspace "$WORKSPACE" --json)"
fi

PROJECT_ID="$(printf '%s' "$project_list_json" | json_query 'data.projects[0].id')"
MILESTONE_ID="$(printf '%s' "$project_list_json" | json_query_optional 'data.projects[0].current_milestone_id')"

if [ -z "$MILESTONE_ID" ]; then
  print_step "Create an active milestone because the selected project does not have one"
  milestone_json="$(
    arcadia milestone create "$PROJECT_ID" \
      --workspace "$WORKSPACE" \
      --title "$INITIAL_MILESTONE" \
      --json
  )"
  MILESTONE_ID="$(printf '%s' "$milestone_json" | json_query 'data.milestone.id')"
fi

print_step "Show the current project operating state"
arcadia project list --workspace "$WORKSPACE"

cat <<EOF

Current project context:
  Current milestone id: $MILESTONE_ID
  Next action source project id: $PROJECT_ID
  Work classification examples: autonomous, codex, requires_review, blocked
  Required artifacts are tracked through expected-artifact fields and artifact records.

EOF

print_step "Capture work that can be done locally without AI"
autonomous_json="$(
  arcadia inbox import \
    --workspace "$WORKSPACE" \
    --project "$PROJECT_ID" \
    --milestone "$MILESTONE_ID" \
    --title "Run the deterministic local check" \
    --input "Run the deterministic local check before asking for help." \
    --queue work_queue \
    --classification autonomous \
    --next-action "Run the local command and read the output" \
    --expected-artifact "Local check notes" \
    --json
)"
AUTONOMOUS_WORK_ID="$(printf '%s' "$autonomous_json" | json_query 'data.workItem.id')"

print_step "Capture work that should go to Codex because code changes are required"
codex_json="$(
  arcadia inbox import \
    --workspace "$WORKSPACE" \
    --project "$PROJECT_ID" \
    --milestone "$MILESTONE_ID" \
    --title "Implement the next code change" \
    --input "Use Codex only when code changes are required." \
    --queue work_queue \
    --classification codex \
    --next-action "Open the relevant files and make the smallest scoped code change" \
    --expected-artifact "Committed code change" \
    --json
)"
CODEX_WORK_ID="$(printf '%s' "$codex_json" | json_query 'data.workItem.id')"

print_step "Capture work that needs review before execution"
requires_review_json="$(
  arcadia inbox import \
    --workspace "$WORKSPACE" \
    --project "$PROJECT_ID" \
    --milestone "$MILESTONE_ID" \
    --title "Choose the product direction" \
    --input "This requires human judgment before execution." \
    --queue requires_review \
    --classification requires_review \
    --next-action "Decide which option matters most this week" \
    --expected-artifact "Decision note" \
    --json
)"
NEEDS_MARK_WORK_ID="$(printf '%s' "$requires_review_json" | json_query 'data.workItem.id')"

print_step "Capture blocked work explicitly instead of carrying it mentally"
blocked_json="$(
  arcadia inbox import \
    --workspace "$WORKSPACE" \
    --project "$PROJECT_ID" \
    --milestone "$MILESTONE_ID" \
    --title "Wait for missing access" \
    --input "Progress is blocked until access exists." \
    --queue blocked \
    --classification blocked \
    --next-action "Request access from the owner" \
    --json
)"
BLOCKED_WORK_ID="$(printf '%s' "$blocked_json" | json_query 'data.workItem.id')"

print_step "Review the live queues"
arcadia queue --workspace "$WORKSPACE"

print_step "Start one work item and update its next action"
arcadia work update "$CODEX_WORK_ID" \
  --workspace "$WORKSPACE" \
  --status in_progress \
  --next-action "Make the scoped code change, then run tests" \
  --json

print_step "Move a needs-mark item after judgment has happened"
arcadia work update "$NEEDS_MARK_WORK_ID" \
  --workspace "$WORKSPACE" \
  --queue work_queue \
  --classification autonomous \
  --next-action "Write down the chosen direction and execute the first step" \
  --json

print_step "Complete finished work"
arcadia work done "$AUTONOMOUS_WORK_ID" --workspace "$WORKSPACE" --json

print_step "List artifacts, then mark the first planned artifact as drafted if one exists"
artifact_list_json="$(arcadia artifact list --workspace "$WORKSPACE" --json)"
first_artifact_id="$(
  printf '%s' "$artifact_list_json" | node -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const artifact = payload.data.artifacts.find((item) => item.status === "planned");
    if (artifact) process.stdout.write(artifact.id);
  '
)"

if [ -n "$first_artifact_id" ]; then
  arcadia artifact update "$first_artifact_id" \
    --workspace "$WORKSPACE" \
    --status drafted \
    --path "artifacts/example-output.md" \
    --json
else
  printf 'No planned artifacts found.\n'
fi

print_step "Create a mission log for the work session"
cat <<EOF

The mission log command is interactive because it captures human context.
Suggested answers:
  Project: $PROJECT_NAME
  Milestone: $INITIAL_MILESTONE
  Work performed: Ran the daily Arcadia workflow.
  Result: Queues, work state, artifacts, and reports were updated.
  Blockers: Track $BLOCKED_WORK_ID until access exists.
  Next action: Review reports/status.md and choose tomorrow's first action.
  Artifact impact: Updated local report and artifact records.

EOF
arcadia log create --workspace "$WORKSPACE"

print_step "Generate daily status artifacts"
arcadia status --workspace "$WORKSPACE"
arcadia report status --workspace "$WORKSPACE" --json

print_step "Generate the weekly review artifact"
arcadia review weekly --workspace "$WORKSPACE"

print_step "Optional examples for ordinary maintenance"
cat <<EOF

Useful commands to run manually:

  # List all work with ids.
  pnpm arcadia work list --workspace "$WORKSPACE"

  # Mark the Codex work complete after tests pass.
  pnpm arcadia work done "$CODEX_WORK_ID" --workspace "$WORKSPACE" --json

  # Pause the project when it is intentionally not active.
  pnpm arcadia project update "$PROJECT_ID" --workspace "$WORKSPACE" --status paused --json

  # Reactivate the project.
  pnpm arcadia project update "$PROJECT_ID" --workspace "$WORKSPACE" --status active --json

  # Complete the current milestone when its outcome exists.
  pnpm arcadia milestone complete "$MILESTONE_ID" --workspace "$WORKSPACE" --json

  # Create the next milestone.
  pnpm arcadia milestone create "$PROJECT_ID" --workspace "$WORKSPACE" --title "Next useful outcome" --json

  # Generate a deterministic review window.
  pnpm arcadia review weekly --workspace "$WORKSPACE" --since 2026-06-03 --until 2026-06-09 --json

  # Inspect generated artifacts.
  ls "$WORKSPACE/reports" "$WORKSPACE/mission_logs" "$WORKSPACE/artifacts"

EOF

print_step "Done"
printf 'Workspace: %s\n' "$WORKSPACE"
