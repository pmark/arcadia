#!/usr/bin/env bash
# Shared executor of every per-run START card (Decisions 0156 and 0157). Reviewed once; a card is the three-line
# launcher src/operatorActions/startRunPins.ts#startRunLauncher plus a descriptor whose `startRun` block carries every
# run-specific pin and, when the Plan is still a draft, the embedded `planActivation` block. Nothing run-specific is
# written here: every value is read from the descriptor with jq.
#
#   start-run.sh run        <descriptor.json>   P0..P6, the one-shot START
#   start-run.sh preflight  <descriptor.json>   P0..P2 only: no mutation, writes only a run directory, needs no /actions context
#   start-run.sh --describe <descriptor.json>   print the descriptor
#
# Phases (each writes receipt.json and failure-handoff.md in its run directory):
#   P0 context   P1 repo   P2 state                (read-only; a refusal consumes and changes nothing)
#   P3 consume   write <id>.consumed.json exclusively (the first mutation), fast-forward the clean checkout to the pin only
#   P4 install   go-broker ensure; verify; only then restart the pinned worker label; observe and bind the new worker
#   P5 plan      activate the pinned Plan through the shared planActivation runner (only when the Plan is a draft)
#   P6 start     the retained START tail: fresh capacity/queue, scope previewed twice, `production activate`, verification
#
# Gate lineage. "REF:Ln" cites a line of the reviewed reference card start-fixed-three-claude-actions-20261026.sh and
# "ADOPT:Ln" of adopt-go-1921-runtime-off-20261031.sh; a gate lifted verbatim keeps its message. The only gate replaced
# is REF:L193 (installed-revision pin) which becomes the reviewed-revision pin checked by `production runtime-check`.
#
# The whole body is a set of functions and the last line runs `main`: bash reads a script incrementally, and P3
# fast-forwards the checkout this file lives in, so nothing may be read from the file after main starts.
set -Eeuo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
ARCADIA_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXECUTOR_REL="scripts/start-run.sh"

# Constants of the executor itself (not run-specific): bounded waits and the freshness window of a worker heartbeat.
INSTALL_TIMEOUT_SECONDS=900
WORKER_WAIT_SECONDS=120
TRANSPORT_WAIT_SECONDS=180
HEARTBEAT_FRESH_MS=15000
ACTIVATION_RUNNER_TIMEOUT_SECONDS=300
# Test-only shortening of the two bounded waits, honoured solely when the hermetic-test marker is set.
if [[ -n "${START_RUN_TEST_FAKE:-}" && "${ARCADIA_START_RUN_TEST_HEARTBEAT_SECONDS:-}" =~ ^[0-9]+$ ]]; then
  WORKER_WAIT_SECONDS="$ARCADIA_START_RUN_TEST_HEARTBEAT_SECONDS"
  TRANSPORT_WAIT_SECONDS="$ARCADIA_START_RUN_TEST_HEARTBEAT_SECONDS"
fi

json_string() { jq -n --arg v "$1" '$v'; }
arcadia_t() { local t="$1"; shift; (cd "$ARCADIA_REPO" && timeout "$t" mise exec -- pnpm -s arcadia "$@"); }
arcadia() { arcadia_t 180 "$@"; }  # REF:L63
git_repo() { git -C "$ARCADIA_REPO" "$@"; }
pin() { jq -er ".startRun.$1" "$DESCRIPTOR"; }
pin_json() { jq -ec ".startRun.$1" "$DESCRIPTOR"; }
sha256_file() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
sha256_stdin() { node -e 'const b=[];process.stdin.on("data",c=>b.push(c)).on("end",()=>process.stdout.write(require("crypto").createHash("sha256").update(Buffer.concat(b)).digest("hex")))'; }
frontmatter_json() {
  (cd "$ARCADIA_REPO" && node -e 'const {parse}=require("yaml");let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const m=/^---\r?\n([\s\S]*?)\r?\n---/.exec(s);if(!m)process.exit(2);process.stdout.write(JSON.stringify(parse(m[1])))})')
}
worker_pid() {  # ADOPT:L68
  { launchctl list "$WORKER_LABEL" 2>/dev/null || true; } | sed -n 's/^[[:space:]]*"PID" = \([0-9][0-9]*\);$/\1/p'
}

# ---------------------------------------------------------------------------------------------------------------
# State, receipts and handoffs
# ---------------------------------------------------------------------------------------------------------------
BASE_SUBSHELL=0
PHASE="P0"; PHASE_NAME="context"
CONSUMED=false
MUTATIONS='[]'
RECORD='{}'
REASON=""
FF_DONE=false
ENSURE_ATTEMPTED=false
RESTART_ATTEMPTED=false
PLAN_ACTIVATION_ATTEMPTED=false
PLAN_ACTIVATED=false
ACTIVATION_ATTEMPTED=false
ACTIVATED=false
OFF_RESULT=not_attempted
NEEDS_ACTIVATION=false
mutated() { MUTATIONS="$(jq -c --arg m "$1" '. + [$m]' <<<"$MUTATIONS")"; }
rec() { RECORD="$(jq -c --arg k "$1" --argjson v "$2" '.[$k] = $v' <<<"$RECORD")"; }
rec_str() { rec "$1" "$(json_string "$2")"; }

write_receipt() {  # REF:L57 (receipt shape), extended with phase, allowance and mutation state
  local outcome="$1"
  jq -n --arg id "${ID:-unknown}" --arg runId "${RUN_ID:-unknown}" --arg mode "${MODE:-unknown}" --arg started "${STARTED_AT:-}" \
    --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg outcome "$outcome" --arg phase "$PHASE" --arg phaseName "$PHASE_NAME" \
    --argjson consumed "$CONSUMED" --argjson mutations "$MUTATIONS" --arg reason "$REASON" --argjson record "$RECORD" --arg log "${LOG:-}" \
    --arg off "$OFF_RESULT" --argjson activated "$ACTIVATED" --argjson planActivated "$PLAN_ACTIVATED" --argjson runtimeUpgraded "$ENSURE_ATTEMPTED" \
    '{schema: "arcadia-start-run-receipt-v1", id: $id, runId: $runId, mode: $mode, startedAt: $started, updatedAt: $updated,
      outcome: $outcome, phase: $phase, phaseName: $phaseName, allowanceConsumed: $consumed, mutations: $mutations,
      reason: $reason, runtimeUpgraded: $runtimeUpgraded, productionActivated: $activated, planActivatedByThisCard: $planActivated, offCleanup: $off, runLog: $log, record: $record}' \
    > "${RECEIPT}.tmp" 2>/dev/null && mv "${RECEIPT}.tmp" "$RECEIPT" || true
}

write_handoff() {  # REF:L111 (handoff), extended: phase, allowance, every mutation and the no-rollback statements
  local outcome="$1"
  {
    echo "# Operator-script failure handoff"
    echo
    echo "- id: ${ID:-unknown}"
    echo "- mode: ${MODE:-unknown}"
    echo "- outcome: $outcome"
    echo "- phase: $PHASE ($PHASE_NAME)"
    echo "- reason: $REASON"
    echo "- one-shot allowance consumed: $CONSUMED"
    echo "- run log: ${LOG:-}"
    echo "- receipt: ${RECEIPT:-}"
    echo "- observed Off cleanup: $OFF_RESULT"
    echo "- mutations by this run:"
    if [[ "$(jq 'length' <<<"$MUTATIONS")" == 0 ]]; then echo "  - none"; else jq -r '.[] | "  - " + .' <<<"$MUTATIONS"; fi
    echo
    case "$outcome" in
      in_progress) echo "This file is rewritten at every phase. If it still says in_progress, the run stopped hard during $PHASE: treat everything listed above as done and the rest as unknown." ;;
      succeeded) echo "No failure: the run completed. This file is kept so every run leaves the same two receipts." ;;
      preflight_ok) echo "Preflight only: nothing was consumed or changed." ;;
      *) if [[ "$CONSUMED" == false ]]; then
           echo "The run refused before its first mutation: nothing was consumed, installed, restarted or activated. Fix the named refusal and press this same card again (before it expires)."
         fi ;;
    esac
    if [[ "$CONSUMED" == true && "$outcome" != succeeded ]]; then
      echo "The one-shot allowance is consumed forever, from the first mutation on. Preserve the receipt; never reset or repeat it."
      if [[ "$FF_DONE" == true ]]; then echo "The main checkout was fast-forwarded to the pinned revision; this is not rolled back."; fi
      if [[ "$ENSURE_ATTEMPTED" == true ]]; then echo "go-broker ensure ran (or began to run): the broker may be installed at the pinned revision or partially installed. The runtime stays upgraded; there is no rollback to the previous release."; fi
      if [[ "$RESTART_ATTEMPTED" == true ]]; then echo "The worker restart was attempted: the worker may be on its new release, still on its old one, or not running. Read the worker status before anything else."; fi
      if [[ "$PLAN_ACTIVATION_ATTEMPTED" == true ]]; then echo "The Plan-activation runner was invoked. It is replay-safe (it verifies and recovers an existing settlement without applying twice) and this card's START marker is the only allowance, already consumed. If it succeeded the Plan stays active: there is no automatic deactivation."; fi
      if [[ "$PLAN_ACTIVATED" == true ]]; then echo "The Plan stays active (activated by this card)."; fi
    fi
    case "$OFF_RESULT" in  # REF:L121
      not_attempted) echo "No production activation was attempted: production policy was not changed by this run." ;;
      not_active) echo "An activation was attempted, and production status afterwards reads Inactive. This Grant is not active." ;;
      returned_off) echo "An activation by this Grant was observed Active after the failure; the script returned only this Grant to Off and the Off was confirmed." ;;
      other_grant_active) echo "Production is Active under ANOTHER request id, not this Grant; this script did not touch it. Read production status and press the STOP button (${OFF_ID:-the STOP entry}) if that is not intended." ;;
      off_issued_unobserved) echo "Production status stayed unreadable after the activation attempt, so an Off was issued blind under a fresh request id and its output confirms Inactive. Confirm with production status." ;;
      OFF_FAILED) echo "This Grant was observed Active and the Off was NOT confirmed. Press the STOP button (${OFF_ID:-the STOP entry}) NOW from /actions and read production status." ;;
      *) echo "Production status could not be read after the activation attempt: the policy may be ACTIVE. Press the STOP button (${OFF_ID:-the STOP entry}) NOW from /actions." ;;
    esac
  } > "${HANDOFF}.tmp" 2>/dev/null && mv "${HANDOFF}.tmp" "$HANDOFF" || true
}

checkpoint() { write_receipt in_progress; write_handoff in_progress; }
phase() { PHASE="$1"; PHASE_NAME="$2"; echo "==> $1 $2"; checkpoint; }

# REF:L65-L95. After an activation attempt the CLI's exit status is not proof of the outcome: observe production status
# and return only this Grant to Off. Sets OFF_RESULT.
reconcile_activation() {
  local status="" attempt
  [[ "$ACTIVATION_ATTEMPTED" == true ]] || { OFF_RESULT=not_attempted; return 0; }
  for attempt in 1 2 3; do
    if status="$(arcadia production status --json)" && jq -e '.ok == true and .data.read.status == "ok"' <<<"$status" >/dev/null 2>&1; then break; fi
    status=""; sleep 5
  done
  if [[ -z "$status" ]]; then OFF_RESULT=UNKNOWN; return 0; fi  # cannot prove ownership; never stop another grant blindly
  printf '%s\n' "$status" > "$RUN_DIR/status-after-failure.json"
  if jq -e '.data.read.policy.desiredState == "inactive"' <<<"$status" >/dev/null; then OFF_RESULT=not_active; return 0; fi
  if ! jq -e --arg p "$ID" '(.data.read.policy.authority.requestId // "") == $p' <<<"$status" >/dev/null; then OFF_RESULT=other_grant_active; return 0; fi
  ACTIVATED=true
  if arcadia production deactivate --request-id "$ID-$RUN_ID-off" --reason 'The unattended-run Grant did not complete verification after an activation attempt; return this exact Grant to Off and preserve evidence.' --json > "$RUN_DIR/off.json" \
    && jq -e '.ok == true and .data.result.policy.desiredState == "inactive"' "$RUN_DIR/off.json" >/dev/null 2>&1; then
    OFF_RESULT=returned_off
  else
    OFF_RESULT=OFF_FAILED
  fi
}

finish_failed() {  # REF:L96
  local code="$1" off
  trap - ERR TERM INT
  set +e
  reconcile_activation
  off="$OFF_RESULT"
  case "$off" in
    returned_off | OFF_FAILED) ACTIVATED=true ;;
    UNKNOWN | off_issued_unobserved) ACTIVATED='"unknown"' ;;
    *) ACTIVATED=false ;;
  esac
  write_receipt refused
  write_handoff refused
  echo "Failure handoff: $HANDOFF" >&2
  exit "$code"
}
refuse() { REASON="$*"; echo "REFUSED ($PHASE $PHASE_NAME): $*" >&2; finish_failed 1; }  # REF:L62
on_error() {  # REF:L135
  local code=$? command="$BASH_COMMAND"
  if (( BASH_SUBSHELL > BASE_SUBSHELL )); then exit "$code"; fi
  [[ -n "$REASON" ]] || REASON="command failed (exit $code): $command"
  finish_failed "$code"
}
on_signal() {  # REF:L141
  if (( BASH_SUBSHELL > BASE_SUBSHELL )); then exit 143; fi
  REASON="interrupted by a signal during $PHASE ($PHASE_NAME)"
  finish_failed 143
}

# ---------------------------------------------------------------------------------------------------------------
# Shared checks
# ---------------------------------------------------------------------------------------------------------------
check_expiry() {  # REF:L163, L362
  node -e 'process.exit(Date.now() < Date.parse(process.argv[1]) ? 0 : 1)' "$CARD_EXPIRES_AT" || refuse "$1"
}
check_preserved_history() {  # REF:L158, L364
  node -e 'const f=require("fs"),c=require("crypto");for(const x of JSON.parse(process.argv[1]))if(c.createHash("sha256").update(f.readFileSync(x.path)).digest("hex")!==x.sha256)throw Error("preserved receipt/authority drift")' "$(pin_json consumedHistory)" || refuse "consumed history or authority receipt changed"
}
check_reviewed_hashes() {  # REF:L161: the card pair and this executor against the independent review's manifest
  node -e 'const f=require("fs"),c=require("crypto"),p=require("path"),[lib,id,exe]=process.argv.slice(1);const m=JSON.parse(f.readFileSync(p.join(lib,"reviewed",id+".json")));const h=x=>c.createHash("sha256").update(f.readFileSync(x)).digest("hex");if(h(p.join(lib,id+".sh"))!==m.sh||h(p.join(lib,id+".json"))!==m.json||h(exe)!==m.executor)process.exit(1)' "$LIBRARY_DIR" "$ID" "$SELF" \
    || refuse "START pair or executor differs from the independently reviewed hashes"
}
# REF:L158 (receipt hashes), L245-L248 (sign-in evidence), L364. Read-only: never a new probe, refresh or credential read beyond the pinned
# receipts. $1 is the pre-restart worker's handler hash to require (the receipt's handlerHash must be that worker's, as in the reference),
# or empty after the restart, when the handler may legitimately change.
check_signin_evidence() {
  local out
  out="$(node -e '
const fs=require("fs"),c=require("crypto");
const [del,sig,handler]=process.argv.slice(1);
const h=x=>c.createHash("sha256").update(fs.readFileSync(x.path)).digest("hex");
try{
  const need=(x,m)=>{if(!x)throw Error(m)};
  const d=JSON.parse(del),s=JSON.parse(sig);
  need(h(d)===d.sha256,"START/STOP delegation receipt drift");
  need(h(s)===s.sha256,"sign-in evidence receipt drift");
  const r=JSON.parse(fs.readFileSync(s.path,"utf8"));
  need(r.success===true&&r.httpStatus===200&&r.outcome==="ok","sign-in evidence is not a successful verification");
  need(Date.parse(r.credentialExpiresAt)>Date.now()+5*60000,"credential expiry: the verified sign-in has expired or is within 5 minutes of expiry");
  need(Array.isArray(r.windows)&&r.windows.length===2&&r.windows.every(w=>Number.isFinite(w.usedPercentage)&&w.usedPercentage>=0&&w.usedPercentage<100),"usage window unknown or at 100%");
  if(handler)need(r.handlerHash===handler,"sign-in evidence handlerHash is not the pre-restart worker handler");
  process.stdout.write(JSON.stringify({credentialExpiresAt:r.credentialExpiresAt,windows:r.windows,receiptHandlerHash:r.handlerHash??null}));
}catch(e){process.stdout.write("REFUSED: "+e.message);process.exit(1)}
' "$(pin_json delegationReceipt)" "$(pin_json signInEvidence)" "${1:-}")" || refuse "sign-in, credential-expiry and delegation evidence gate: ${out#REFUSED: }"
  rec signInEvidence "$out"
}
check_checkout_clean_on_main() {  # REF:L191, ADOPT:L74-75
  [[ "$(git_repo branch --show-current)" == main ]] || refuse "the Arcadia checkout must be on main"
  [[ -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "the Arcadia checkout must be clean (uncommitted or untracked files present)"
}
check_origin_is_pin() {  # REF:L195-L196
  local remote_line
  remote_line="$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main)" || refuse "origin main could not be observed within 30 seconds"
  [[ "${remote_line%%[[:space:]]*}" == "$PIN" ]] || refuse "origin main is ${remote_line%%[[:space:]]*}, not the reviewed revision $PIN; origin main has moved (or been rewound): ask for a fresh card"
}
check_production_off() {  # REF:L277-L284, ADOPT:L83-L90
  local status
  STATUS="$(arcadia production status --json)" || refuse "production status could not be read"
  jq -e '.ok == true and .data.read.status == "ok"' <<<"$STATUS" >/dev/null || refuse "production status is unreadable"
  if jq -e --arg id "$ID" '.data.read.policy.authority.requestId == $id' <<<"$STATUS" >/dev/null; then
    refuse "this press's request id is already recorded in production policy; it is not reapplied"
  fi
  jq -e --argjson rev "$PROD_REVISION" --argjson epoch "$PROD_EPOCH" '.data.read.policy.desiredState == "inactive" and .data.read.policy.revision == $rev and .data.read.policy.epoch == $epoch and .data.liveAdmissions == 0' <<<"$STATUS" >/dev/null \
    || refuse "production must be Inactive at policy revision $PROD_REVISION / epoch $PROD_EPOCH with zero live admissions"
}
check_capacity() {  # REF:L223-L272: observed, never changed; read-only, never the CLI's refresh option
  local config_file gate_field capacity
  config_file="$WORKSPACE/config/arcadia.json"
  [[ -f "$config_file" ]] || refuse "the workspace config $config_file is missing, so the capacity gate state is unknown"
  gate_field="$(jq -c '.codingAgent // {} | if has("capacityGateEnabled") then .capacityGateEnabled else "absent" end' "$config_file")" || refuse "the workspace config is not readable JSON, so the capacity gate state is unknown"
  [[ "$gate_field" != false ]] || refuse "the capacity gate is OFF: the workspace config sets codingAgent.capacityGateEnabled: false; press $GATE_CARD_ID first, then press this Grant"
  [[ "$gate_field" == '"absent"' || "$gate_field" == true ]] || refuse "the workspace config has an unexpected codingAgent.capacityGateEnabled value: $gate_field"
  rec capacityGateConfigField "$gate_field"
  capacity="$(arcadia production capacity --json)" || refuse "the capacity read failed"
  printf '%s\n' "$capacity" > "$RUN_DIR/capacity-$PHASE.json"
  jq -e --arg p "$PROVIDER" '.ok == true and ([.data.observation.providers[] | select(.providerId == $p)] | length) == 1' <<<"$capacity" >/dev/null || refuse "the capacity read has no single $PROVIDER observation"
  rec capacityObserved "$(jq -c --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | {admitted, code, source: .receipt.source, reason}][0]' <<<"$capacity")"
  if jq -e --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | .receipt.source] == ["operator_config"]' <<<"$capacity" >/dev/null; then
    refuse "the capacity read still reports $PROVIDER as unmetered by workspace configuration (the capacity gate is off); press $GATE_CARD_ID first"
  fi
  jq -e --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | (.admitted == true or .code == "capacity_stale")] == [true]' <<<"$capacity" >/dev/null \
    || refuse "the capacity read refuses $PROVIDER for a reason a read-only refresh will not clear: $(jq -c --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | {admitted, code, reason}]' <<<"$capacity")"
  CAPACITY_GATE="on: $PROVIDER $(jq -r --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | if .admitted then "admitted" else "stale (the worker refreshes it read-only before admission)" end][0]' <<<"$capacity") by the capacity read (source $(jq -r --arg p "$PROVIDER" '[.data.observation.providers[] | select(.providerId == $p) | .receipt.source][0] // "unknown"' <<<"$capacity"))"
  rec_str capacityGate "$CAPACITY_GATE"
}
check_queue() {  # REF:L286-L289, L359-L360. $1 = "before" or "after" the optional Plan activation
  local queue
  queue="$(arcadia advance queue --json)" || refuse "the queue could not be read"
  printf '%s\n' "$queue" > "$RUN_DIR/queue-$PHASE.json"
  jq -e '.ok == true and .data.orderValid == true and .data.unpositionedCount == 0' <<<"$queue" >/dev/null || refuse "the queue is unreadable, invalid or has unpositioned Actions"
  QUEUE_REVISION_OBSERVED="$(jq -r '.data.revision' <<<"$queue")"
  [[ "$QUEUE_REVISION_OBSERVED" =~ ^[0-9]+$ ]] || refuse "the queue gave no numeric revision"
  if [[ "$1" == before && "$NEEDS_ACTIVATION" == true ]]; then
    # The Plan is still a draft: its Actions are not queued until P5. Only the pinned revision can be judged now.
    (( QUEUE_REVISION_OBSERVED == QUEUE_REVISION )) || refuse "queue revision changed from the reviewed $QUEUE_REVISION to $QUEUE_REVISION_OBSERVED"
  else
    if [[ "$1" == after && "$NEEDS_ACTIVATION" == true ]]; then
      (( QUEUE_REVISION_OBSERVED >= QUEUE_REVISION )) || refuse "queue revision $QUEUE_REVISION_OBSERVED is older than the reviewed $QUEUE_REVISION"
    else
      (( QUEUE_REVISION_OBSERVED == QUEUE_REVISION )) || refuse "queue revision changed from the reviewed $QUEUE_REVISION to $QUEUE_REVISION_OBSERVED"
    fi
    jq -e --argjson actions "$SCOPED_ACTIONS_JSON" --argjson n "$N" '[.data.ordered[0:$n][] | .orderKey] == $actions' <<<"$queue" >/dev/null || refuse "the exact contiguous pinned Actions are not at the top of the queue in the pinned order"
  fi
  rec queueRevisionObserved "$QUEUE_REVISION_OBSERVED"
}
read_worker_binding() {  # REF:L236-L250, but every value is read live, never pinned
  node -e '
const fs=require("fs"),p=require("path"),c=require("crypto"),ws=process.argv[1];
const h=JSON.parse(fs.readFileSync(p.join(ws,".arcadia/worker-claude-usage-heartbeat.json")));
const own=JSON.parse(fs.readFileSync(p.join(ws,".arcadia/worker.pid")));
process.stdout.write(JSON.stringify({heartbeatAt:h.at,ageMs:Date.now()-h.at,binding:h.binding,workerPid:own.pid,ownerSha256:c.createHash("sha256").update(String(own.owner)).digest("hex")}));
' "$WORKSPACE"
}
check_runtime_current() {  # Decision 0156: the reviewed-revision pin, checked by `production runtime-check`
  local out
  out="$(arcadia production runtime-check --repository "$ARCADIA_REPO" --json)" || refuse "production runtime-check failed to run"
  printf '%s\n' "$out" > "$RUN_DIR/runtime-check-$PHASE.json"
  jq -e '.ok == true and .data.current == true' <<<"$out" >/dev/null || refuse "the installed runtime is not current against the checkout: $(jq -c '.data.reasons // .error' <<<"$out")"
  rec runtimeCheck "$(jq -c '.data' <<<"$out")"
}

# ---------------------------------------------------------------------------------------------------------------
# P0 context
# ---------------------------------------------------------------------------------------------------------------
phase_p0() {
  local tool
  phase P0 context
  if [[ "$MODE" == run ]]; then  # REF:L151-L153
    [[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$ID" && -n "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" && -f "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" ]] || refuse "launch this Grant through the /actions operator-action library"
    [[ "$(cd "$(dirname "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR")" && pwd -P)/$(basename "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR")" == "$DESCRIPTOR" ]] || refuse "the launching descriptor is not this Grant's descriptor"
    [[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only Grant: an agent sandbox may not run it"
  fi
  # A set API key can bill paid API usage instead of the Claude subscription; its value is never read.  REF:L155
  [[ -z "${ANTHROPIC_API_KEY:-}" ]] || refuse "ANTHROPIC_API_KEY is set in this host environment, which can bill paid API usage; unset it (its value was not read)"
  [[ -z "${ARCADIA_WORKSPACE:-}" ]] || refuse "ARCADIA_WORKSPACE is set; the configured workspace must resolve on its own"  # ADOPT:L72
  for tool in git jq mise timeout node launchctl; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done  # REF:L159
  [[ "$(cd "$LIBRARY_DIR/../../.." && pwd -P)" == "$ARCADIA_REPO" ]] || refuse "this card does not live in the library of the checkout that holds this executor"
  jq -e '.schema == "arcadia-operator-script-v1" and .kind == "grant" and (.startRun.schema == "arcadia-start-run-v1")' "$DESCRIPTOR" >/dev/null || refuse "the descriptor is not a START grant with a startRun block"
  check_preserved_history
  # Hashes are pinned in the independent final review's host-local manifest: the card pair and this executor.  REF:L161
  check_reviewed_hashes
  [[ "$(sha256_file "$SELF")" == "$EXECUTOR_SHA" ]] || refuse "this executor is not the one the card pins (startRun.executorSha256)"
  [[ ! -e "$ATTEMPT_FILE" ]] || refuse "the one-shot START allowance is consumed; never retry or reset"  # REF:L162
  check_expiry "this card expired at $CARD_EXPIRES_AT; ask for a fresh card"
  rec_str cardExpiresAt "$CARD_EXPIRES_AT"
  rec_str reviewedRevision "$PIN"
  rec_str executorSha256 "$EXECUTOR_SHA"
}

# ---------------------------------------------------------------------------------------------------------------
# P1 repo
# ---------------------------------------------------------------------------------------------------------------
phase_p1() {
  local decision file content tree head_now plan_fm project_fm previous
  phase P1 repo
  check_checkout_clean_on_main
  check_origin_is_pin
  if ! git_repo cat-file -e "$PIN^{commit}" 2>/dev/null; then
    if [[ "$MODE" == run ]]; then
      # N2 (deliberate): the fetch happens before the allowance is consumed. Only objects and remote-tracking refs change; the working tree and HEAD do not. It is not a mutation the allowance covers.
      timeout 120 git -C "$ARCADIA_REPO" fetch origin main || refuse "the reviewed revision $PIN is not present locally and could not be fetched"
    else
      refuse "the reviewed revision $PIN is not present locally; fetch origin in the checkout (git fetch origin main) and run preflight again"
    fi
    git_repo cat-file -e "$PIN^{commit}" 2>/dev/null || refuse "the reviewed revision $PIN is still not present locally after the fetch"
  fi
  HEAD_BEFORE="$(git_repo rev-parse HEAD)"
  rec_str headBefore "$HEAD_BEFORE"
  if [[ "$HEAD_BEFORE" != "$PIN" ]]; then  # ff-only: HEAD must be an ancestor of the pin; never diverged, never ahead
    git_repo merge-base --is-ancestor "$HEAD_BEFORE" "$PIN" || refuse "local main $HEAD_BEFORE is diverged from, or ahead of, the reviewed revision $PIN; the card fast-forwards only"
  fi
  # The executor on disk is hash-checked in P0; it must also be the one at the pin, or P3's fast-forward would swap it.
  [[ "$(git_repo show "$PIN:$EXECUTOR_REL" | sha256_stdin)" == "$EXECUTOR_SHA" ]] || refuse "scripts/start-run.sh at the reviewed revision is not the pinned executor"
  tree="$(git_repo ls-tree --name-only "$PIN" docs/decisions/)" || refuse "docs/decisions cannot be listed at $PIN"
  for decision in $(jq -r '.startRun.requiredDecisions[]' "$DESCRIPTOR"); do  # REF:L197-L202, read at the pin
    file="$(grep -E -m1 "^docs/decisions/$decision-.*\.md$" <<<"$tree" || true)"
    [[ -n "$file" ]] || refuse "Decision $decision is not in docs/decisions/$decision-*.md at $PIN"
    content="$(git_repo show "$PIN:$file")"
    grep -q '^status: approved$' <<<"$content" || refuse "Decision $decision is not approved"
    grep -Eq '^answer: .+' <<<"$content" || refuse "Decision $decision has no recorded answer"
  done
  for file in $(jq -r '.startRun.requiredFiles[]' "$DESCRIPTOR"); do  # REF:L206-L208
    git_repo cat-file -e "$PIN:$file" 2>/dev/null || refuse "$file is missing at the reviewed revision $PIN; merge it and ask for a fresh card"
  done
  git_repo cat-file -e "$PIN:docs/plans/$PLAN.md" 2>/dev/null || refuse "the Plan file docs/plans/$PLAN.md is missing at $PIN"  # REF:L203
  plan_fm="$(git_repo show "$PIN:docs/plans/$PLAN.md" | frontmatter_json)" || refuse "the Plan frontmatter could not be read at $PIN"
  project_fm="$(git_repo show "$PIN:PROJECT.md" | frontmatter_json)" || refuse "PROJECT.md frontmatter could not be read at $PIN"
  # REF:L165-L178: every pinned Action must still be open; none narrowed, none outside the pin.
  jq -e --argjson pinned "$ACTION_IDS_JSON" '[.actions[]? | select(.id as $i | $pinned | index($i) != null) | .status] as $s | ($s | length) == ($pinned | length) and all($s[]; . != "done")' <<<"$plan_fm" >/dev/null \
    || refuse "all exact pinned Actions must be in the Plan and still open; no narrowed or repeated START"
  case "$(jq -r '.status' <<<"$plan_fm")" in
    active)  # REF:L204 (+ the Project pointer)
      NEEDS_ACTIVATION=false
      [[ "$(jq -r '.active_plan // ""' <<<"$project_fm")" == "$PLAN" ]] || refuse "the Plan $PLAN is active but PROJECT.md does not point at it"
      ;;
    draft)  # Decision 0157: Plan is active, or activated by this card in this run
      jq -e '.planActivation != null' "$DESCRIPTOR" >/dev/null || refuse "the Plan $PLAN is not active and this card carries no planActivation block"
      previous="$(jq -r '.planActivation.envelope.previousPlan' "$DESCRIPTOR")"
      [[ "$(jq -r '.active_plan // ""' <<<"$project_fm")" == "$previous" ]] || refuse "the Plan is a draft but PROJECT.md does not point at the pinned previous Plan $previous"
      git_repo show "$PIN:docs/plans/$previous.md" | frontmatter_json | jq -e '.status == "active"' >/dev/null || refuse "the pinned previous Plan $previous is not active"
      NEEDS_ACTIVATION=true
      ;;
    *) refuse "the Plan $PLAN is neither active nor a draft awaiting its pinned activation" ;;
  esac
  rec needsPlanActivation "$NEEDS_ACTIVATION"
  # REF:L189-L190
  WORKSPACE="$(arcadia workspace resolve --json | jq -er '.data | select(.source == "user config") | .workspacePath')" || refuse "the configured default workspace did not resolve"
  [[ "${WORKSPACE##*/}" == "$WORKSPACE_NAME" ]] || refuse "the configured default workspace is not $WORKSPACE_NAME"
  rec_str workspace "$WORKSPACE"
  head_now="$(git_repo rev-parse HEAD)"
  rec_str arcadiaHead "$head_now"
}

# ---------------------------------------------------------------------------------------------------------------
# P2 state
# ---------------------------------------------------------------------------------------------------------------
phase_p2() {
  local tmux_sessions freeze
  phase P2 state
  check_production_off
  rec policyRevisionBefore "$PROD_REVISION"
  # ADOPT:L99-L102 (no competing Session) and the plist/PID facts the restart needs.
  tmux_sessions="$(tmux ls 2>/dev/null || true)"
  [[ -z "$tmux_sessions" ]] || refuse "a tmux server with live sessions exists; no competing Session may run"
  [[ -f "$HOME/Library/LaunchAgents/$WORKER_LABEL.plist" ]] || refuse "worker launch agent $HOME/Library/LaunchAgents/$WORKER_LABEL.plist is missing"  # ADOPT:L96
  OLD_PID="$(worker_pid)"
  [[ -n "$OLD_PID" ]] || refuse "worker job $WORKER_LABEL has no running PID"  # ADOPT:L98
  rec oldWorkerPid "$OLD_PID"
  # REF:L236-L250: the pre-restart worker is live and fresh; its handler is what the retained sign-in evidence must name.
  PRE_BINDING="$(read_worker_binding)" || refuse "the pre-restart worker binding could not be read"
  jq -e --argjson fresh "$HEARTBEAT_FRESH_MS" --argjson pid "$OLD_PID" '.ageMs >= 0 and .ageMs < $fresh and .binding.pid == $pid and .workerPid == $pid' <<<"$PRE_BINDING" >/dev/null || refuse "stale or mismatched pre-restart worker heartbeat"
  PRE_HANDLER="$(jq -r '.binding.handlerHash' <<<"$PRE_BINDING")"
  rec_str preRestartHandlerHash "$PRE_HANDLER"
  check_signin_evidence "$PRE_HANDLER"
  check_capacity
  check_queue before
  # Decision 0156: ensure refuses during a rehearsal freeze; ask first (read-only).
  freeze="$(arcadia production freeze-check go-broker.ensure --json)" || refuse "the rehearsal freeze window refuses go-broker ensure (or the freeze check could not run)"
  jq -e '.ok == true and .data.decision == "allowed"' <<<"$freeze" >/dev/null || refuse "the rehearsal freeze check did not allow go-broker ensure"
  rec freezeCheck "$(jq -c '.data | {state, decision, policyRevision, policyEpoch}' <<<"$freeze")"
}

# ---------------------------------------------------------------------------------------------------------------
# P3 consume and fast-forward
# ---------------------------------------------------------------------------------------------------------------
phase_p3() {
  phase P3 consume_and_fast_forward
  # Last pre-mutation re-check: the cheap gates whose answer can change while the preflight ran.
  check_expiry "START card expired during preflight; no allowance consumed"  # REF:L362
  check_preserved_history
  check_signin_evidence "$PRE_HANDLER"
  [[ ! -e "$ATTEMPT_FILE" ]] || refuse "the one-shot START allowance is consumed; never retry or reset"
  check_checkout_clean_on_main
  check_origin_is_pin
  [[ "$(git_repo rev-parse HEAD)" == "$HEAD_BEFORE" ]] || refuse "main moved between the preconditions and the allowance"
  # REF:L366: exclusive creation (wx) and fsync; ANY later failure keeps this consumed.
  node -e 'const fs=require("fs"),p=require("path"),[file,id,run,pinSha,head]=process.argv.slice(1);const fd=fs.openSync(file,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify({state:"CONSUMED",at:new Date().toISOString(),requestId:id,runId:run,reviewedRevision:pinSha,headBefore:head,policyRevision:Number(process.env.START_RUN_POLICY_REVISION)})+"\n");fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const d=fs.openSync(p.dirname(file),"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}' \
    "$ATTEMPT_FILE" "$ID" "$RUN_ID" "$PIN" "$HEAD_BEFORE" || refuse "could not exclusively consume the START allowance; nothing was changed"
  CONSUMED=true
  mutated "one-shot START allowance consumed: $ATTEMPT_FILE"
  checkpoint
  if [[ "$HEAD_BEFORE" != "$PIN" ]]; then  # ADOPT:L112-L116
    echo "==> Fast-forwarding clean local main $HEAD_BEFORE -> $PIN (ff-only, no merge commit)"
    mutated "fast-forward of the main checkout $HEAD_BEFORE -> $PIN attempted (ff-only)"
    git_repo merge --ff-only "$PIN"
  fi
  FF_DONE=true
  checkpoint
  [[ "$(git_repo rev-parse HEAD)" == "$PIN" ]] || refuse "main is not at the reviewed revision $PIN after the fast-forward"
  [[ -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main checkout has changes after the fast-forward"
  [[ "$(sha256_file "$SELF")" == "$EXECUTOR_SHA" ]] || refuse "the executor changed on disk during the fast-forward"
}

# ---------------------------------------------------------------------------------------------------------------
# P4 install, restart, observe and bind the worker
# ---------------------------------------------------------------------------------------------------------------
phase_p4() {
  local ensure broker restart_at_ms new_pid i ready binding
  phase P4 install_and_worker
  ENSURE_ATTEMPTED=true
  mutated "go-broker ensure attempted: installs the pinned revision $PIN unless the ready installed broker already equals it; the runtime stays upgraded, there is no rollback"
  checkpoint
  ensure="$(arcadia_t "$INSTALL_TIMEOUT_SECONDS" go-broker ensure --json)" || refuse "go-broker ensure failed; no worker restart was attempted and the worker was not touched; production stays Off"
  printf '%s\n' "$ensure" > "$RUN_DIR/ensure.json"
  jq -e '.ok == true' <<<"$ensure" >/dev/null || refuse "go-broker ensure did not report success; no worker restart was attempted"
  rec ensureAction "$(jq -c '.data.action' <<<"$ensure")"
  broker="$(arcadia go-broker status --json)" || refuse "go-broker status is not ready after ensure; no worker restart was attempted"
  printf '%s\n' "$broker" > "$RUN_DIR/broker-status-after-ensure.json"
  jq -e --arg pin "$PIN" '.ok == true and .data.ready == true and .data.revision == $pin' <<<"$broker" >/dev/null || refuse "the installed broker is not the reviewed revision $PIN and ready; no worker restart was attempted"
  [[ "$(git_repo rev-parse HEAD)" == "$PIN" && -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main checkout moved or changed during the install; no worker restart was attempted"
  check_production_off  # ADOPT:L124
  # Only now restart the pinned worker label (ADOPT:L126-L137).
  echo "==> Restarting only $WORKER_LABEL through launchd"
  restart_at_ms="$(( $(date +%s) * 1000 ))"
  RESTART_ATTEMPTED=true
  mutated "worker $WORKER_LABEL restart attempted (launchctl kickstart -k; old pid $OLD_PID)"
  checkpoint
  launchctl kickstart -k "gui/$(id -u)/$WORKER_LABEL"
  new_pid=""
  for _ in $(seq 1 "$WORKER_WAIT_SECONDS"); do
    new_pid="$(worker_pid)"
    if [[ -n "$new_pid" && "$new_pid" != "$OLD_PID" ]]; then break; fi
    sleep 1
  done
  [[ -n "$new_pid" && "$new_pid" != "$OLD_PID" ]] || refuse "worker did not come back with a new PID within ${WORKER_WAIT_SECONDS}s"
  NEW_PID="$new_pid"
  rec newWorkerPid "$NEW_PID"
  # ADOPT:L139-L157 plus REF:L236-L250: a fresh heartbeat after the restart, read live, bound to the new pid and release.
  ready=false
  for i in $(seq 1 "$(( TRANSPORT_WAIT_SECONDS / 2 ))"); do
    if binding="$(read_worker_binding 2>/dev/null)" \
      && broker="$(arcadia go-broker status --json 2>/dev/null)" \
      && jq -e --argjson t0 "$restart_at_ms" --argjson pid "$NEW_PID" --arg pin "$PIN" --arg repo "$ARCADIA_REPO" --argjson fresh "$HEARTBEAT_FRESH_MS" \
        '.heartbeatAt > $t0 and .ageMs >= 0 and .ageMs < $fresh and .binding.pid == $pid and .workerPid == $pid and .binding.release == $pin and .binding.repository == $repo' <<<"$binding" >/dev/null \
      && jq -e '.ok == true and .data.ready == true and .data.preservationTransport.ready == true and .data.agentGoTransport.ready == true' <<<"$broker" >/dev/null; then
      ready=true; break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || refuse "no fresh worker heartbeat bound to the new pid $NEW_PID and release $PIN with ready transports within ${TRANSPORT_WAIT_SECONDS}s"
  kill -0 "$NEW_PID" 2>/dev/null || refuse "the new worker process $NEW_PID is not alive"
  [[ "$(worker_pid)" == "$NEW_PID" ]] || refuse "worker PID changed again after the restart"
  jq -n --argjson b "$binding" --argjson oldPid "$OLD_PID" --argjson restartAtMs "$restart_at_ms" --arg label "$WORKER_LABEL" --arg observed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '$b + {oldPid: $oldPid, restartAtMs: $restartAtMs, workerLabel: $label, observedAt: $observed}' > "$RUN_DIR/worker-binding.json"
  # The handler may legitimately change at the restart: bind the new one live and record both.
  rec_str postRestartHandlerHash "$(jq -r '.binding.handlerHash' "$RUN_DIR/worker-binding.json")"
  rec workerBinding "$(jq -c '{pid: .binding.pid, instance: .binding.instance, release: .binding.release, handlerHash: .binding.handlerHash, repository: .binding.repository, heartbeatAt}' "$RUN_DIR/worker-binding.json")"
  [[ "$(git_repo rev-parse HEAD)" == "$PIN" && -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main checkout moved or changed after the worker restart; the loaded revision is unknown"
  check_runtime_current
  check_production_off
}

# ---------------------------------------------------------------------------------------------------------------
# P5 Plan activation (Decision 0157)
# ---------------------------------------------------------------------------------------------------------------
phase_p5() {
  local out head_now plan_after
  phase P5 plan_activation
  if [[ "$NEEDS_ACTIVATION" != true ]]; then
    rec_str planActivation "skipped: the Plan was already active at the reviewed revision"
    return 0
  fi
  [[ "$(git_repo rev-parse HEAD)" == "$PIN" && -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main moved or became dirty before the Plan activation"
  check_reviewed_hashes  # the descriptor the runner will read is still the reviewed one
  PLAN_ACTIVATION_ATTEMPTED=true
  mutated "Plan activation runner invoked for $PROJECT/$PLAN (replay-safe; this card's START marker is the only allowance; the Plan stays active if it succeeds; no automatic deactivation)"
  checkpoint
  out="$(timeout "$ACTIVATION_RUNNER_TIMEOUT_SECONDS" mise exec -- node "$ARCADIA_REPO/scripts/run-plan-amendment.mjs" "$DESCRIPTOR" run)" || { printf '%s\n' "$out" > "$RUN_DIR/plan-activation.json"; refuse "the Plan-activation runner failed: $(jq -r '[.reason, .message] | join(": ")' <<<"$out" 2>/dev/null || echo 'no receipt')"; }
  printf '%s\n' "$out" > "$RUN_DIR/plan-activation.json"
  jq -e '.status == "succeeded"' <<<"$out" >/dev/null || refuse "the Plan-activation runner did not succeed: $(jq -r '[.reason, .message] | join(": ")' <<<"$out" 2>/dev/null || echo 'unreadable receipt')"
  PLAN_ACTIVATED=true
  rec planActivationReceipt "$(jq -c '{status, reason, runDirectory}' <<<"$out")"
  # Afterwards: the Plan is active, production is still Off, and the runtime is still current (a docs-only commit).
  git_repo merge-base --is-ancestor "$PIN" HEAD || refuse "main no longer descends from the reviewed revision after the Plan activation"
  [[ -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main checkout has changes after the Plan activation"
  plan_after="$(frontmatter_json < "$ARCADIA_REPO/docs/plans/$PLAN.md")" || refuse "the Plan frontmatter could not be read after the activation"
  jq -e '.status == "active"' <<<"$plan_after" >/dev/null || refuse "the Plan $PLAN is not active after the activation"
  check_production_off
  check_runtime_current
  head_now="$(git_repo rev-parse HEAD)"
  rec_str arcadiaHeadAfterPlanActivation "$head_now"
}

# ---------------------------------------------------------------------------------------------------------------
# P6 the retained START tail
# ---------------------------------------------------------------------------------------------------------------
phase_p6() {
  local expires args_ok preview recheck fingerprint head_now binding bound activation action_list first_queue_revision
  phase P6 start
  head_now="$(git_repo rev-parse HEAD)"
  git_repo merge-base --is-ancestor "$PIN" "$head_now" || refuse "main does not descend from the reviewed revision"
  [[ -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main checkout is dirty before the START"
  check_runtime_current
  check_signin_evidence ""  # REF:L245-L248, L364 again at the START: expiry, windows and receipt hashes (the handler legitimately changed at the restart)
  check_production_off  # REF:L274-L284 (fresh)
  check_capacity        # REF:L254-L272 (fresh)
  check_queue after     # REF:L286-L289 (fresh)
  first_queue_revision="$QUEUE_REVISION_OBSERVED"
  # The worker recorded in P4 must still be the live worker (REF:L361): pid, instance and handler read live, compared with the record.
  bound="$(cat "$RUN_DIR/worker-binding.json")"
  binding="$(read_worker_binding)" || refuse "the worker binding could not be read live"
  jq -e --argjson fresh "$HEARTBEAT_FRESH_MS" --argjson b "$bound" '.ageMs >= 0 and .ageMs < $fresh and .binding.pid == $b.binding.pid and .binding.instance == $b.binding.instance and .binding.handlerHash == $b.binding.handlerHash and .binding.release == $b.binding.release and .workerPid == $b.binding.pid and .ownerSha256 == $b.ownerSha256' <<<"$binding" >/dev/null \
    || refuse "the worker changed or its heartbeat went stale after the restart; no activation"
  # REF:L291-L299
  expires="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 3600e3).toISOString())' "$PACKET_APPROVAL_HOURS")"
  ARGS=(--project "$PROJECT" --plan "$PROJECT/$PLAN")
  while IFS= read -r scoped; do ARGS+=(--action "$scoped"); done <<<"$(jq -r '.[]' <<<"$SCOPED_ACTIONS_JSON")"
  ARGS+=(--provider "$PROVIDER" --concurrency 1 --transitions "$TRANSITIONS" --packet-approval-expires-at "$expires" --remote-preservation --intent "$INTENT")
  ARGS+=(--integration-grant-decision "$INTEGRATION_DECISION" --integration-grant-expires-at "$expires" --integration-grant-merge-pull-request)
  args_ok=$(( 4 + 2 * N + 4 + 2 + 2 + 1 + 2 + 2 + 2 + 1 ))
  (( ${#ARGS[@]} == args_ok )) || refuse "the Grant arguments do not name exactly the $N pinned Actions"
  # REF:L301-L320: the expected fingerprint is derived from exactly the pinned scope and this press's expiry, in the canonical form of
  # fingerprintProductionScope (src/production/policy.ts); the preview must equal it, so no field outside the pin can ride along.
  EXPECTED_FINGERPRINT="$(node -e '
const [intent, project, plan, actions, provider, transitions, expiresAt, grantDecision] = process.argv.slice(1);
const canonical = JSON.stringify({
  intent, projects: [project], plans: [plan], actions: JSON.parse(actions), providers: [provider], maxConcurrentSessions: 1,
  mechanicalTransitions: [...new Set(transitions.split(","))].sort(), remotePreservation: true,
  integrationGrant: { decisionRef: grantDecision, expiresAt, actions: [], mergeThroughPullRequest: true },
  packetApprovalExpiresAt: expiresAt
});
process.stdout.write(require("crypto").createHash("sha256").update(canonical).digest("hex").slice(0, 32));
' "$INTENT" "$PROJECT" "$PROJECT/$PLAN" "$SCOPED_ACTIONS_JSON" "$PROVIDER" "$TRANSITIONS" "$expires" "$INTEGRATION_DECISION")"
  [[ "$EXPECTED_FINGERPRINT" =~ ^[0-9a-f]{32}$ ]] || refuse "the expected scope fingerprint could not be derived"
  rec_str expectedScopeFingerprint "$EXPECTED_FINGERPRINT"
  preview="$(arcadia production preview "${ARGS[@]}" --json)" || refuse "the production preview failed"
  printf '%s\n' "$preview" > "$RUN_DIR/preview.json"
  # REF:L323-L341, verbatim except that the pinned values are variables.
  jq -e --argjson rev "$PROD_REVISION" --arg p "$PROJECT" --arg plan "$PROJECT/$PLAN" --argjson actions "$SCOPED_ACTIONS_JSON" --arg provider "$PROVIDER" --arg e "$expires" --arg intent "$INTENT" --arg fp "$EXPECTED_FINGERPRINT" --arg grant "$INTEGRATION_DECISION" --argjson transitions "$TRANSITIONS_JSON" '
    def same_instant($x; $y): ($x | type == "string") and ($x | sub("\\.[0-9]+Z$"; "Z")) == ($y | sub("\\.[0-9]+Z$"; "Z"));
    def same_set($x; $y): ($x | type == "array") and ($x | length) == ($y | length) and ($x | unique | length) == ($x | length) and ($x | sort) == ($y | sort);
    .ok == true and .data.preview.expectedRevision == $rev
    and .data.preview.scope.intent == $intent
    and .data.preview.scope.projects == [$p] and .data.preview.scope.plans == [$plan]
    and same_set(.data.preview.scope.actions; $actions)
    and .data.preview.scope.providers == [$provider] and .data.preview.scope.maxConcurrentSessions == 1
    and (.data.preview.scope.mechanicalTransitions | sort) == ($transitions | sort)
    and same_instant(.data.preview.scope.packetApprovalExpiresAt; $e)
    and .data.preview.scope.remotePreservation == true
    and .data.preview.scope.integrationGrant == {decisionRef: $grant, expiresAt: $e, actions: [], mergeThroughPullRequest: true}
    and (.data.preview.scope.rehearsalException == null)
    and (.data.preview.unmatched.projects == []) and (.data.preview.unmatched.plans == [])
    and (.data.preview.scope.sessionTimeLimitMs == null) and (.data.preview.scope.sessionInputTokenCeiling == null)
    and ([.data.preview.orderedActions[]? | {actionKey, state}] == [$actions[] | {actionKey: ., state: "ready"}])
    and .data.preview.scopeFingerprint == $fp' <<<"$preview" >/dev/null \
    || refuse "preview differs from the exact $N-Action (all queued and ready, in order), one-provider, concurrency-one, remote-preservation scope with a $PACKET_APPROVAL_HOURS-hour packet-approval delegation and a Decision $INTEGRATION_DECISION integration grant with the worker pull-request merge opt-in"
  fingerprint="$(jq -r '.data.preview.scopeFingerprint' <<<"$preview")"
  rec_str scopeFingerprint "$fingerprint"
  rec_str packetApprovalExpiresAt "$expires"
  # REF:L346-L357: `production activate` recomputes its scope and has no expected-fingerprint option, so preview again immediately
  # before activating and require the identical fingerprint and revision.
  phase P6 start_recheck
  [[ "$(git_repo rev-parse HEAD)" == "$head_now" && -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main moved or became dirty between the preconditions and activation"
  node -e 'const left = Date.parse(process.argv[1]) - Date.now(), full = Number(process.argv[2]) * 3600e3; process.exit(left > full - 300e3 && left <= full ? 0 : 1)' "$expires" "$PACKET_APPROVAL_HOURS" \
    || refuse "the packet-approval expiry $expires is no longer within five minutes of $PACKET_APPROVAL_HOURS hours from now"
  recheck="$(arcadia production preview "${ARGS[@]}" --json)" || refuse "the production preview recheck failed"
  printf '%s\n' "$recheck" > "$RUN_DIR/preview-recheck.json"
  jq -e --arg f "$fingerprint" --argjson rev "$PROD_REVISION" --argjson n "$N" '.ok == true and .data.preview.scopeFingerprint == $f and .data.preview.expectedRevision == $rev and ([.data.preview.orderedActions[]? | .state] == [range($n) | "ready"])' <<<"$recheck" >/dev/null \
    || refuse "the scope fingerprint or policy revision changed between preview and activation"
  check_queue after
  [[ "$QUEUE_REVISION_OBSERVED" == "$first_queue_revision" ]] || refuse "queue moved after preview; no activation"  # REF:L360
  binding="$(read_worker_binding)" || refuse "the worker binding could not be read live after the preview"
  jq -e --argjson fresh "$HEARTBEAT_FRESH_MS" --argjson b "$bound" '.ageMs >= 0 and .ageMs < $fresh and .binding.pid == $b.binding.pid and .binding.instance == $b.binding.instance and .binding.handlerHash == $b.binding.handlerHash and .workerPid == $b.binding.pid and .ownerSha256 == $b.ownerSha256' <<<"$binding" >/dev/null || refuse "worker changed after preview; no activation"
  check_expiry "START card expired during preflight; no activation"
  check_runtime_current
  # REF:L367-L374. The allowance was consumed at the first mutation (P3); an uncertain or failed activation never resets it.
  phase P6 activate
  ACTIVATION_ATTEMPTED=true
  mutated "production activate attempted for the previewed scope (fingerprint $fingerprint); a failure returns only this Grant to Off"
  checkpoint
  activation="$(arcadia production activate "${ARGS[@]}" --expected-revision "$PROD_REVISION" --request-id "$ID" --granted-by "$GRANTED_BY" --decision "$SPEND_DECISION" --require-current-runtime --repository "$ARCADIA_REPO" --json)" || refuse "the activate command failed or timed out; its outcome is read back from production status"
  printf '%s\n' "$activation" > "$RUN_DIR/activation.json"
  if jq -e '.ok == true and .data.result.policy.desiredState == "active"' <<<"$activation" >/dev/null 2>&1; then ACTIVATED=true; fi
  [[ "$ACTIVATED" == true ]] || refuse "activation output did not confirm Active; its outcome is read back from production status"
  jq -e --arg id "$ID" --arg f "$fingerprint" '.data.result.policy.authority.requestId == $id and .data.result.policy.authority.scopeFingerprint == $f' <<<"$activation" >/dev/null || refuse "the active policy is not the previewed fingerprint"
  rec policyRevisionAfter "$(jq '.data.result.policy.revision' <<<"$activation")"
  phase P6 complete
  REASON=""
  action_list="$(jq -r 'join(", ")' <<<"$ACTION_IDS_JSON")"
  rec_str authorizes "Only the previewed scope: Project $PROJECT, Plan $PLAN, the $N Actions $action_list; provider $PROVIDER; concurrency 1; mechanics $TRANSITIONS; approving the build packet of each of those Actions until $expires (Decision 0072); remote preservation; and until $expires a Decision $INTEGRATION_DECISION candidate-integration grant for exactly those Actions with the Decision 0097 worker pull-request merge, only at the exact reviewed head, checks green, merge state CLEAN, not authority-adjacent. The policy itself has no expiry: it ends when the Actions finish or when the STOP button ($OFF_ID) is pressed."
  rec_str neverAuthorizes "Merging an authority-adjacent pull request, a merge at any head other than the reviewed one, a merge after $expires, another Project, Plan, Action or provider, concurrency above one, a Session launched by this script, or reactivation after Off."
  write_receipt succeeded
  write_handoff succeeded
  {
    echo "# START run receipt"
    echo
    echo "- request id: $ID"
    echo "- scope: $PROJECT/$PLAN, $N Actions (queued and ready at grant time, in this order): $action_list"
    echo "- provider $PROVIDER; concurrency 1; mechanics $TRANSITIONS; remote preservation: on"
    echo "- packet_approval delegation and integration grant expire: $expires"
    echo "- reviewed revision installed: $PIN; worker pid $NEW_PID; Plan activated by this card: $PLAN_ACTIVATED"
    echo "- policy revision before: $PROD_REVISION; scope fingerprint: $fingerprint (previewed twice, verified after activation)"
    echo "- STOP button: $OFF_ID"
    echo "- run log: $LOG"
  } > "$RUN_DIR/receipt.md"
  echo "START GRANTED: exact $N-Action scope only. This one-shot allowance is consumed forever. Receipt: $RUN_DIR/receipt.md"
}

# ---------------------------------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------------------------------
main() {
  MODE="${1:-}"
  local descriptor_arg="${2:-}"
  case "$MODE" in run | preflight | --describe) ;; *) echo "usage: $0 run|preflight|--describe <descriptor.json>" >&2; return 2 ;; esac
  [[ -n "$descriptor_arg" && -f "$descriptor_arg" ]] || { echo "usage: $0 $MODE <descriptor.json> (descriptor not found)" >&2; return 2; }
  command -v jq >/dev/null || { echo "jq is required on PATH" >&2; return 2; }
  DESCRIPTOR="$(cd "$(dirname "$descriptor_arg")" && pwd -P)/$(basename "$descriptor_arg")"
  if [[ "$MODE" == --describe ]]; then cat "$DESCRIPTOR"; return 0; fi
  LIBRARY_DIR="$(dirname "$DESCRIPTOR")"
  ID="$(jq -er '.id' "$DESCRIPTOR")" || { echo "the descriptor has no id" >&2; return 2; }
  [[ "$(basename "$DESCRIPTOR")" == "$ID.json" && "$(jq -r '.script' "$DESCRIPTOR")" == "$ID.sh" ]] || { echo "the descriptor does not match its library entry" >&2; return 2; }

  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  RUN_DIR="$LIBRARY_DIR/runs/$ID/$RUN_ID"
  LOG="$RUN_DIR/run.log"
  HANDOFF="$RUN_DIR/failure-handoff.md"
  RECEIPT="$RUN_DIR/receipt.json"
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ATTEMPT_FILE="$LIBRARY_DIR/$ID.consumed.json"
  mkdir -p "$RUN_DIR"
  # The phases run as a background stage whose output goes through a FIFO into tee -a run.log (no process substitution, so it also
  # works in a sandbox). The stage sets its own traps.
  # N1: a TERM or INT sent to this process is forwarded to the stage, whose own handler reconciles any activation attempt (returns
  # only this Grant to Off) before exiting; this process then waits for the stage to finish and returns the stage's status.
  trap - ERR
  mkfifo "$RUN_DIR/.out"
  tee -a "$LOG" < "$RUN_DIR/.out" &
  local tee_pid=$!
  run_phases > "$RUN_DIR/.out" 2>&1 &
  local stage=$!
  trap 'kill -TERM "$stage" 2>/dev/null || true' TERM INT
  local code=0
  while :; do
    code=0
    wait "$stage" || code=$?
    kill -0 "$stage" 2>/dev/null || break
  done
  trap - TERM INT
  wait "$tee_pid" 2>/dev/null || true
  rm -f "$RUN_DIR/.out"
  return "$code"
}

run_phases() {
  BASE_SUBSHELL="$BASH_SUBSHELL"
  trap on_error ERR
  trap on_signal TERM INT

  # Read every pin. Nothing run-specific lives in this file.
  PIN="$(pin reviewedRevision)"; EXECUTOR_SHA="$(pin executorSha256)"
  WORKSPACE_NAME="$(pin workspace)"; PROJECT="$(pin project)"; PLAN="$(pin plan)"; PROVIDER="$(pin provider)"
  ACTION_IDS_JSON="$(pin_json actions)"; N="$(jq 'length' <<<"$ACTION_IDS_JSON")"
  SCOPED_ACTIONS_JSON="$(jq -c --arg p "$PROJECT" '[.[] | "\($p)/\(.)"]' <<<"$ACTION_IDS_JSON")"
  TRANSITIONS_JSON="$(pin_json transitions)"; TRANSITIONS="$(jq -r 'join(",")' <<<"$TRANSITIONS_JSON")"
  PACKET_APPROVAL_HOURS="$(pin packetApprovalHours)"; INTENT="$(pin intent)"
  SPEND_DECISION="$(pin spendDecision)"; INTEGRATION_DECISION="$(pin integrationDecision)"
  PROD_REVISION="$(pin production.revision)"; PROD_EPOCH="$(pin production.epoch)"; QUEUE_REVISION="$(pin queueRevision)"
  WORKER_LABEL="$(pin workerLabel)"; GATE_CARD_ID="$(pin gateCardId)"; OFF_ID="$(pin offId)"; GRANTED_BY="$(pin grantedBy)"
  CARD_EXPIRES_AT="$(jq -er '.expires_at' "$DESCRIPTOR")"
  export START_RUN_POLICY_REVISION="$PROD_REVISION"
  rec_str id "$ID"; rec_str project "$PROJECT"; rec_str plan "$PLAN"; rec_str provider "$PROVIDER"
  rec actionIds "$ACTION_IDS_JSON"; rec_str transitions "$TRANSITIONS"

  echo "== START run executor: $ID ($MODE) =="
  phase_p0
  phase_p1
  phase_p2
  if [[ "$MODE" == preflight ]]; then
    PHASE="P2"; PHASE_NAME="state"; REASON=""
    write_receipt preflight_ok
    write_handoff preflight_ok
    echo "PREFLIGHT OK: nothing was consumed or changed. Receipt: $RECEIPT"
    return 0
  fi
  phase_p3
  phase_p4
  phase_p5
  phase_p6
  return 0
}
main "$@"; exit $?
