#!/usr/bin/env bash
# ONE-SHOT operator card: move Arcadia's governed pointer from the evidence
# Action first-unattended-run to test-transient-review-retry-after-exhaustion,
# the first Action of the next-run Grant's scope, and publish that pointer
# commit to origin/main BEFORE the Grant is pressed.
#
# Why: with production Active and the pointer on an out-of-scope Action, the
# scheduler re-points to the first in-scope Action itself, committing on the
# local main checkout. That commit never goes through a pull request, so it
# sits in the next candidate's base and breaks that PR's "touches only"
# criterion (Process Critic pre-mortem, 2026-10-19). Moving the pointer here,
# through the canonical `arcadia advance queue make-next` preview and apply,
# and publishing it before activation leaves the scheduler nothing to move.
#
# It refuses until the amendment card
# accept-first-unattended-run-depends-on-next-run-actions-20261019 is on main:
# without it, completing the first in-scope Action would advance the pointer
# back onto first-unattended-run, which is queued first.
#
# It never settles an Ask, edits a document by hand, reorders the queue,
# activates production, starts a Session or force-pushes. Its only writes are
# the make-next commit (PROJECT.md and the Plan's current_action) and a normal
# fast-forward push of that one commit to origin/main.
set -Eeuo pipefail

LIBRARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
SCRIPT_ID="point-at-test-transient-review-retry-20261019"
AMENDMENT_CARD="accept-first-unattended-run-depends-on-next-run-actions-20261019"
PROJECT="arcadia"
PLAN="arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider"
PLAN_FILE="docs/plans/$PLAN.md"
FROM="first-unattended-run"
TO="test-transient-review-retry-after-exhaustion"
ACTION_KEY="$PROJECT/$TO"
REQUIRED_DEPENDENCIES='["test-transient-review-retry-after-exhaustion","refresh-decision-0130-status-and-1559-fake","guard-repair-gate-upsert-role"]'
# One fixed request id: a replay of make-next under it returns the original receipt.
REQUEST_ID="$SCRIPT_ID"
SUBJECT="chore(arcadia): point at $TO"
CARD_EXPIRES_AT="2026-10-26T00:00:00Z"

MODE="${1:-run}"
case "$MODE" in run | --describe) ;; *) echo "usage: $0 [run|--describe]" >&2; exit 2 ;; esac
if [[ "$MODE" == --describe ]]; then cat "$LIBRARY_DIR/$SCRIPT_ID.json"; exit 0; fi

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
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
finish_refused() {
  local code="$1"
  trap - ERR TERM INT
  set +e
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
    case "$STAGE" in
      publish) echo "The pointer commit exists on local main but its push was not confirmed. Press this card again: it recognises that exact commit and only publishes it. Do not press the next-run Grant until origin/main carries it." ;;
      *) echo "Nothing was published. Resolve the named condition, then press this card again; do not press the next-run Grant while the pointer still names $FROM." ;;
    esac
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
arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }
# The top-level frontmatter current_action only (Action fields are indented); one process, no pipe.
pointer_of() { awk 'NR == 1 && /^---$/ { f = 1; next } f && /^---$/ { exit } f && /^current_action:/ { sub(/^current_action:[ \t]*/, ""); print; exit }' "$ARCADIA_REPO/$1"; }

echo "== Move Arcadia's pointer: $FROM -> $TO (before the next-run Grant) =="
DESCRIPTOR_PATH="${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}"
[[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$SCRIPT_ID" && -n "$DESCRIPTOR_PATH" && -f "$DESCRIPTOR_PATH" ]] || refuse "launch this card through the /actions operator-action library"
[[ "$(cd "$(dirname "$DESCRIPTOR_PATH")" && pwd -P)/$(basename "$DESCRIPTOR_PATH")" == "$LIBRARY_DIR/$SCRIPT_ID.json" ]] || refuse "the launching descriptor is not this card's descriptor"
[[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only card: an agent sandbox may not run it"

STAGE=parameters
for tool in git jq mise timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
for reviewed in "$LIBRARY_DIR/$SCRIPT_ID.sh" "$LIBRARY_DIR/$SCRIPT_ID.json"; do
  git -C "$ARCADIA_REPO" ls-files --error-unmatch -- "$reviewed" >/dev/null 2>&1 && git -C "$ARCADIA_REPO" diff --quiet HEAD -- "$reviewed" \
    || refuse "$reviewed is not tracked and unmodified at the checkout's HEAD"
done
node -e 'process.exit(Date.now() < Date.parse(process.argv[1]) ? 0 : 1)' "$CARD_EXPIRES_AT" || refuse "this card expired at $CARD_EXPIRES_AT; ask for a fresh card"
record_str from "$FROM"
record_str to "$TO"

STAGE=preconditions
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean on main"
timeout 60 git -C "$ARCADIA_REPO" fetch -q origin main || refuse "origin main could not be fetched within 60 seconds"
HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)"
ORIGIN="$(git -C "$ARCADIA_REPO" rev-parse refs/remotes/origin/main)"
PROJECT_POINTER="$(pointer_of PROJECT.md)"
PLAN_POINTER="$(pointer_of "$PLAN_FILE")"
record_str headBefore "$HEAD"
grep -q '^status: active$' "$ARCADIA_REPO/$PLAN_FILE" || refuse "the Plan $PLAN is not active"
grep -q "^active_plan: $PLAN\$" "$ARCADIA_REPO/PROJECT.md" || refuse "PROJECT.md's active_plan is not $PLAN"
# The amendment must be on main: first-unattended-run waits for every in-scope Action.
node -e '
const { createRequire } = require("node:module");
const [repo, file, from, needed] = process.argv.slice(1);
const { parse } = createRequire(repo + "/package.json")("yaml");
const text = require("node:fs").readFileSync(repo + "/" + file, "utf8");
const plan = parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]);
const action = (plan.actions || []).find((a) => a.id === from);
process.exit(action && JSON.parse(needed).every((id) => (action.depends_on || []).includes(id)) ? 0 : 1);
' "$ARCADIA_REPO" "$PLAN_FILE" "$FROM" "$REQUIRED_DEPENDENCIES" \
  || refuse "$FROM does not yet depend on the three next-run Actions; press $AMENDMENT_CARD first"
STATUS_JSON="$(arcadia production status --json)" || refuse "production status could not be read"
jq -e '.ok == true and .data.read.status == "ok" and .data.read.policy.desiredState == "inactive"' <<<"$STATUS_JSON" >/dev/null \
  || refuse "production must be Inactive (this card runs before the next-run Grant, never during a run)"

if [[ "$PROJECT_POINTER" == "$TO" && "$PLAN_POINTER" == "$TO" ]]; then
  # A previous press already applied make-next. Publish only that exact commit, or report it published.
  if [[ "$HEAD" == "$ORIGIN" ]]; then
    STAGE=done
    record alreadyPublished true
    record_str headAfter "$HEAD"
    write_receipt succeeded
    echo "The pointer already names $TO on origin/main ($HEAD). Nothing to do; press the next-run Grant when ready."
    exit 0
  fi
  [[ "$(git -C "$ARCADIA_REPO" rev-parse HEAD^)" == "$ORIGIN" ]] || refuse "local main is not exactly one commit ahead of origin/main"
  [[ "$(git -C "$ARCADIA_REPO" log -1 --format=%s HEAD)" == "$SUBJECT" ]] || refuse "the unpublished commit on main is not this card's pointer commit"
  [[ "$(git -C "$ARCADIA_REPO" diff-tree --no-commit-id --name-only -r HEAD | sort | tr '\n' ' ')" == "$(printf '%s\n' PROJECT.md "$PLAN_FILE" | sort | tr '\n' ' ')" ]] \
    || refuse "the unpublished pointer commit touches files other than PROJECT.md and the Plan"
  git -C "$ARCADIA_REPO" log -1 --format=%B HEAD | grep -q "^Written by \`arcadia advance queue make-next --apply\`" || refuse "the unpublished commit was not written by make-next"
  record recoveredUnpublished true
else
  [[ "$PROJECT_POINTER" == "$FROM" && "$PLAN_POINTER" == "$FROM" ]] || refuse "the pointers name '$PROJECT_POINTER' (PROJECT.md) and '$PLAN_POINTER' (Plan), not $FROM; this card is stale"
  [[ "$HEAD" == "$ORIGIN" ]] || refuse "main is not level with origin/main"
  REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main)" || refuse "origin main could not be observed within 30 seconds"
  [[ "${REMOTE_LINE%%[[:space:]]*}" == "$HEAD" ]] || refuse "origin main moved during the check"

  STAGE=preview
  QUEUE_JSON="$(arcadia advance queue --json)" || refuse "the Action queue could not be read"
  REVISION="$(jq -er '.data.revision' <<<"$QUEUE_JSON")" || refuse "the queue revision could not be read"
  jq -e --arg k "$ACTION_KEY" '[.data.ordered[] | select(.orderKey == $k and .state == "ready")] | length == 1' <<<"$QUEUE_JSON" >/dev/null \
    || refuse "$ACTION_KEY is not queued and ready"
  record queueRevision "$REVISION"
  PREVIEW_JSON="$(arcadia advance queue make-next --action "$ACTION_KEY" --revision "$REVISION" --request-id "$REQUEST_ID" --json)" || refuse "make-next preview refused: $(jq -r '.error.message // empty' <<<"${PREVIEW_JSON:-}" 2>/dev/null)"
  printf '%s\n' "$PREVIEW_JSON" > "$RUN_DIR/make-next-preview.json"
  jq -e --arg from "$FROM" --arg to "$TO" --arg head "$HEAD" --arg plan "$PLAN_FILE" '.ok == true and .data.receipt.applied == false
    and .data.receipt.previousAction == $from and .data.receipt.nextAction == $to and .data.receipt.headBefore == $head
    and .data.receipt.projectPath == "PROJECT.md" and .data.receipt.planPath == $plan' <<<"$PREVIEW_JSON" >/dev/null \
    || refuse "the make-next preview is not exactly $FROM -> $TO at main's HEAD"
  FINGERPRINT="$(jq -er '.data.receipt.previewFingerprint' <<<"$PREVIEW_JSON")"
  record_str previewFingerprint "$FINGERPRINT"

  STAGE=apply
  APPLY_JSON="$(arcadia advance queue make-next --action "$ACTION_KEY" --revision "$REVISION" --request-id "$REQUEST_ID" --preview "$FINGERPRINT" --apply --json)" || refuse "make-next apply refused"
  printf '%s\n' "$APPLY_JSON" > "$RUN_DIR/make-next-apply.json"
  jq -e --arg fp "$FINGERPRINT" '.ok == true and .data.receipt.applied == true and .data.receipt.previewFingerprint == $fp and ((.data.receipt.commitError // null) == null)' <<<"$APPLY_JSON" >/dev/null \
    || refuse "make-next apply did not report one committed pointer transition"
  record_str pointerReceipt "$(jq -r '.data.receipt.id' <<<"$APPLY_JSON")"
  [[ "$(git -C "$ARCADIA_REPO" rev-parse HEAD^)" == "$HEAD" && "$(git -C "$ARCADIA_REPO" log -1 --format=%s HEAD)" == "$SUBJECT" ]] \
    || refuse "main is not exactly one make-next commit ahead of the checked HEAD"
  [[ "$(git -C "$ARCADIA_REPO" diff-tree --no-commit-id --name-only -r HEAD | sort | tr '\n' ' ')" == "$(printf '%s\n' PROJECT.md "$PLAN_FILE" | sort | tr '\n' ' ')" ]] \
    || refuse "the pointer commit touches files other than PROJECT.md and the Plan"
  [[ "$(pointer_of PROJECT.md)" == "$TO" && "$(pointer_of "$PLAN_FILE")" == "$TO" ]] || refuse "the committed pointers do not name $TO"
fi

STAGE=publish
NEW_HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)"
timeout 60 git -C "$ARCADIA_REPO" push origin "$NEW_HEAD:refs/heads/main" || refuse "pushing the pointer commit to origin main failed (no force was used)"
REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main)" || refuse "origin main could not be observed after the push"
[[ "${REMOTE_LINE%%[[:space:]]*}" == "$NEW_HEAD" ]] || refuse "origin main does not carry the pointer commit after the push"
timeout 60 git -C "$ARCADIA_REPO" fetch -q origin main || true

STAGE=done
record_str headAfter "$NEW_HEAD"
record published true
write_receipt succeeded
echo "Pointer moved: PROJECT.md and the Plan now name $TO on origin/main ($NEW_HEAD)."
echo "Next: press the next-run Grant (grant-production-unattended-claude-next-run-20261019) when ready."
