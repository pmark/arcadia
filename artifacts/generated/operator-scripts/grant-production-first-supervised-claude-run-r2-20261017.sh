#!/usr/bin/env bash
# RE-RUN of grant-production-first-supervised-claude-run-20261017 (already pressed
# and activated once): identical scope, fingerprint derivation and safeguards under
# a new one-shot request id, restarting the run after a services restart for the
# tmux launch fix. Two added preconditions: PROJECT.md current_action must still be
# the one Action, and the code at HEAD must contain src/sessions/tmuxLauncher.ts so a
# re-run never launches with the known-bad launch path.
#
# One-shot Grant for the first supervised production run on Arcadia's own
# repository on the Claude provider (one Action). A copy of the 2026-10-11
# supervised-run Grants (grant-production-governance-overlap-supervised-run-
# 2026-10-11, grant-production-bug-plan-first-supervised-run-2026-10-11) with the
# Plan, Action, provider, Decision and intent changed and four preconditions
# added: the capacity gate must be ON (the workspace config must not carry
# codingAgent.capacityGateEnabled: false, and the capacity read must not report
# claude-code-cli as unmetered by configuration), the worker-context Claude Code
# sign-in must read signed in, ANTHROPIC_API_KEY must be unset, and the preview
# must queue exactly the one Action as ready. It is the shared rehearsal-chain G7
# pattern (rehearsal-chain/grant.sh) narrowed to this run: /actions launch only,
# fail-closed preconditions, a preview at the current policy revision, a second
# identical preview immediately before activation, one activation under this
# script's own request id, a fingerprint check that returns only this Grant to
# Off on any mismatch, and a durable receipt.
#
# The scope fingerprint cannot be pinned as a literal because it covers the
# packet-approval expiry, which is computed at press time (press + 24 hours).
# Instead every other scope field is pinned in this file, the expiry is computed
# once, and the script derives the expected fingerprint itself (the canonical
# form of fingerprintProductionScope in src/production/policy.ts) from the pinned
# fields plus that one expiry. The preview must equal it exactly, so any other
# field (a second Action, another intent, an integration grant, a Session limit)
# refuses before activation. The scope is exactly the one Action for provider
# claude-code-cli at concurrency one with draft-PR remote preservation and the
# mechanics validation, acceptance, pointer and packet_approval (Decision 0072).
# It carries NO integration grant: the worker never readies or merges a pull
# request. It never edits the workspace config or the capacity gate, never
# merges on GitHub, pushes a base branch, launches or terminates a Session,
# restarts a service, or turns production back on after Off.
set -Eeuo pipefail

LIBRARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCADIA_REPO="$(cd "$LIBRARY_DIR/../../.." && pwd -P)"
SCRIPT_ID="grant-production-first-supervised-claude-run-r2-20261017"
# The generic STOP entry (it turns production Off under any request id); its id still carries the first run's name.
OFF_ID="restore-off-production-bug-plan-first-supervised-run-2026-10-11"
# The operator-owned card that turns the capacity gate on; this Grant refuses until it has been pressed.
GATE_CARD_ID="enable-capacity-gate-20261017"
PROJECT="arcadia"
PLAN="arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider"
PLAN_FILE="docs/plans/$PLAN.md"
ACTIONS=(
  implement-a-hermetic-test-that-an
)
PROVIDER="claude-code-cli"
TRANSITIONS="validation,acceptance,pointer,packet_approval"
PACKET_APPROVAL_HOURS=24
TMUX_LAUNCHER="src/sessions/tmuxLauncher.ts"
SPEND_DECISION="0130"
SPEND_DECISION_GLOB="docs/decisions/0130-*.md"
INTENT="First supervised production run on Arcadia's own repository on the claude-code provider: one Action, ending in a reviewed merged PR."

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
ACTIVATED=false
ACTIVATION_ATTEMPTED=false
json_string() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; printf '"%s"' "$s"; }
record() { EXTRA="$EXTRA,$(json_string "$1"):$2"; }
record_str() { record "$1" "$(json_string "$2")"; }
write_receipt() {
  printf '{"schema":"arcadia-operator-run-receipt-v1","id":%s,"runId":%s,"startedAt":%s,"finishedAt":%s,"outcome":%s,"stage":%s,"reason":%s,"runLog":%s,"activated":%s%s}\n' \
    "$(json_string "$SCRIPT_ID")" "$(json_string "$RUN_ID")" "$(json_string "$STARTED_AT")" "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    "$(json_string "$1")" "$(json_string "$STAGE")" "$(json_string "$REASON")" "$(json_string "$LOG")" "$ACTIVATED" "$EXTRA" > "$RECEIPT"
}
refuse() { REASON="$*"; echo "REFUSED: $*" >&2; return 1; }
arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@"); }

# After an activation attempt, the CLI's exit status is not proof of the outcome:
# activation can commit and the CLI still time out, fail or print unparsable
# output. Observe production status instead and return only this Grant to Off.
# Sets OFF_RESULT to one of: not_attempted, not_active, other_grant_active,
# returned_off, off_issued_unobserved (status stayed unreadable; an Off was
# issued blind and its output confirms Inactive, whether this Grant was Active
# is unknown), OFF_FAILED, UNKNOWN.
reconcile_activation() {
  local status="" attempt
  [[ "$ACTIVATION_ATTEMPTED" == true ]] || { OFF_RESULT=not_attempted; return 0; }
  for attempt in 1 2 3; do
    if status="$(arcadia production status --json)" && jq -e '.ok == true and .data.read.status == "ok"' <<<"$status" >/dev/null 2>&1; then break; fi
    status=""; sleep 5
  done
  if [[ -z "$status" ]]; then
    # Status stayed unreadable. Production was Inactive when this run started, so an Active policy now can
    # only be this attempt's: try the Off anyway (over-stopping is safe) and report it only if it confirms.
    if arcadia production deactivate --request-id "$SCRIPT_ID-$RUN_ID-off-unread" --reason 'The supervised-run Grant could not read production status after an activation attempt; return production to Off and preserve evidence.' --json > "$RUN_DIR/off.json" \
      && jq -e '.ok == true and .data.result.policy.desiredState == "inactive"' "$RUN_DIR/off.json" >/dev/null 2>&1; then
      OFF_RESULT=off_issued_unobserved
    else
      OFF_RESULT=UNKNOWN
    fi
    return 0
  fi
  printf '%s\n' "$status" > "$RUN_DIR/status-after-failure.json"
  if jq -e '.data.read.policy.desiredState == "inactive"' <<<"$status" >/dev/null; then OFF_RESULT=not_active; return 0; fi
  if ! jq -e --arg id "$SCRIPT_ID" '.data.read.policy.authority.requestId == $id' <<<"$status" >/dev/null; then OFF_RESULT=other_grant_active; return 0; fi
  ACTIVATED=true
  if arcadia production deactivate --request-id "$SCRIPT_ID-$RUN_ID-off" --reason 'The supervised-run Grant did not complete verification after an activation attempt; return this exact Grant to Off and preserve evidence.' --json > "$RUN_DIR/off.json" \
    && jq -e '.ok == true and .data.result.policy.desiredState == "inactive"' "$RUN_DIR/off.json" >/dev/null 2>&1; then
    OFF_RESULT=returned_off
  else
    OFF_RESULT=OFF_FAILED
  fi
}
finish_refused() {
  local code="$1" off
  trap - ERR TERM INT
  set +e
  OFF_RESULT=UNKNOWN
  reconcile_activation
  off="$OFF_RESULT"
  # The receipt reports what was observed: an unreadable status is not "not activated".
  case "$off" in
    returned_off | OFF_FAILED) ACTIVATED=true ;;
    UNKNOWN | off_issued_unobserved) ACTIVATED='"unknown"' ;;
    *) ACTIVATED=false ;;
  esac
  record_str offCleanup "$off"
  write_receipt refused
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: $SCRIPT_ID"
    echo "- stage: $STAGE"
    echo "- reason: $REASON"
    echo "- run log: $LOG"
    echo "- receipt: $RECEIPT"
    echo "- observed Off cleanup: $off"
    echo
    case "$off" in
      not_attempted) echo "No activation was attempted: production policy was not changed by this run." ;;
      not_active) echo "An activation was attempted, and production status afterwards reads Inactive. This Grant is not active." ;;
      returned_off) echo "An activation by this Grant was observed Active after the failure; the script returned only this Grant to Off and the Off was confirmed." ;;
      other_grant_active) echo "Production is Active under ANOTHER request id, not this Grant; this script did not touch it. Read production status and press the STOP button ($OFF_ID) if that is not intended." ;;
      off_issued_unobserved) echo "Production status stayed unreadable after the activation attempt, so an Off was issued blind under a fresh request id and its output confirms Inactive. Whether this Grant was ever Active is unknown; production now reads Inactive from that output. Confirm with production status." ;;
      OFF_FAILED) echo "This Grant was observed Active and the Off was NOT confirmed. Press the STOP button ($OFF_ID) NOW from /actions and read production status." ;;
      *) echo "Production status could not be read after the activation attempt: the policy may be ACTIVE. Press the STOP button ($OFF_ID) NOW from /actions." ;;
    esac
    echo "Do not press this one-shot Grant again blindly. Resolve the named drift and ask for a fresh Grant if the scope changed."
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

echo "== Supervised run Grant: Arcadia's first supervised Claude run, claude-code-cli only, one Action =="
# A one-shot Grant runs only through the operator-action library, whose lifecycle disables it after success.
DESCRIPTOR_PATH="${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}"
[[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$SCRIPT_ID" && -n "$DESCRIPTOR_PATH" && -f "$DESCRIPTOR_PATH" ]] || refuse "launch this one-shot Grant through the /actions operator-action library"
[[ "$(cd "$(dirname "$DESCRIPTOR_PATH")" && pwd -P)/$(basename "$DESCRIPTOR_PATH")" == "$LIBRARY_DIR/$SCRIPT_ID.json" ]] || refuse "the launching descriptor is not this Grant's descriptor"
[[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only Grant: an agent sandbox may not run it"
# A set API key can bill paid API usage instead of the Claude subscription; its value is never read.
[[ -z "${ANTHROPIC_API_KEY:-}" ]] || refuse "ANTHROPIC_API_KEY is set in this host environment, which can bill paid API usage; unset it (its value was not read)"

STAGE=parameters
for tool in git jq mise timeout node; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done
# Reviewed, not merely rendered: this script and its descriptor must be tracked
# and unmodified at the checkout's HEAD (artifacts/generated is gitignored).
for reviewed in "$LIBRARY_DIR/$SCRIPT_ID.sh" "$LIBRARY_DIR/$SCRIPT_ID.json"; do
  git -C "$ARCADIA_REPO" ls-files --error-unmatch -- "$reviewed" >/dev/null 2>&1 && git -C "$ARCADIA_REPO" diff --quiet HEAD -- "$reviewed" \
    || refuse "$reviewed is not tracked and unmodified at the checkout's HEAD; a Grant's script and descriptor must be reviewed and committed before they run"
done
N="${#ACTIONS[@]}"
ACTION_IDS_JSON="$(printf '%s\n' "${ACTIONS[@]}" | jq -R . | jq -sc .)"
SCOPED_ACTIONS_JSON="$(jq -c --arg p "$PROJECT" '[.[] | "\($p)/\(.)"]' <<<"$ACTION_IDS_JSON")"
jq -e --argjson n "$N" 'length == $n and (unique | length) == $n' <<<"$ACTION_IDS_JSON" >/dev/null || refuse "the Action list has duplicates"
record_str plan "$PROJECT/$PLAN"
record actionIds "$ACTION_IDS_JSON"
record_str provider "$PROVIDER"
record_str transitions "$TRANSITIONS"

STAGE=preconditions
WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve"
[[ "${WORKSPACE##*/}" == martianrover ]] || refuse "the configured default workspace is not martianrover"
[[ "$(git -C "$ARCADIA_REPO" branch --show-current)" == main && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "the Arcadia checkout must be clean on main"
HEAD="$(git -C "$ARCADIA_REPO" rev-parse HEAD)"
[[ "$HEAD" == "$(git -C "$ARCADIA_REPO" rev-parse origin/main)" ]] || refuse "main is not level with its last-fetched origin/main"
REMOTE_LINE="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main)" || refuse "origin main could not be observed within 30 seconds"
[[ "${REMOTE_LINE%%[[:space:]]*}" == "$HEAD" ]] || refuse "origin main has moved past local main; fast-forward the checkout and reinstall, then ask for a fresh Grant"
DECISION_FILE="$(compgen -G "$ARCADIA_REPO/$SPEND_DECISION_GLOB" | head -n 1)" || true
[[ -n "$DECISION_FILE" ]] || refuse "Decision $SPEND_DECISION is not in $SPEND_DECISION_GLOB"
grep -q '^status: approved$' "$DECISION_FILE" || refuse "Decision $SPEND_DECISION is not approved"
grep -Eq '^answer: .+' "$DECISION_FILE" || refuse "Decision $SPEND_DECISION has no recorded answer"
[[ -f "$ARCADIA_REPO/$PLAN_FILE" ]] || refuse "the Plan file $PLAN_FILE is missing"
grep -q '^status: active$' "$ARCADIA_REPO/$PLAN_FILE" || refuse "the Plan $PLAN is not active"
# Re-run precondition: the project pointer is still on the one Action (the queue head).
grep -Eq "^current_action: ${ACTIONS[0]}\$" "$ARCADIA_REPO/PROJECT.md" || refuse "PROJECT.md current_action is not ${ACTIONS[0]}; the re-run needs the pointer on the one Action"
# Re-run precondition: main carries the tmux launcher fix, so a re-run never uses the known-bad launch path.
git -C "$ARCADIA_REPO" cat-file -e "$HEAD:$TMUX_LAUNCHER" 2>/dev/null || refuse "main does not contain $TMUX_LAUNCHER (the tmux launch fix); merge it and reinstall before this re-run"
BROKER="$(arcadia go-broker status --json)" || refuse "go-broker status is not ready"
jq -e '.ok == true and .data.ready == true and .data.preservationTransport.ready == true and .data.agentGoTransport.ready == true' <<<"$BROKER" >/dev/null || refuse "the installed broker or its host transports are not ready"
BROKER_REVISION="$(jq -r '.data.revision' <<<"$BROKER")"
git -C "$ARCADIA_REPO" merge-base --is-ancestor "$BROKER_REVISION" "$HEAD" || refuse "installed release $BROKER_REVISION is not on main"
git -C "$ARCADIA_REPO" diff --quiet "$BROKER_REVISION" "$HEAD" -- src scripts apps package.json pnpm-lock.yaml tsconfig.json || refuse "installed release $BROKER_REVISION is stale against main $HEAD; reinstall before granting"
record_str arcadiaHead "$HEAD"
record_str installedRelease "$BROKER_REVISION"
record_str tmuxLauncherAtHead "$TMUX_LAUNCHER"
record_str spendDecision "$SPEND_DECISION"
record_str workspace "$WORKSPACE"

STAGE=capacity_gate
# Observed, never changed: this script never edits the workspace config. The
# capacity gate must be ON (Decision 0130's read-only usage check and 80% cap
# apply only then): the operator presses the $GATE_CARD_ID card first.
CONFIG_FILE="$WORKSPACE/config/arcadia.json"
[[ -f "$CONFIG_FILE" ]] || refuse "the workspace config $CONFIG_FILE is missing, so the capacity gate state is unknown"
GATE_FIELD="$(jq -c '.codingAgent // {} | if has("capacityGateEnabled") then .capacityGateEnabled else "absent" end' "$CONFIG_FILE")" || refuse "the workspace config is not readable JSON, so the capacity gate state is unknown"
[[ "$GATE_FIELD" != false ]] || refuse "the capacity gate is OFF: the workspace config sets codingAgent.capacityGateEnabled: false; press $GATE_CARD_ID first, then press this Grant"
[[ "$GATE_FIELD" == '"absent"' || "$GATE_FIELD" == true ]] || refuse "the workspace config has an unexpected codingAgent.capacityGateEnabled value: $GATE_FIELD"
record capacityGateConfigField "$GATE_FIELD"

STAGE=claude_sign_in
# Worker-context Claude Code sign-in: the same check a managed launch runs (the
# rehearsal-chain preflight's probe). Only the verdict leaves the probe; the token
# is never printed or copied.
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
if CLAUDE_SIGN_IN="$(cd "$ARCADIA_REPO" && timeout 120 mise exec -- node --import tsx --input-type=module - "$WORKSPACE" < "$RUN_DIR/probe-claude-sign-in.mjs")"; then
  CLAUDE_VERDICT="$(jq -r '.verdict // "unavailable"' <<<"$CLAUDE_SIGN_IN" 2>/dev/null || echo unavailable)"
fi
record_str claudeSignIn "$CLAUDE_VERDICT"
[[ "$CLAUDE_VERDICT" == signed_in ]] || refuse "the worker-context claude-code-cli sign-in verdict is $CLAUDE_VERDICT; sign Claude Code in on the host, then press again"

STAGE=capacity
# Read only, never the CLI's refresh option: that refresh may exchange the OAuth refresh
# token, which Decision 0130 forbids; the worker itself refreshes read-only before
# each admission. So a stale reading is accepted here (the worker refreshes it,
# and refuses the launch if it stays stale); every other refusal (unknown usage,
# exhausted window, the 80% reserve margin, an expired attestation) refuses now,
# because it would stall the first tick. An operator_config source means the gate
# is still off for this provider and refuses.
CAPACITY="$(arcadia production capacity --json)" || refuse "the capacity read failed"
printf '%s\n' "$CAPACITY" > "$RUN_DIR/capacity.json"
jq -e --arg p "$PROVIDER" '.ok == true and ([.data.observation.providers[] | select(.providerId == $p)] | length) == 1' <<<"$CAPACITY" >/dev/null || refuse "the capacity read has no single $PROVIDER observation"
record capacityObserved "$(jq -c --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | {admitted, code, source: .receipt.source, reason}][0]' <<<"$CAPACITY")"
if jq -e --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | .receipt.source] == ["operator_config"]' <<<"$CAPACITY" >/dev/null; then
  refuse "the capacity read still reports $PROVIDER as unmetered by workspace configuration (the capacity gate is off); press $GATE_CARD_ID first"
fi
jq -e --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | (.admitted == true or .code == "capacity_stale")] == [true]' <<<"$CAPACITY" >/dev/null \
  || refuse "the capacity read refuses $PROVIDER for a reason a read-only refresh will not clear: $(jq -c --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | {admitted, code, reason}]' <<<"$CAPACITY")"
CAPACITY_GATE="on: $PROVIDER $(jq -r --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | if .admitted then "admitted" else "stale (the worker refreshes it read-only before admission)" end][0]' <<<"$CAPACITY") by the capacity read (source $(jq -r --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | .receipt.source][0] // "unknown"' <<<"$CAPACITY"))"
record_str capacityGate "$CAPACITY_GATE"

STAGE=production_state
STATUS="$(arcadia production status --json)"
printf '%s\n' "$STATUS" > "$RUN_DIR/status-before.json"
jq -e '.ok == true and .data.read.status == "ok"' <<<"$STATUS" >/dev/null || refuse "production status is unreadable"
if jq -e --arg id "$SCRIPT_ID" '.data.read.policy.authority.requestId == $id' <<<"$STATUS" >/dev/null; then
  refuse "this exact Grant request id is already recorded in production policy; it is one-shot and is not reapplied"
fi
jq -e '.data.read.policy.desiredState == "inactive" and .data.liveAdmissions == 0' <<<"$STATUS" >/dev/null || refuse "production must be Inactive with zero live admissions"
REVISION="$(jq -r '.data.read.policy.revision' <<<"$STATUS")"
[[ "$REVISION" =~ ^[0-9]+$ ]] || refuse "production status gave no numeric policy revision"
record policyRevisionBefore "$REVISION"

STAGE=preview
# The packet-approval delegation expires PACKET_APPROVAL_HOURS after this press.
EXPIRES="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 3600e3).toISOString())' "$PACKET_APPROVAL_HOURS")"
ARGS=(--project "$PROJECT" --plan "$PROJECT/$PLAN")
while IFS= read -r scoped; do ARGS+=(--action "$scoped"); done < <(jq -r '.[]' <<<"$SCOPED_ACTIONS_JSON")
ARGS+=(--provider "$PROVIDER" --concurrency 1 --transitions "$TRANSITIONS" --packet-approval-expires-at "$EXPIRES" --remote-preservation --intent "$INTENT")
(( ${#ARGS[@]} == 4 + 2 * N + 4 + 2 + 2 + 1 + 2 )) || refuse "the Grant arguments do not name exactly the $N Plan Actions"
# The pinned fingerprint: every scope field above is fixed in this file and the
# expiry was fixed once, just now, so the expected fingerprint is derived here
# from exactly those values, in the canonical form of fingerprintProductionScope
# (src/production/policy.ts: key order, sorted projects/plans/providers/
# transitions, Actions in order, optional keys only when set). The preview must
# equal it, so no field outside the pinned scope can ride along.
EXPECTED_FINGERPRINT="$(node -e '
const [intent, project, plan, actions, provider, transitions, expiresAt] = process.argv.slice(1);
const canonical = JSON.stringify({
  intent, projects: [project], plans: [plan], actions: JSON.parse(actions), providers: [provider], maxConcurrentSessions: 1,
  mechanicalTransitions: [...new Set(transitions.split(","))].sort(), remotePreservation: true, packetApprovalExpiresAt: expiresAt
});
process.stdout.write(require("crypto").createHash("sha256").update(canonical).digest("hex").slice(0, 32));
' "$INTENT" "$PROJECT" "$PROJECT/$PLAN" "$SCOPED_ACTIONS_JSON" "$PROVIDER" "$TRANSITIONS" "$EXPIRES")"
[[ "$EXPECTED_FINGERPRINT" =~ ^[0-9a-f]{32}$ ]] || refuse "the expected scope fingerprint could not be derived"
record_str expectedScopeFingerprint "$EXPECTED_FINGERPRINT"
PREVIEW="$(arcadia production preview "${ARGS[@]}" --json)"
printf '%s\n' "$PREVIEW" > "$RUN_DIR/preview.json"
jq -e --argjson rev "$REVISION" --arg p "$PROJECT" --arg plan "$PROJECT/$PLAN" --argjson actions "$SCOPED_ACTIONS_JSON" --arg provider "$PROVIDER" --arg e "$EXPIRES" --arg intent "$INTENT" --arg fp "$EXPECTED_FINGERPRINT" '
  def same_instant($x; $y): ($x | type == "string") and ($x | sub("\\.[0-9]+Z$"; "Z")) == ($y | sub("\\.[0-9]+Z$"; "Z"));
  # Arcadia may return the scope'"'"'s Actions in its own (queue) order: compare them as a set with no duplicates.
  def same_set($x; $y): ($x | type == "array") and ($x | length) == ($y | length) and ($x | unique | length) == ($x | length) and ($x | sort) == ($y | sort);
  .ok == true and .data.preview.expectedRevision == $rev
  and .data.preview.scope.intent == $intent
  and .data.preview.scope.projects == [$p] and .data.preview.scope.plans == [$plan]
  and same_set(.data.preview.scope.actions; $actions)
  and .data.preview.scope.providers == [$provider] and .data.preview.scope.maxConcurrentSessions == 1
  and (.data.preview.scope.mechanicalTransitions | sort) == ["acceptance", "packet_approval", "pointer", "validation"]
  and same_instant(.data.preview.scope.packetApprovalExpiresAt; $e)
  and .data.preview.scope.remotePreservation == true
  and (.data.preview.scope.integrationGrant == null)
  and (.data.preview.scope.rehearsalException == null)
  and (.data.preview.unmatched.projects == []) and (.data.preview.unmatched.plans == [])
  and (.data.preview.scope.sessionTimeLimitMs == null) and (.data.preview.scope.sessionInputTokenCeiling == null)
  and ([.data.preview.orderedActions[]? | {actionKey, state}] == [$actions[] | {actionKey: ., state: "ready"}])
  and .data.preview.scopeFingerprint == $fp' <<<"$PREVIEW" >/dev/null \
  || refuse "preview differs from the exact $N-Action (queued and ready), one-provider, concurrency-one, remote-preservation scope with a $PACKET_APPROVAL_HOURS-hour packet-approval delegation and no integration grant"
FINGERPRINT="$(jq -r '.data.preview.scopeFingerprint' <<<"$PREVIEW")"
record_str scopeFingerprint "$FINGERPRINT"
record_str packetApprovalExpiresAt "$EXPIRES"

# `production activate` recomputes its scope from the queue and has no
# expected-fingerprint option, so preview again immediately before activating
# and require the identical fingerprint and revision; after activation the
# recorded fingerprint is verified and a mismatch returns this Grant to Off.
STAGE=preview_recheck
[[ "$(git -C "$ARCADIA_REPO" rev-parse HEAD)" == "$HEAD" && -z "$(git -C "$ARCADIA_REPO" status --porcelain)" ]] || refuse "main moved or became dirty between the preconditions and activation"
# The press-time expiry must still be fresh: at most five minutes may pass between computing it and activating.
node -e 'const left = Date.parse(process.argv[1]) - Date.now(), full = Number(process.argv[2]) * 3600e3; process.exit(left > full - 300e3 && left <= full ? 0 : 1)' "$EXPIRES" "$PACKET_APPROVAL_HOURS" \
  || refuse "the packet-approval expiry $EXPIRES is no longer within five minutes of $PACKET_APPROVAL_HOURS hours from now"
RECHECK="$(arcadia production preview "${ARGS[@]}" --json)"
printf '%s\n' "$RECHECK" > "$RUN_DIR/preview-recheck.json"
jq -e --arg f "$FINGERPRINT" --argjson rev "$REVISION" '.ok == true and .data.preview.scopeFingerprint == $f and .data.preview.expectedRevision == $rev and ([.data.preview.orderedActions[]? | .state] == ["ready"])' <<<"$RECHECK" >/dev/null || refuse "the scope fingerprint or policy revision changed between preview and activation"

STAGE=activate
ACTIVATION_ATTEMPTED=true
ACTIVATION="$(arcadia production activate "${ARGS[@]}" --expected-revision "$REVISION" --request-id "$SCRIPT_ID" --granted-by 'P. Mark Anderson' --decision "$SPEND_DECISION" --json)" || refuse "the activate command failed or timed out; its outcome is read back from production status"
printf '%s\n' "$ACTIVATION" > "$RUN_DIR/activation.json"
if jq -e '.ok == true and .data.result.policy.desiredState == "active"' <<<"$ACTIVATION" >/dev/null 2>&1; then ACTIVATED=true; fi
[[ "$ACTIVATED" == true ]] || refuse "activation output did not confirm Active; its outcome is read back from production status"
jq -e --arg id "$SCRIPT_ID" --arg f "$FINGERPRINT" '.data.result.policy.authority.requestId == $id and .data.result.policy.authority.scopeFingerprint == $f' <<<"$ACTIVATION" >/dev/null || refuse "the active policy is not the previewed fingerprint"
record "policyRevisionAfter" "$(jq '.data.result.policy.revision' <<<"$ACTIVATION")"

STAGE=complete
REASON=""
ACTION_LIST="$(jq -r 'join(", ")' <<<"$ACTION_IDS_JSON")"
record_str authorizes "Only the previewed scope: Project $PROJECT, Plan $PLAN, the $N Actions $ACTION_LIST; provider $PROVIDER; concurrency 1; validation, acceptance and pointer mechanics; approving the build packet of each of those Actions until $EXPIRES (Decision 0072); draft-PR remote preservation. The policy itself has no expiry: it ends when the Actions finish or when the STOP button ($OFF_ID) is pressed."
record_str neverAuthorizes "A GitHub merge, readying a pull request, a reviewer run, a base-branch push, another Project, Plan, Action or provider, concurrency above one, an integration grant, a Session launched by this script, or reactivation after Off."
write_receipt succeeded
cat > "$RUN_DIR/receipt.md" <<EOF
# Supervised run Grant receipt

- request id: $SCRIPT_ID
- scope: $PROJECT/$PLAN, $N Action (queued and ready at grant time)
- Actions: $ACTION_LIST
- provider $PROVIDER; concurrency 1; mechanics $TRANSITIONS; remote preservation: on (draft PRs only)
- packet_approval delegation expires: $EXPIRES (an Action already approved is still admitted after it, #1012)
- integration grant: none; policy expiry: none (STOP button: $OFF_ID)
- spend Decision: $SPEND_DECISION; capacity gate at grant time: $CAPACITY_GATE
- policy revision before: $REVISION; scope fingerprint: $FINGERPRINT (equal to the fingerprint derived from the pinned scope and this expiry; previewed twice, verified after activation)
- installed release: $BROKER_REVISION; main: $HEAD
- run log: $LOG

The worker approves the build packet of the Action in scope until the
delegation expires, launches one Claude Code Session (claude-code-cli) only after
its read-only usage check admits it under Decision 0130's 80% cap, pushes a branch
and opens a draft pull request; it never readies or merges one. The pull request
is reviewed and merged by a supervisor. Press the STOP button ($OFF_ID) from
/actions to stop.
EOF
echo "GRANTED: exact $N-Action supervised-run scope only. Do not press again. Receipt: $RUN_DIR/receipt.md"
