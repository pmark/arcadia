#!/usr/bin/env bash
# Prepare only: no policy is previewed or activated, no worker is restarted,
# and no coding-agent Session is launched.  The paired Grant is deliberately
# a separate, one-shot operator action.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="prepare-two-action-v6-rehearsal-2026-09-30"
ARCADIA_REPO="/Users/pmark/Dev/MR/Arcadia/arcadia"
FIXTURE_REPO="$HOME/tmp/arcadia-two-action-rehearsal-v6"
FIXTURE_PROJECT="two-action-rehearsal-v6"
FIXTURE_PLAN="two-action-rehearsal-v6-bootstrap"
PROVIDER="codex-cli"
PROFILE="codex_build"
ACTION_SPLIT="split-marker-across-two-sessions"
ACTION_OFF="off-mid-work-and-restart-worker"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$SCRIPT_DIR/runs/$RUN_ID"
LOG="$RUN_DIR/run.log"
HANDOFF="$RUN_DIR/failure-handoff.md"
RECEIPT="$RUN_DIR/preparation-receipt.json"

case "${1:-run}" in
  run) ;;
  --describe) cat "$SCRIPT_DIR/$SCRIPT_ID.json"; exit 0 ;;
  *) echo "usage: $0 [run|--describe]" >&2; exit 2 ;;
esac

mkdir -p "$RUN_DIR"
exec > >(tee -a "$LOG") 2>&1
STAGE=preflight
fail() { echo "REFUSED: $*" >&2; return 1; }
arcadia() { (cd "$ARCADIA_REPO" && mise exec -- pnpm -s arcadia "$@"); }
trap 'code=$?; trap - ERR; {
  echo "# Operator-script failure handoff"; echo
  echo "- id: $SCRIPT_ID"; echo "- stage: $STAGE"; echo "- run log: $LOG"
  echo "- failed command: \`$BASH_COMMAND\`"; echo
  echo "No Grant was pressed, production policy was not previewed or activated, and no worker or Session was touched."
  echo "Fix the named precondition and rerun this repeatable prepare action."
} > "$HANDOFF"; echo "Failure handoff: $HANDOFF" >&2; exit "$code"' ERR

echo "== Prepare v6 remaining-stages rehearsal =="
for tool in git jq mise pnpm node; do command -v "$tool" >/dev/null || fail "$tool is required"; done
[[ -d "$ARCADIA_REPO/.git" ]] || fail "Arcadia checkout is missing"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || fail "Arcadia checkout must be on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || fail "Arcadia checkout must be clean"

STATUS="$(arcadia production status --json)"
POLICY_STATE="$(jq -r '.data.read.policy.desiredState // empty' <<<"$STATUS")"
POLICY_REVISION="$(jq -r '.data.read.policy.revision // empty' <<<"$STATUS")"
[[ "$POLICY_STATE" == inactive ]] || fail "production must be Inactive before fixture preparation; it is $POLICY_STATE"
[[ "$POLICY_REVISION" =~ ^[0-9]+$ ]] || fail "production status did not provide a numeric policy revision"

if [[ -e "$FIXTURE_REPO" ]]; then
  [[ -f "$FIXTURE_REPO/.arcadia-v6-rehearsal.json" ]] || fail "$FIXTURE_REPO exists but lacks this fixture's manifest"
  [[ -z "$(git -C "$FIXTURE_REPO" status --porcelain)" ]] || fail "existing v6 fixture is dirty"
  [[ "$(jq -r '.fixtureProject' "$FIXTURE_REPO/.arcadia-v6-rehearsal.json")" == "$FIXTURE_PROJECT" ]] || fail "existing fixture manifest names another Project"
  echo "Reusing prepared v6 fixture: $FIXTURE_REPO"
else
  STAGE=create_fixture
  mkdir -p "$FIXTURE_REPO/scripts" "$FIXTURE_REPO/docs/plans"
  git -C "$FIXTURE_REPO" init -b main >/dev/null
  cat > "$FIXTURE_REPO/scripts/check-v6-rehearsal.mjs" <<'EOF'
import { existsSync, readFileSync } from "node:fs";
const expected = ["v6 split session one", "v6 split session two", "v6 off-restart action"];
if (!existsSync("MARKER.md")) process.exit(0);
const lines = readFileSync("MARKER.md", "utf8").split("\n");
if (lines.at(-1) !== "") process.exit(1);
lines.pop();
if (lines.length > expected.length || lines.some((line, i) => line !== expected[i])) process.exit(1);
EOF
  cat > "$FIXTURE_REPO/PROJECT.md" <<EOF
---
arcadia: v1
type: project
slug: $FIXTURE_PROJECT
name: Two Action Rehearsal V6
status: active
goal: Disposable fixture for the remaining unattended-production proof stages.
outcome: Demonstrate a split continuation, then Off and worker restart during in-flight work; delete after recorded review.
milestone: Run the bounded v6 rehearsal
active_plan: $FIXTURE_PLAN
current_action: $ACTION_SPLIT
updated: $(date -u +%F)
---

# Two Action Rehearsal V6
EOF
  cat > "$FIXTURE_REPO/docs/plans/$FIXTURE_PLAN.md" <<EOF
---
arcadia: v1
type: plan
slug: $FIXTURE_PLAN
project: $FIXTURE_PROJECT
status: active
milestone: Run the bounded v6 rehearsal
token_impact: small
token_budget: Two bounded fixture Actions.
updated: $(date -u +%F)
actions:
  - id: $ACTION_SPLIT
    title: Implement the v6 split marker in two deliberately separate managed Sessions.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement only the first v6 split marker line, verify it, and exit incomplete without drafting completion so the operator can verify a second managed Session reuses this candidate; the resumed Session must append the second line and complete the Action.
    expected_artifact: MARKER.md with the first and second v6 split lines in order.
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md contains exactly the lines "v6 split session one" and "v6 split session two", in that order, each with a trailing newline.
      - The first managed Session leaves only the first line and exits incomplete; a second managed Session for this same Action reuses the candidate worktree and branch, sees that first line, appends the second line, and completes without a concurrent candidate.
    depends_on: []
    decisions: []
  - id: $ACTION_OFF
    title: Implement the v6 Off-and-restart marker while the operator turns production Off and restarts the worker.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement the v6 off-restart marker only after observing the existing two split lines; stay available for the operator's bounded Off and worker-restart observation, then finish normally if the already-admitted Session remains valid.
    expected_artifact: MARKER.md with all three v6 lines in order.
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md contains the two split lines followed by "v6 off-restart action", each with a trailing newline.
      - While this Action has an already-admitted managed Session, the operator turns production Off and restarts the worker; no later admission occurs, the existing candidate remains visible, and restart does not duplicate or reactivate a Session after Off.
    depends_on: [$ACTION_SPLIT]
    decisions: []
questions: []
decisions: []
recommended_model: codex
recommended_reasoning_effort: high
current_action: $ACTION_SPLIT
---

# Two Action Rehearsal V6 bootstrap
EOF
  cat > "$FIXTURE_REPO/.arcadia-v6-rehearsal.json" <<EOF
{"schema":"arcadia-v6-rehearsal-fixture-v1","fixtureProject":"$FIXTURE_PROJECT","fixturePlan":"$FIXTURE_PLAN","provider":"$PROVIDER","preparedPolicyRevision":$POLICY_REVISION,"splitAction":"$ACTION_SPLIT","offAction":"$ACTION_OFF","validationCommand":"node scripts/check-v6-rehearsal.mjs"}
EOF
  git -C "$FIXTURE_REPO" add -A
  git -C "$FIXTURE_REPO" -c user.name='Arcadia Rehearsal Fixture' -c user.email='rehearsal@localhost' commit -m 'Bootstrap v6 remaining-stages rehearsal fixture' >/dev/null
fi

STAGE=register_fixture
PROJECTS="$(arcadia project list --json)"
PROJECT_ID="$(jq -r --arg s "$FIXTURE_PROJECT" '.data.projects[]? | select(.slug == $s) | .id' <<<"$PROJECTS" | head -1)"
if [[ -z "$PROJECT_ID" ]]; then
  IMPORT="$(arcadia project import --name 'Two Action Rehearsal V6' --mission 'Disposable v6 rehearsal fixture.' --outcome 'Disposable rehearsal fixture.' --milestone 'Run the bounded v6 rehearsal' --next-action 'Import fixture documents' --responsibility agent --status active --json)"
  PROJECT_ID="$(jq -r '.data.project.id // empty' <<<"$IMPORT")"
fi
[[ -n "$PROJECT_ID" ]] || fail "could not resolve fixture Project id"
arcadia project metadata "$PROJECT_ID" --repo-path "$FIXTURE_REPO" --validation-command 'node scripts/check-v6-rehearsal.mjs' --json | jq -e '.ok == true' >/dev/null
arcadia docs sync --project "$FIXTURE_PROJECT" --apply --json | jq -e '.ok == true and (.data.errorCount // 0) == 0' >/dev/null

STAGE=seed_packet
WORK="$(arcadia work list --json)"
WORK_ID="$(jq -r --arg ref "plan/$FIXTURE_PLAN#$ACTION_SPLIT" '.data.workItems[]? | select(.doc_ref == $ref) | .id' <<<"$WORK" | head -1)"
[[ -n "$WORK_ID" ]] || fail "split Action has no synced work item"
PACKET_MARKER="$FIXTURE_REPO/.git/arcadia-v6-split-packet-approval"
if [[ -s "$PACKET_MARKER" ]]; then
  # Re-running work plan can replace an approval.  The marker makes the
  # preparation action genuinely repeatable without mutating a live review.
  APPROVAL_ID="$(<"$PACKET_MARKER")"
  REVIEW="$(arcadia review show "$APPROVAL_ID" --json)"
  jq -e '.ok == true and (.data.item.status == "open" or .data.item.status == "approved")' <<<"$REVIEW" >/dev/null || fail "recorded packet approval is no longer open or approved"
else
  PACKET="$(arcadia work plan "$WORK_ID" --agent-profile "$PROFILE" --json)"
  jq -e '.ok == true' <<<"$PACKET" >/dev/null || fail "packet seed failed"
  APPROVAL_ID="$(jq -r '.data.buildApproval.id // empty' <<<"$PACKET")"
  [[ -n "$APPROVAL_ID" ]] || fail "packet seed returned no build approval id"
  printf '%s\n' "$APPROVAL_ID" > "$PACKET_MARKER"
fi

STAGE=receipt
jq -n --arg id "$SCRIPT_ID" --arg project "$FIXTURE_PROJECT" --arg plan "$FIXTURE_PLAN" --arg provider "$PROVIDER" --arg split "$ACTION_SPLIT" --arg off "$ACTION_OFF" --arg repo "$FIXTURE_REPO" --argjson revision "$POLICY_REVISION" '{schema:"arcadia-v6-rehearsal-preparation-receipt-v1",id:$id,fixtureProject:$project,fixturePlan:$plan,fixtureRepo:$repo,provider:$provider,splitAction:$split,offAction:$off,pinnedInactivePolicyRevision:$revision,grant:"grant-production-two-action-v6-remaining-stages-2026-09-30",unpressed:true}' > "$RECEIPT"
echo "READY: v6 fixture prepared. Grant remains unpressed: $SCRIPT_DIR/grant-production-two-action-v6-remaining-stages-2026-09-30.sh"
echo "Receipt: $RECEIPT"
