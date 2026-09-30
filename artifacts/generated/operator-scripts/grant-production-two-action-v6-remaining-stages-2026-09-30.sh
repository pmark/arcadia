#!/usr/bin/env bash
# One-shot Grant.  It never terminates a Session, turns production Off, or
# restarts a service; those are deliberately observable morning steps.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ID="grant-production-two-action-v6-remaining-stages-2026-09-30"
ARCADIA_REPO="/Users/pmark/Dev/MR/Arcadia/arcadia"
FIXTURE_REPO="$HOME/tmp/arcadia-two-action-rehearsal-v6"
MANIFEST="$FIXTURE_REPO/.arcadia-v6-rehearsal.json"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$SCRIPT_DIR/runs/$RUN_ID"; LOG="$RUN_DIR/run.log"; HANDOFF="$RUN_DIR/failure-handoff.md"; RECEIPT="$RUN_DIR/receipt.md"
case "${1:-run}" in run) ;; --describe) cat "$SCRIPT_DIR/$SCRIPT_ID.json"; exit 0 ;; *) echo "usage: $0 [run|--describe]" >&2; exit 2;; esac
mkdir -p "$RUN_DIR"; exec > >(tee -a "$LOG") 2>&1
STAGE=preconditions
fail() { echo "REFUSED: $*" >&2; return 1; }
arcadia() { (cd "$ARCADIA_REPO" && mise exec -- pnpm -s arcadia "$@"); }
trap 'code=$?; trap - ERR; { echo "# Operator-script failure handoff"; echo; echo "- id: $SCRIPT_ID"; echo "- stage: $STAGE"; echo "- run log: $LOG"; echo "- failed command: \`$BASH_COMMAND\`"; echo; if [[ "$STAGE" == activate ]]; then echo "The Grant may have applied; inspect $RECEIPT and production status before any further action."; else echo "The Grant was not applied; correct the drift and rerun this one-shot action only if it remains unpressed."; fi; } > "$HANDOFF"; exit "$code"' ERR

for tool in jq mise git; do command -v "$tool" >/dev/null || fail "$tool is required"; done
[[ -f "$MANIFEST" ]] || fail "v6 fixture manifest missing; run the paired prepare action first"
PROJECT="$(jq -r '.fixtureProject' "$MANIFEST")"; PLAN="$(jq -r '.fixturePlan' "$MANIFEST")"; PROVIDER="$(jq -r '.provider' "$MANIFEST")"; SPLIT="$(jq -r '.splitAction' "$MANIFEST")"; OFF="$(jq -r '.offAction' "$MANIFEST")"; EXPECTED="$(jq -r '.preparedPolicyRevision' "$MANIFEST")"
[[ "$PROJECT" == two-action-rehearsal-v6 && "$PLAN" == two-action-rehearsal-v6-bootstrap && "$PROVIDER" == codex-cli ]] || fail "fixture manifest does not match the bounded v6 scope"
[[ -z "$(git -C "$FIXTURE_REPO" status --porcelain)" && "$(git -C "$FIXTURE_REPO" branch --show-current)" == main ]] || fail "fixture must be clean on main"
[[ -z "$(git -C "$ARCADIA_REPO" status --porcelain)" && "$(git -C "$ARCADIA_REPO" branch --show-current)" == main ]] || fail "Arcadia must be clean on main"
STATUS="$(arcadia production status --json)"; REVISION="$(jq -r '.data.read.policy.revision' <<<"$STATUS")"; STATE="$(jq -r '.data.read.policy.desiredState' <<<"$STATUS")"; REQUEST="$(jq -r '.data.read.policy.authority.requestId // empty' <<<"$STATUS")"
if [[ "$REQUEST" == "$SCRIPT_ID" ]]; then echo "Already granted by this exact request id at policy revision $REVISION."; else
  [[ "$STATE" == inactive ]] || fail "production is $STATE, not inactive"
  [[ "$REVISION" == "$EXPECTED" ]] || fail "policy revision drifted from prepared $EXPECTED to $REVISION; re-run prepare and review the new scope"
  EXPIRES="$(date -u -v+24H +%Y-%m-%dT%H:%M:%SZ)"
  ARGS=(--project "$PROJECT" --plan "$PROJECT/$PLAN" --provider "$PROVIDER" --concurrency 1 --transitions validation,acceptance,pointer,packet_approval --packet-approval-expires-at "$EXPIRES" --integration-grant-decision 0058 --integration-grant-expires-at "$EXPIRES" --integration-grant-action "$PROJECT/$SPLIT" --integration-grant-action "$PROJECT/$OFF" --intent 'Bounded v6 rehearsal: split one Action across two Sessions, then prove Off and worker restart during existing work.')
  STAGE=preview
  PREVIEW="$(arcadia production preview "${ARGS[@]}" --json)"; printf '%s\n' "$PREVIEW" > "$RUN_DIR/preview.json"
  jq -e --arg p "$PROJECT" --arg a "$PROJECT/$SPLIT" --arg b "$PROJECT/$OFF" --arg provider "$PROVIDER" --argjson expected "$EXPECTED" '.ok == true and .data.preview.expectedRevision == $expected and .data.preview.scope.providers == [$provider] and .data.preview.scope.maxConcurrentSessions == 1 and (.data.preview.scope.actions | sort) == ([$a,$b] | sort)' <<<"$PREVIEW" >/dev/null || fail "preview scope differs from the exact v6 two-Action, one-provider, cap-one Grant"
  STAGE=activate
  ACTIVATION="$(arcadia production activate "${ARGS[@]}" --expected-revision "$EXPECTED" --request-id "$SCRIPT_ID" --granted-by 'P. Mark Anderson' --json)"; printf '%s\n' "$ACTIVATION" > "$RUN_DIR/activation.json"
  jq -e '.ok == true' <<<"$ACTIVATION" >/dev/null || fail "activation refused"
fi
STAGE=receipt
cat > "$RECEIPT" <<EOF
# V6 Grant receipt

- request id: $SCRIPT_ID
- fixture: $PROJECT/$PLAN
- scope: $PROJECT/$SPLIT and $PROJECT/$OFF; provider $PROVIDER; concurrency 1
- policy revision before Grant: $EXPECTED
- Grant expiry: ${EXPIRES:-already-granted; inspect production status}
- run log: $LOG

This Grant did not terminate a Session, turn production Off, restart the worker,
or approve an unscoped Action. Follow morning-runbook.md for those observable steps.
EOF
echo "GRANTED: bounded v6 scope only. Do not press again. Receipt: $RECEIPT"
