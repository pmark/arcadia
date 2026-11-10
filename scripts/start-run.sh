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
#   P4 install   go-broker ensure; verify; only then reinstall the pinned worker label from the pinned compiled release
#                (protected) and restart it; observe and bind the new worker; then (Decision 0161) the sign-in sequence:
#                reuse a fresh receipt of this bound worker, or claim this press's own sequence record (Decision 0162: no
#                calendar-day ceiling, only no overlap with an in-flight sequence), renew once and
#                have the bound worker check usage once
#   P5 plan      activate the pinned Plan through the shared planActivation runner (only when the Plan is a draft)
#   P6 start     the retained START tail: fresh capacity/queue, scope previewed twice, `production activate`, verification
#
# Gate lineage. "REF:Ln" cites a line of the reviewed reference card start-fixed-three-claude-actions-20261026.sh and
# "ADOPT:Ln" of adopt-go-1921-runtime-off-20261031.sh; a gate lifted verbatim keeps its message. The gates replaced are
# REF:L193 (installed-revision pin), which becomes the reviewed-revision pin checked by `production runtime-check`, and
# (Decision 0161) REF:L245-L248, the retained pre-press sign-in receipt, which becomes the in-card renewal and check.
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
PRESS_RECORD_MAX_AGE_MS=120000
WORKER_INSTALL_TIMEOUT_SECONDS=180
# Decision 0173: Rowan's press needs a passing preflight of this card from at most this long ago.
DAY_GRANT_PREFLIGHT_MAX_AGE_MS=7200000
# Outer bound of `start-run sign-in`; it must exceed the sequence's worst case so the card never kills it mid-commit.
# Worst case (src/production/startRunSignIn.ts): before the nonce, 5 git calls x 30 s = 150 s, plus the renewal 60 s
# (+0.25 s drain); within the grant, every CLI call is capped at the time left until expiresAt, so they total at most
# 300 s, plus 11 git calls x 30 s = 330 s and the receipt wait (capped at expiresAt, already inside the 300 s);
# CLI start-up and journal writes about 20 s. Total 150 + 61 + 300 + 330 + 20 = 861 s < 1200 s (339 s margin).
SIGN_IN_TIMEOUT_SECONDS=1200
json_string() { jq -n --arg v "$1" '$v'; }
# The CLI writes its --json failure envelope to stderr after any tool warnings and moved child output (which may itself
# contain lines starting with "{"): take the last line-start "{" whose remainder parses, as json_envelope does.
cli_failure() {
  node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");let e;for(const i of [...s.matchAll(/^\{/gm)].map(m=>m.index).reverse()){try{e=JSON.parse(s.slice(i)).error;break}catch{}}
process.stdout.write(e?`${e.message} [code ${e.details?.code??e.code}; sequenceClaimed ${e.details?.sequenceClaimed??"unknown"}]`:"no readable result")' "$1" 2>/dev/null || echo "no readable result"
}
# Every call passes --json, whose stdout must be exactly one JSON envelope. Defense in depth for Issue #1956 (a child
# printing to stdout ahead of the envelope): when stdout is not one JSON document, keep only the trailing document that
# starts at a line beginning with "{" and parses, and move the lines before it to stderr (the run log). Output that has no
# such document passes through unchanged and is refused by its caller. The CLI's exit status is kept (pipefail).
json_envelope() {
  node -e 'const b=[];process.stdin.on("data",c=>b.push(c)).on("end",()=>{const s=Buffer.concat(b).toString("utf8");
try{JSON.parse(s);process.stdout.write(s);return}catch{}
const starts=[...s.matchAll(/^\{/gm)].map(m=>m.index).reverse();
for(const i of starts){try{JSON.parse(s.slice(i));process.stderr.write(s.slice(0,i));process.stdout.write(s.slice(i));return}catch{}}
process.stdout.write(s)})'
}
arcadia_t() { local t="$1"; shift; (cd "$ARCADIA_REPO" && timeout "$t" mise exec -- pnpm -s arcadia "$@" | json_envelope); }
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
SIGN_IN_ATTEMPTED=false
SIGN_IN_RECEIPT=""
EXPECTED_HEAD=""
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
      if [[ "$RESTART_ATTEMPTED" == true ]]; then echo "The protected worker install and restart was attempted: the worker may be on its new release, still source-run on its old one, or not running. Read the worker status before anything else."; fi
      if [[ "$SIGN_IN_ATTEMPTED" == true ]]; then
        echo "The Decision 0161 sign-in sequence was invoked; its journal is $RUN_DIR/sign-in.json. If it claimed this press's sequence record, that sequence is consumed: the sign-in may have rotated, a diagnostic Decision may be published on main, and there is no retry or START in this press; the next attempt needs a new card (no calendar-day wait, Decision 0162)."
      else
        echo "No sign-in renewal ran and no renewal sequence was claimed by this run."
      fi
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
# Decision 0162 removed the calendar-day ceiling on renewal and check sequences: no gate here reads the ledger by date.
# The only ledger refusal is an overlapping in-flight sequence, checked by `start-run sign-in` (read-only in P2).
# REF:L245-L248 and L364 as replaced by Decision 0161: START needs the bound worker's own usage receipt from this card's sequence (or a
# fresh reused one of the same bound worker): its bytes unchanged, a successful approved live check, the credential expiring more than
# 5 minutes from now and every reported usage window below 100% (operator ruling A, 2026-11-05: the 7d window is required;
# an absent 5h window is no limit; a reported 5h window must still be below 100%). Read-only; never a new probe.
check_signin_receipt() {
  local out
  out="$(node -e '
const fs=require("fs"),c=require("crypto");
const [sig,release,handler]=process.argv.slice(1);
try{
  const need=(x,m)=>{if(!x)throw Error(m)};
  const s=JSON.parse(sig||"null");
  need(s&&typeof s.path==="string"&&typeof s.sha256==="string","no worker usage receipt");
  need(c.createHash("sha256").update(fs.readFileSync(s.path)).digest("hex")===s.sha256,"worker usage receipt drift");
  const r=JSON.parse(fs.readFileSync(s.path,"utf8"));
  need(r.schema==="arcadia-worker-claude-usage-receipt-v1"&&r.release===release&&r.handlerHash===handler,"the usage receipt is not from the bound worker (release and handler)");
  need(r.approval&&typeof r.approval.digest==="string","the usage receipt carries no approved grant");
  need(r.success===true&&r.httpStatus===200&&r.outcome==="ok"&&r.requestAttempted===true,"the worker usage check did not succeed");
  need(Date.parse(r.credentialExpiresAt)>Date.now()+5*60000,"credential expiry: the sign-in has expired or expires within 5 minutes");
  const w=l=>(Array.isArray(r.windows)?r.windows:[]).filter(x=>x.label===l);
  need(["5h","7d"].every(l=>(l==="5h"&&w(l).length===0)||w(l).length===1&&Number.isFinite(w(l)[0].usedPercentage)&&w(l)[0].usedPercentage>=0&&w(l)[0].usedPercentage<100),"usage window unknown or at 100%");
  process.stdout.write(JSON.stringify({path:s.path,sha256:s.sha256,credentialExpiresAt:r.credentialExpiresAt,windows:r.windows,release:r.release,handlerHash:r.handlerHash,finishedAt:r.finishedAt??null}));
}catch(e){process.stdout.write("REFUSED: "+e.message);process.exit(1)}
' "$SIGN_IN_RECEIPT" "$PIN" "$BOUND_HANDLER")" || refuse "sign-in and credential-expiry gate: ${out#REFUSED: }"
  rec signInReceipt "$out"
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
# The environment variables alone can be exported by any host shell. A live press also has the dashboard's run record, written
# (status running, this card's id, a run id) before the runner execs this script, plus the runner's own pid. Require it to be this
# card's, running, fresh, parented by that runner and not yet claimed. Reads only; the claim happens after every P0 check passed.
OPERATOR_RUN_ID=""
OPERATOR_RUN_DIR=""
check_operator_press_record() {
  local dir out
  dir="${ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY:-}"
  [[ -n "${ARCADIA_OPERATOR_SCRIPT_RUN_ID:-}" && -n "$dir" && -f "$dir/run.json" ]] || refuse "there is no operator press record for this run; launch this Grant from the /actions operator-action library"
  out="$(node -e '
const fs=require("fs"),p=require("path");
const [dir,runId,id,ppid,maxAgeMs,descriptor,delegationJson]=process.argv.slice(1);
const fail=(m)=>{console.log(m);process.exit(1)};
let r;try{r=JSON.parse(fs.readFileSync(p.join(dir,"run.json"),"utf8"))}catch{fail("the operator press record is unreadable")}
if(p.basename(dir)!==runId)fail("the operator press record directory is not this run");
if(r.schema!=="arcadia-operator-script-run-v1"||r.runId!==runId)fail("the operator press record is not for this run id");
if(r.scriptId!==id)fail("the operator press record belongs to another card");
if(r.status!=="running")fail("the operator press record is not in running state");
if(String(r.pid)!==ppid)fail("the operator press record is not parented by this process launcher");
const t=Date.parse(r.startedAt),age=Date.now()-t;
if(!Number.isFinite(t)||age<-5000||age>Number(maxAgeMs))fail("the operator press record is not fresh");
if(descriptor!==p.join(dir,"descriptor.json"))fail("the operator press record does not bind the run descriptor");
if(fs.existsSync(p.join(dir,"start-run.claimed")))fail("the operator press record is already claimed");
const d=JSON.parse(delegationJson||"null");
if(d){const want={kind:"delegated",agent:"rowan",decision:d.decision,originatingRun:d.decision==="0173"?d.approvalCard+"/"+d.approvalRun:d.originatingCard+"/"+d.originatingRun};
  if(JSON.stringify(r.press)!==JSON.stringify(want))fail("a delegated START card must be pressed through /actions as Rowan delegated press under Decision "+d.decision+", never as an operator press");}
else if(r.press!==undefined)fail("only a Decision 0163 delegated card may carry a delegated press record");
' "$dir" "$ARCADIA_OPERATOR_SCRIPT_RUN_ID" "$ID" "$PPID" "$PRESS_RECORD_MAX_AGE_MS" "${ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR:-}" "$DELEGATION")" || refuse "${out:-the operator press record could not be checked}"
  OPERATOR_RUN_ID="$ARCADIA_OPERATOR_SCRIPT_RUN_ID"
  OPERATOR_RUN_DIR="$dir"
  # Decision 0173 counts refused presses: a refusal in P0, before the claim, must still name the press it refused.
  [[ "$DELEGATION_DECISION" != 0173 ]] || rec_str operatorRunId "$OPERATOR_RUN_ID"
}
# Decision 0163: a successor card Rowan presses, delegated from the operator's originating press. Read-only, from the library on
# disk: the originating receipt is unchanged and was a consumed /actions press by the operator of a non-delegated card with the
# delegated scope, and the operator's first such press after Decision 0163 reached main; this card keeps that scope; fewer than
# 5 attempts since it (every /actions press of any in-scope card that consumed its allowance, read from runs/operator) and this card's
# attempt number follows them; within 72 hours of the originating press; and the trigger holds on the latest of them: it
# refused with no activation attempted, or its own executor returned only its Grant to Off. Decision 0163's approval at the
# reviewed revision is checked in P1 (it is in startRun.requiredDecisions; the descriptor contract requires it).
# src/operatorActions/startRunDelegation.ts computes the same chain for `start-run pins --delegated-from`.
check_delegation() {
  local out
  [[ "$DELEGATION" != null ]] || return 0
  if [[ "$DELEGATION_DECISION" == 0173 ]]; then check_day_grant; return 0; fi
  out="$(node -e '
const fs=require("fs"),p=require("path"),c=require("crypto");
const [lib,id,dj,descriptorPath]=process.argv.slice(1);
const d=JSON.parse(dj),me=JSON.parse(fs.readFileSync(descriptorPath,"utf8")).startRun;
const fail=(m)=>{process.stdout.write(m);process.exit(1)};
const rj=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const ls=(f)=>{try{return fs.readdirSync(f)}catch{return []}};
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,RUN=/^[0-9]{8}T[0-9]{6}Z-[0-9]+$/,EARLIEST=Date.parse("2026-11-01T04:35:38Z"),MAX=5,WINDOW=72*3600e3;
const SCOPE={plan:"arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider",actions:["bound-guidance-test-teardown-retries","assert-tmux-temp-launcher-removed","cover-retired-descriptor-byte-change"],provider:"claude-code-cli",concurrency:1,spendDecision:"0130"};
const same=(x)=>!!x&&x.plan===SCOPE.plan&&JSON.stringify(x.actions)===JSON.stringify(SCOPE.actions)&&x.provider===SCOPE.provider&&x.concurrency===SCOPE.concurrency&&x.spendDecision===SCOPE.spendDecision;
if(d.decision!=="0163")fail("the delegation does not name Decision 0163");
if(typeof d.originatingCard!=="string"||!SLUG.test(d.originatingCard)||typeof d.originatingRun!=="string"||!RUN.test(d.originatingRun))fail("the delegation names a malformed originating card or run");
const rp=p.join(lib,"runs",d.originatingCard,d.originatingRun,"receipt.json");
if(!fs.existsSync(rp))fail("the originating press receipt "+rp+" does not exist");
const bytes=fs.readFileSync(rp);
if(c.createHash("sha256").update(bytes).digest("hex")!==d.originatingReceiptSha256)fail("the originating press receipt changed since the delegation was pinned");
const o=JSON.parse(bytes);
if(o.id!==d.originatingCard||o.runId!==d.originatingRun||o.mode!=="run"||o.allowanceConsumed!==true||typeof (o.record||{}).operatorRunId!=="string")fail("the originating run is not a consumed /actions press of its card");
// Every /actions press of an in-scope START card (any card but this one), from the runner press directories.
const presses=[];const ops=p.join(lib,"runs","operator");
for(const card of ls(ops)){if(card===id||!SLUG.test(card))continue;
  const receipts=ls(p.join(lib,"runs",card)).map((run)=>({run,r:rj(p.join(lib,"runs",card,run,"receipt.json"))}));const consumedRun=(rj(p.join(lib,card+".consumed.json"))||{}).runId;
  for(const pr of ls(p.join(ops,card))){const dir=p.join(ops,card,pr),run=rj(p.join(dir,"run.json")),sr=(rj(p.join(dir,"descriptor.json"))||{}).startRun;
    if(!run||run.schema!=="arcadia-operator-script-run-v1"||run.scriptId!==card||run.runId!==pr||!same(sr))continue;
    const t=Date.parse(run.startedAt);if(!Number.isFinite(t))continue;
    const m=receipts.find((x)=>x.r&&x.r.mode==="run"&&(x.r.record||{}).operatorRunId===pr)||null;
    presses.push({card,pr,t,at:run.startedAt,sr,delegated:run.press!==undefined||sr.delegation!==undefined,attempt:(m&&m.r.allowanceConsumed===true)||(!!m&&consumedRun===m.run)||(!(m&&m.r)&&fs.existsSync(p.join(dir,"start-run.claimed"))&&fs.existsSync(p.join(lib,card+".consumed.json"))),r:m&&m.r,run:m&&m.run});}}
presses.sort((a,b)=>a.t-b.t);
const origin=presses.find((x)=>x.card===d.originatingCard&&x.pr===o.record.operatorRunId);
if(!origin)fail("the originating run has no /actions press record of the delegated scope");
if(origin.delegated)fail("the originating run was not pressed by the operator through /actions");
if(!same(me)||me.project!==origin.sr.project||JSON.stringify(me.transitions)!==JSON.stringify(origin.sr.transitions))fail("this card scope (Plan, Actions in order, provider, concurrency, spend Decision, transitions) differs from the originating press");
if(Date.now()-origin.t>WINDOW||Date.now()<origin.t)fail("more than 72 hours have passed since the operator originating press");
if(origin.t<EARLIEST)fail("the originating press predates Decision 0163 on main; only the operator next press delegates");
const first=presses.find((x)=>!x.delegated&&x.attempt&&x.t>=EARLIEST);
if(first!==origin)fail("the operator first press after Decision 0163 is "+first.card+"/"+first.pr+"; only that press delegates");
const attempts=presses.filter((x)=>x.attempt&&x.t>=origin.t);
if(attempts.length>=MAX)fail(attempts.length+" START attempts already ran since the operator originating press; Decision 0163 allows at most 5");
if(d.attempt!==attempts.length+1)fail("this card is pinned as attempt "+d.attempt+" but "+attempts.length+" attempts already ran");
const latest=attempts.at(-1),r=latest.r;
if(!r)fail("no Decision 0163 trigger: the latest attempt "+latest.card+"/"+latest.pr+" has no readable executor receipt");
let trigger;
if(r.outcome==="refused"&&r.productionActivated===false&&r.offCleanup==="not_attempted")trigger="refused-before-start";
else if(r.outcome==="refused"&&r.productionActivated===true&&r.offCleanup==="returned_off")trigger="returned-off-after-failed-activation";
else fail("no Decision 0163 trigger: the latest attempt "+latest.card+"/"+latest.run+" has outcome "+r.outcome+", production activated "+JSON.stringify(r.productionActivated)+", Off cleanup "+r.offCleanup+"; an Off this chain did not issue (a STOP card, a Decision, a stop-the-line) never triggers a successor");
// Every activate and deactivate bumps the policy revision, even an Off of an already-Off policy: a STOP, a Decision, a
// stop-the-line or another Grant since the latest attempt leaves this card pinned past it, and ends the delegation.
const rev=((latest.sr||{}).production||{}).revision,want=Number.isInteger(rev)?rev+(trigger==="returned-off-after-failed-activation"?2:0):null;
if(want===null||((me||{}).production||{}).revision!==want)fail("production changed after the latest attempt "+latest.card+"/"+latest.run+" (policy revision "+(((me||{}).production||{}).revision)+", expected "+want+"): a STOP, a Decision, a stop-the-line or another Grant ends the delegation");
process.stdout.write(JSON.stringify({originatingRun:d.originatingCard+"/"+d.originatingRun,operatorRunId:o.record.operatorRunId,originatingPressAt:origin.at,attempt:d.attempt,attemptsBefore:attempts.length,latest:latest.card+"/"+latest.run,trigger}));
' "$LIBRARY_DIR" "$ID" "$DELEGATION" "$DESCRIPTOR")" || refuse "Decision 0163 delegation: $out"
  rec delegation "$out"
}
# Decision 0173: a START card Rowan presses within the operator's day approval. src/operatorActions/startRunDayGrant.ts computes
# the same chain for `start-run pins --day-grant-from`, in the same order and with the same refusal codes. Read-only, from the
# library on disk and `start-run day-evidence` (the policy receipts and admissions in the workspace database, the only record
# of who moved production and whether a Session was admitted). A chat message is no approval: nothing could verify one.
#   - the approval: receipt and press record unchanged; a browser press through the runner with no delegated marker, consumed by
#     this run; the operator's latest; exactly 24 hours from that press and still open;
#   - this card's Plan, provider, concurrency and spend Decision are the approved ones (P1 and P2 check the Plan is active and its
#     governed queue holds the pinned Actions);
#   - every policy move since the approval is this chain's or Rowan's own Off (fail-closed: any other Off ends the day);
#   - Decision 0181 (which re-decided Decision 0170's three attempts): no failed batch in this day. A batch is an activation that
#     admitted a Session; it is clean only when the tick recorded scope complete inside that run with no escalation, and any
#     other end fails it (fail closed). A failed batch counts unless it was over before the operator's press opened the day;
#     Decision 0187 (which re-decided that stop): a counted failed batch is passed only when the card after its press called it
#     a failed attempt and named a merged fix whose cause is the named cause; P1 checks each fix is on the reviewed revision,
#     dated after its batch ended, and that Decision 0187 is answered with option A there. Otherwise it stops for the operator;
#   - fewer than 2 re-presses after a refusal in this day, however the card is re-prepared, and the same refusal does not recur;
#   - the card names the latest press with its cause, evidence and clearance, and no two failed attempts share a named cause.
# The cause is Rowan's judgement: it is recorded and compared here, not proved.
# Shared by the P0 check and the later checks: fail-closed listing and reading, and the operator's latest approval.
DAY_PRESS_SCAN_JS='
const fs=require("fs"),p=require("path");
const fail=(m)=>{process.stdout.write(m);process.exit(1)};
const rj=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const ls=(f)=>{try{return fs.readdirSync(f)}catch(e){if(e.code==="ENOENT"||e.code==="ENOTDIR")return [];fail("PRESS_UNREADABLE: "+f+" cannot be listed ("+e.code+"), so earlier presses cannot be counted or ruled out; preserve it and stop for the operator")}};
const EARLIEST=Date.parse("2026-11-03T19:26:51Z");
const idTime=(name)=>{const m=/^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{3})-/.exec(name);return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6],+m[7]):null};
const scanPresses=(lib,opens,offId)=>{const ops=p.join(lib,"runs","operator");
  // Fail closed: a press since Decision 0170 that cannot be read could be a re-press to count or a later approval.
  for(const card of ls(ops))for(const name of ls(p.join(ops,card))){const dir=p.join(ops,card,name);let isDir=false;
    try{isDir=fs.statSync(dir).isDirectory()}catch(e){if(e.code!=="ENOENT")fail("PRESS_UNREADABLE: the press record "+card+"/"+name+" cannot be read, so it cannot be counted or ruled out; preserve it and stop for the operator")}
    if(!isDir)continue;const time=idTime(name);if(time!==null&&time<EARLIEST)continue;
    const run=rj(p.join(dir,"run.json"));if(time===null&&run&&Date.parse(run.startedAt)<EARLIEST)continue;
    if(!run||!rj(p.join(dir,"descriptor.json"))||run.schema!=="arcadia-operator-script-run-v1"||run.scriptId!==card||run.runId!==name)fail("PRESS_UNREADABLE: the press record "+card+"/"+name+" cannot be read, so it cannot be counted or ruled out; preserve it and stop for the operator");}
  for(const other of ls(ops))for(const op of ls(p.join(ops,other))){const dir=p.join(ops,other,op);if(!(rj(p.join(dir,"descriptor.json"))||{}).dayGrant)continue;const r=rj(p.join(dir,"run.json"))||{};
    if(r.status==="succeeded"&&r.press===undefined&&r.browserPress===true&&fs.existsSync(p.join(dir,"day-grant.claimed"))&&Date.parse(r.startedAt)>opens)fail("APPROVAL_SUPERSEDED: the operator approved a later day with "+other+"/"+op+"; a card names the latest approval");}
  // Any press of the STOP card since the approval ends the day; one before it does not, so a later approval opens a new day.
  // A STOP pressed while production is Off writes no policy receipt, so its press is the only record.
  for(const stop of ls(ops)){if(stop!==offId&&!/^restore-off-production(?:-|$)/.test(stop))continue;
    for(const name of ls(p.join(ops,stop))){const dir=p.join(ops,stop,name);if(!fs.statSync(dir).isDirectory())continue;const time=idTime(name);if(time!==null&&time<EARLIEST)continue;
      const t=Date.parse((rj(p.join(dir,"run.json"))||{}).startedAt);if(!Number.isFinite(t))fail("PRESS_UNREADABLE: the press record "+stop+"/"+name+" cannot be read, so it cannot be counted or ruled out; preserve it and stop for the operator");
      if(t>=opens)fail("DAY_ENDED_BY_OPERATOR: the STOP card "+stop+" was pressed at "+new Date(t).toISOString()+": an operator STOP ends the day, even with production already Off");}}};
'
check_day_grant() {
  local out evidence
  evidence="$(arcadia start-run day-evidence --json)" || refuse "Decision 0173: EVIDENCE_UNAVAILABLE: the production record could not be read"
  jq -e '.ok == true' <<<"$evidence" >/dev/null || refuse "Decision 0173: EVIDENCE_UNAVAILABLE: the production record is unreadable"
  out="$(node -e "$DAY_PRESS_SCAN_JS"'
const c=require("crypto");
const [lib,id,dj,descriptorPath,evidenceJson,currentPress,mode,maxPreflightAge]=process.argv.slice(1);
const d=JSON.parse(dj),me=JSON.parse(fs.readFileSync(descriptorPath,"utf8")).startRun,ev=JSON.parse(evidenceJson).data;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,RUN=/^[0-9]{8}T[0-9]{6}Z-[0-9]+$/,WINDOW=24*3600e3,MAX_REPRESSES=2,ROWAN_OFF=/^rowan-off-[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Decision 0181: a batch (an activation that admitted a Session) is clean only with a scope-complete record and no escalation.
const failedBatch=(x)=>{if(!(x.admitted>=1))return false;const s=x.scopeComplete;return !(s&&Number.isInteger(s.merged)&&s.merged>=1&&s.escalated===0)};
const sha=(b)=>c.createHash("sha256").update(b).digest("hex");
const keys=(o)=>o&&typeof o==="object"&&!Array.isArray(o)?Object.keys(o).sort().join():"";
const SHA=/^[0-9a-f]{64}$/,word=(v)=>v==="undefined"||v==="null";
const pointer=(v)=>typeof v==="string"&&v.length>0&&v.length<=500&&!v.includes("\n")&&!word(v)&&(/^https:\/\/\S+$/.test(v)||(!p.isAbsolute(v)&&!v.split("/").includes("..")));
if(keys(d)!=="approvalCard,approvalPressSha256,approvalReceiptSha256,approvalRun,attempt,decision,previous"||d.decision!=="0173"||typeof d.approvalCard!=="string"||!SLUG.test(d.approvalCard)||typeof d.approvalRun!=="string"||!RUN.test(d.approvalRun)||!SHA.test(d.approvalReceiptSha256)||!SHA.test(d.approvalPressSha256)||!Number.isInteger(d.attempt)||d.attempt<1)fail("INVALID_DELEGATION: the card names a malformed day approval");
// The approval.
const rp=p.join(lib,"runs",d.approvalCard,d.approvalRun,"receipt.json");
if(!fs.existsSync(rp))fail("APPROVAL_MISSING: the approval receipt "+rp+" does not exist");
const rb=fs.readFileSync(rp);
if(sha(rb)!==d.approvalReceiptSha256)fail("APPROVAL_CHANGED: the approval receipt changed since this card was pinned");
let a;try{a=JSON.parse(rb)}catch{fail("APPROVAL_NOT_PRESSED: the approval receipt is unreadable")}
const pressId=(a.record||{}).operatorRunId;
if(a.schema!=="arcadia-day-grant-receipt-v1"||a.id!==d.approvalCard||a.runId!==d.approvalRun||a.mode!=="run"||a.outcome!=="approved"||a.allowanceConsumed!==true||typeof pressId!=="string")fail("APPROVAL_NOT_PRESSED: the approval is not a consumed, approved /actions press of a day-grant card");
const cm=rj(p.join(lib,d.approvalCard+".consumed.json"))||{};
if(cm.state!=="CONSUMED"||cm.requestId!==d.approvalCard||cm.runId!==d.approvalRun)fail("APPROVAL_NOT_PRESSED: the day-grant card one-shot marker does not name this run");
const pd=p.join(lib,"runs","operator",d.approvalCard,pressId),pp=p.join(pd,"run.json");
if(!fs.existsSync(pp))fail("APPROVAL_NOT_OPERATOR: the approval has no /actions press record");
const pb=fs.readFileSync(pp);
if(sha(pb)!==d.approvalPressSha256)fail("APPROVAL_CHANGED: the approval press record changed since this card was pinned");
const pr=rj(pp)||{};
if(pr.schema!=="arcadia-operator-script-run-v1"||pr.scriptId!==d.approvalCard||pr.runId!==pressId||pr.status!=="succeeded")fail("APPROVAL_NOT_OPERATOR: the approval press record is not this card finished /actions press");
if(pr.press!==undefined)fail("APPROVAL_NOT_OPERATOR: a delegated press never counts as the operator day approval");
if(pr.browserPress!==true)fail("APPROVAL_NOT_OPERATOR: the approval was not pressed from the /actions page in a browser");
let claimed="";try{claimed=fs.readFileSync(p.join(pd,"day-grant.claimed"),"utf8").trim()}catch{}
if(claimed!==d.approvalRun)fail("APPROVAL_NOT_OPERATOR: the approval press record was not claimed by this run");
const g=(rj(p.join(pd,"descriptor.json"))||{}).dayGrant;
if(keys(g)!=="concurrency,decision,executorSha256,plan,project,provider,schema,spendDecision"||g.schema!=="arcadia-day-grant-v1"||g.decision!=="0173"||!SHA.test(g.executorSha256)||!SLUG.test(g.project)||!SLUG.test(g.plan)||g.provider!=="claude-code-cli"||g.concurrency!==1||!/^[0-9]{4}$/.test(g.spendDecision))fail("APPROVAL_NOT_OPERATOR: the approval press did not run a day-grant card");
// The press snapshot is not hashed, the receipt is: what the operator approved is what the pinned receipt recorded.
if(a.record.project!==g.project||a.record.plan!==g.plan||a.record.provider!==g.provider||a.record.spendDecision!==g.spendDecision)fail("APPROVAL_CHANGED: the approval press day-grant block is not the Project, Plan, provider and spend Decision its receipt recorded");
const opens=Date.parse(pr.startedAt);
if(!Number.isFinite(opens))fail("APPROVAL_NOT_OPERATOR: the approval press has no readable start time");
const closes=opens+WINDOW,now=Date.now();
if(a.record.pressStartedAt!==pr.startedAt||Date.parse(a.record.windowClosesAt)!==closes)fail("APPROVAL_CHANGED: the approval receipt window is not exactly 24 hours from the press");
if(now>=closes)fail("WINDOW_EXPIRED: the day approved at "+pr.startedAt+" ended at "+new Date(closes).toISOString()+"; it never renews itself");
if(now<opens)fail("WINDOW_EXPIRED: the approval press is in the future");
const baseline=a.record.policyRevisionAtApproval;
if(!Number.isInteger(baseline))fail("APPROVAL_NOT_PRESSED: the approval receipt records no policy revision");
const ops=p.join(lib,"runs","operator");
scanPresses(lib,opens,me.offId);
// The scope the operator approved. P1 and P2 prove the Plan is active and the pinned Actions head its governed queue.
if(me.project!==g.project||me.plan!==g.plan||me.provider!==g.provider||me.concurrency!==g.concurrency||me.spendDecision!==g.spendDecision)fail("SCOPE_NOT_APPROVED: this card scope ("+me.project+"/"+me.plan+", "+me.provider+", concurrency "+me.concurrency+", spend Decision "+me.spendDecision+") is not the Plan, provider and spend Decision the operator approved");
// Every move of production since the approval.
const startCards=new Set(ls(ops).filter((card)=>ls(p.join(ops,card)).some((press)=>!!(rj(p.join(ops,card,press,"descriptor.json"))||{}).startRun)));
// The exact id an executor uses to return its own Grant to Off, with the receipt of that run saying it did.
const executorOff=(req)=>[...startCards].some((card)=>{if(!req.startsWith(card+"-")||!req.endsWith("-off"))return false;const run=req.slice(card.length+1,-4);if(!RUN.test(run))return false;const r=rj(p.join(lib,"runs",card,run,"receipt.json"));return !!r&&r.id===card&&r.runId===run&&r.offCleanup==="returned_off"});
let revision=baseline;
for(const t of [...ev.transitions].filter((x)=>x.revisionBefore>=baseline).sort((x,y)=>x.revisionBefore-y.revisionBefore)){
  if(t.revisionBefore!==revision)fail("PRODUCTION_CHANGED: production policy moved from "+revision+" with no receipt (next receipt is at "+t.revisionBefore+"); no card may follow an unexplained move");
  if(t.transition==="activate"){if(!startCards.has(t.requestId))fail("PRODUCTION_CHANGED: production was activated by "+t.requestId+", which is no pressed START card");}
  else if(!ROWAN_OFF.test(t.requestId)&&!executorOff(t.requestId))fail("DAY_ENDED_BY_OPERATOR: production was turned Off by "+t.requestId+", not by this chain or Rowan: an operator STOP or operator-issued Off ends the day");
  revision=t.revisionAfter;}
if(((me.production)||{}).revision!==revision)fail("PRODUCTION_CHANGED: this card pins policy revision "+((me.production)||{}).revision+", but the chain since the approval reaches "+revision);
// Attempts are still numbered as Decision 0170 counted them (every activation that admitted a Session, a dashboard reactivation
// included); Decision 0181 lifted the cap, and the number only pins the card to its record.
const attempts=ev.activations.filter((x)=>Date.parse(x.at)>=EARLIEST&&x.admitted>=1).length;
// Decision 0181: a batch that fails stops for the operator. Any failed batch not over before the press that opened this day counts.
const failed=ev.activations.filter((x)=>failedBatch(x)&&!(typeof x.endedAt==="string"&&Date.parse(x.endedAt)<opens));
// Every /actions press of a START card since Decision 0170, except the one running now.
const presses=[];
for(const card of ls(ops)){if(!SLUG.test(card))continue;
  const receipts=ls(p.join(lib,"runs",card)).map((run)=>rj(p.join(lib,"runs",card,run,"receipt.json")));
  // A card is one-shot: its activation belongs to the one press that consumed its allowance, not a later refused press.
  const consumedPath=p.join(lib,card+".consumed.json"),consumedRun=(rj(consumedPath)||{}).runId,activation=ev.activations.some((x)=>x.requestId===card&&x.admitted>=1),batchFailed=ev.activations.some((x)=>x.requestId===card&&failedBatch(x)),before=presses.length;
  for(const pr2 of ls(p.join(ops,card))){if(pr2===currentPress)continue;
    const dir=p.join(ops,card,pr2),run=rj(p.join(dir,"run.json")),sr=(rj(p.join(dir,"descriptor.json"))||{}).startRun;
    if(!run||!sr||run.schema!=="arcadia-operator-script-run-v1"||run.scriptId!==card||run.runId!==pr2)continue;
    const t=Date.parse(run.startedAt);if(!Number.isFinite(t)||t<EARLIEST)continue;
    const r=receipts.find((x)=>x&&x.mode==="run"&&(x.record||{}).operatorRunId===pr2)||null;
    if(r&&r.outcome==="succeeded"&&!ev.activations.some((x)=>x.requestId===card))fail("EVIDENCE_MISMATCH: "+card+" recorded a successful START but production has no activation under its request id");
    const admitted=activation&&((r&&r.allowanceConsumed===true)||(!!r&&!!consumedRun&&r.runId===consumedRun)||(!r&&fs.existsSync(p.join(dir,"start-run.claimed"))&&fs.existsSync(consumedPath)));
    presses.push({card,pr:pr2,key:card+"/"+pr2,t,status:String(run.status),del:sr.delegation||null,mark:run.press||null,r,admitted,failed:admitted&&batchFailed});}
  if(activation&&presses.length>before&&!presses.slice(before).some((x)=>x.admitted))fail("EVIDENCE_MISMATCH: production records a Session admitted under "+card+", but no press of that card consumed its allowance");}
presses.sort((x,y)=>x.t-y.t);
const latest=presses.at(-1)||null;
// Decision 0187: the card after a failed press may go on when it names a fix merged for the cause of that batch. For the latest press
// that card is this one; for an earlier failure it is the press that followed it, whose fix P1 checks again at the pin of this card.
// Anything else (no owning press, a batch the operator pressed, a follower the operator pressed, a clearance by observation,
// another cause) stops for the operator. Decision 0187 covers a failed delegated batch only, so the owner must be Rowan press.
// A named cause in full: a stable slug, an evidence pointer and a well-formed clearance (this card, and each earlier follower).
const prevValid=(prev)=>{if(!prev||typeof prev!=="object")return false;const cl=prev.clearance||{};
  const clearOk=cl.kind==="merged-fix"?(keys(cl)==="commit,kind,pullRequest,reproduction"||(keys(cl)==="cause,commit,kind,pullRequest,reproduction"&&typeof cl.cause==="string"&&SLUG.test(cl.cause)&&!word(cl.cause)))&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(cl.pullRequest)&&/^[0-9a-f]{40}$/.test(cl.commit)&&typeof cl.reproduction==="string"&&cl.reproduction.length>0&&cl.reproduction.length<=300&&!cl.reproduction.includes("\n")&&!p.isAbsolute(cl.reproduction)&&!cl.reproduction.split("/").some((x)=>x===".."||x==="."||x===""):cl.kind==="observed-cleared"&&keys(cl)==="kind,observation"&&pointer(cl.observation);
  return keys(prev)==="cause,clearance,evidence,kind,press"&&typeof prev.press==="string"&&prev.press.includes("/")&&(prev.kind==="failed-attempt"||prev.kind==="clean-batch"||prev.kind==="no-session")&&typeof prev.cause==="string"&&SLUG.test(prev.cause)&&!word(prev.cause)&&pointer(prev.evidence)&&clearOk};
const mergedFix=(b,o,n)=>{if(!(o.mark&&o.mark.decision==="0173")||!prevValid(n))return null;const cl=n.clearance;
  if(n.press!==o.key||n.kind!=="failed-attempt"||cl.kind!=="merged-fix"||cl.cause!==n.cause)return null;
  if(typeof b.endedAt!=="string"||!Number.isFinite(Date.parse(b.endedAt)))return null;
  return {batch:b.requestId,press:o.key,endedAt:b.endedAt,commit:cl.commit,reproduction:cl.reproduction,cause:n.cause}};
const cleared=[];
for(const b of failed){const o=presses.find((x)=>x.card===b.requestId&&x.admitted),nx=o?presses[presses.indexOf(o)+1]:undefined;
  const n=!o?null:o===latest?d.previous:(nx&&nx.mark&&nx.mark.decision==="0173"&&nx.del&&nx.del.decision==="0173"?nx.del.previous:null),f=o?mergedFix(b,o,n):null;
  if(!f)fail("FAILED_BATCH: the batch "+b.requestId+" (activated "+b.at+") failed under the day approved at "+pr.startedAt+": it admitted a Session and did not reach scope complete without an escalation; Decision 0181 stops for the operator unless the card after it names a merged fix for that cause (Decision 0187: previous.kind failed-attempt, a merged-fix clearance whose cause is the named cause, merged after the batch ended)");
  cleared.push(f);}
if(latest&&(latest.status==="running"||(latest.r&&latest.r.outcome==="in_progress")))fail("PREVIOUS_UNSETTLED: the latest START press "+latest.key+" has not finished; read its receipt before any other press");
let rePresses=0;
presses.forEach((x,i)=>{if(x.t>=opens&&x.mark&&x.mark.decision==="0173"&&i>0&&!presses[i-1].admitted)rePresses+=1;});
if(latest&&!latest.admitted&&rePresses>=MAX_REPRESSES)fail("REPRESSES_EXHAUSTED: "+rePresses+" re-presses after a refusal already ran in this day; Decision 0173 allows at most 2, however the card is re-prepared");
const refusalKey=(r)=>(!r||typeof r.reason!=="string"||!r.reason.trim())?null:String(r.phase)+"|"+r.reason.toLowerCase().replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9:.]+z/g,"#").replace(/\b[0-9a-f]{7,64}\b/g,"#").replace(/[0-9]+/g,"#");
if(latest&&!latest.admitted&&latest.t>=opens){const k=refusalKey(latest.r),rep=k&&presses.find((x)=>x!==latest&&!x.admitted&&x.t>=opens&&refusalKey(x.r)===k);
  if(rep)fail("SAME_REFUSAL: the latest press refused for the same recorded reason as "+rep.key+" in this day: "+String(latest.r.reason).slice(0,200)+"; stop for the operator");}
// The named cause.
const prev=d.previous;
if(!latest){if(prev!==null)fail("PREVIOUS_MISMATCH: this card names "+((prev||{}).press)+", but no START press has happened since Decision 0170");}
else{
  if(prev===null||prev===undefined)fail("PREVIOUS_CAUSE_REQUIRED: the latest START press "+latest.key+" needs its cause named on this card, with an evidence pointer and how it was cleared");
  if(!prevValid(prev))fail("INVALID_DELEGATION: the cause on this card needs a stable slug, an evidence pointer and how it was cleared");
  if(prev.press!==latest.key)fail("PREVIOUS_MISMATCH: this card names "+prev.press+", but the latest START press is "+latest.key);
  const kind=!latest.admitted?"no-session":latest.failed?"failed-attempt":"clean-batch";
  if(prev.kind!==kind)fail("PREVIOUS_MISMATCH: this card calls "+latest.key+" a "+prev.kind+", but production record makes it a "+kind);
  const namedFor=(x)=>presses.filter((y)=>y.del&&y.del.decision==="0173"&&y.del.previous&&y.del.previous.press===x.key).map((y)=>y.del.previous.cause);
  // Decision 0173 stops if two attempts fail on the same cause; a clean batch failed on nothing.
  if(latest.failed&&presses.some((x)=>x!==latest&&x.admitted&&namedFor(x).includes(prev.cause)))fail("SAME_CAUSE: two attempts failed on the cause "+prev.cause+"; Decision 0173 stops here for the operator");
  if(!latest.admitted&&presses.some((x)=>x!==latest&&!x.admitted&&x.t>=opens&&namedFor(x).includes(prev.cause)))fail("SAME_REFUSAL: the refusal named "+prev.cause+" recurred in this day; Decision 0173 stops here for the operator");
}
if(d.attempt!==attempts+1)fail("ATTEMPT_MISMATCH: this card is pinned as attempt "+d.attempt+", but "+attempts+" attempts already admitted a Session");
// A fresh preflight and pin check before a press. The pre-mortem pointer is recorded on the reviewed manifest, not proved.
const m=rj(p.join(lib,"reviewed",id+".json"))||{};
if(typeof m.premortem!=="string"||!m.premortem.trim())fail("PREMORTEM_REQUIRED: the reviewed manifest of this card names no fresh pre-mortem");
if(mode==="run"){const fresh=ls(p.join(lib,"runs",id)).map((run)=>rj(p.join(lib,"runs",id,run,"receipt.json"))).some((x)=>x&&x.mode==="preflight"&&x.outcome==="preflight_ok"&&(x.record||{}).reviewedRevision===me.reviewedRevision&&now-Date.parse(x.updatedAt)<=Number(maxPreflightAge));
  if(!fresh)fail("PREFLIGHT_REQUIRED: this card has no passing preflight at its revision from the last 2 hours");}
process.stdout.write(JSON.stringify({decision:"0173",approval:d.approvalCard+"/"+d.approvalRun,approvalPressAt:pr.startedAt,windowClosesAt:new Date(closes).toISOString(),attempt:d.attempt,attemptsBefore:attempts,failedBatchesToday:failed.length,clearedFailures:cleared,rePressesToday:rePresses,previous:prev||null,chainKey:latest?latest.card+"--"+latest.pr:"first",premortem:m.premortem,baselineRevision:baseline}));
' "$LIBRARY_DIR" "$ID" "$DELEGATION" "$DESCRIPTOR" "$evidence" "${OPERATOR_RUN_ID:-}" "$MODE" "$DAY_GRANT_PREFLIGHT_MAX_AGE_MS")" || refuse "Decision 0173: $out"
  rec delegation "$out"
  DAY_WINDOW_CLOSES="$(jq -r '.windowClosesAt' <<<"$out")"
  DAY_CHAIN_KEY="$(jq -r '.chainKey' <<<"$out")"
  DAY_APPROVAL_OPENS="$(jq -r '.approvalPressAt' <<<"$out")"
  DAY_CLEARED_FAILURES="$(jq -c '.clearedFailures' <<<"$out")"
}
# Decision 0173: every power ends at hour 24, only the operator's latest approval opens the day, and an operator STOP ends it.
# A press that began inside the window still may not take its allowance or activate after any of those.
check_day_window() {
  local out
  [[ "$DELEGATION_DECISION" == 0173 ]] || return 0
  node -e 'process.exit(Date.now() < Date.parse(process.argv[1]) ? 0 : 1)' "$DAY_WINDOW_CLOSES" || refuse "Decision 0173: WINDOW_EXPIRED: $1"
  out="$(node -e "$DAY_PRESS_SCAN_JS"'scanPresses(process.argv[1],Date.parse(process.argv[2]),process.argv[3]);' "$LIBRARY_DIR" "$DAY_APPROVAL_OPENS" "$OFF_ID")" || refuse "Decision 0173: $out"
}
claim_operator_press_record() {  # exclusive; called once every other P0 check has passed
  [[ "$MODE" == run ]] || return 0
  ( set -C; printf '%s\n' "$RUN_ID" > "$OPERATOR_RUN_DIR/start-run.claimed" ) 2>/dev/null || refuse "the operator press record was claimed concurrently"
  rec_str operatorRunId "$OPERATOR_RUN_ID"
}
phase_p0() {
  local tool
  phase P0 context
  if [[ "$MODE" == run ]]; then  # REF:L151-L153
    [[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$ID" && -n "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" && -f "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" ]] || refuse "launch this Grant through the /actions operator-action library"
    [[ "$(cd "$(dirname "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR")" && pwd -P)/$(basename "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR")" == "$DESCRIPTOR" ]] || refuse "the launching descriptor is not this Grant's descriptor"
    [[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only Grant: an agent sandbox may not run it"
    check_operator_press_record
  fi
  [[ -z "${ARCADIA_WORKSPACE:-}" ]] || refuse "ARCADIA_WORKSPACE is set; the configured workspace must resolve on its own"  # ADOPT:L72
  for tool in git jq mise timeout node launchctl ps tmux; do command -v "$tool" >/dev/null || refuse "$tool is required on PATH"; done  # REF:L159
  [[ "$(cd "$LIBRARY_DIR/../../.." && pwd -P)" == "$ARCADIA_REPO" ]] || refuse "this card does not live in the library of the checkout that holds this executor"
  jq -e '.schema == "arcadia-operator-script-v1" and .kind == "grant" and (.startRun.schema == "arcadia-start-run-v1")' "$DESCRIPTOR" >/dev/null || refuse "the descriptor is not a START grant with a startRun block"
  check_preserved_history
  # Hashes are pinned in the independent final review's host-local manifest: the card pair and this executor.  REF:L161
  check_reviewed_hashes
  [[ "$(sha256_file "$SELF")" == "$EXECUTOR_SHA" ]] || refuse "this executor is not the one the card pins (startRun.executorSha256)"
  [[ ! -e "$ATTEMPT_FILE" ]] || refuse "the one-shot START allowance is consumed; never retry or reset"  # REF:L162
  check_expiry "this card expired at $CARD_EXPIRES_AT; ask for a fresh card"
  rec_str cardExpiresAt "$CARD_EXPIRES_AT"
  check_delegation
  if [[ "$MODE" == run && "$DELEGATION_DECISION" == 0173 ]]; then
    rec_str authority "Rowan's delegated press of this START card from /actions under Decision 0173, within the operator's day approval $(jq -r '.approvalCard + "/" + .approvalRun' <<<"$DELEGATION") (the run's activation touch), open until $DAY_WINDOW_CLOSES; attempt $(jq -r '.attempt' <<<"$DELEGATION") (numbered since Decision 0170) if it admits a Session, under Decision 0181, which stops for the operator after a failed batch; never recorded as the operator's press"
  elif [[ "$MODE" == run && "$DELEGATION" != null ]]; then
    rec_str authority "Rowan's delegated press of this successor START card from /actions under Decision 0163, delegated from the operator's originating press $(jq -r '.originatingCard + "/" + .originatingRun' <<<"$DELEGATION") (the one activation touch); attempt $(jq -r '.attempt' <<<"$DELEGATION") of at most 5; Decisions 0156, 0157, 0161, 0162 and 0163 are verified at the reviewed revision in P1"
  elif [[ "$MODE" == run ]]; then
    rec_str authority "The operator's own press of this per-run START card from /actions (launch context verified in P0), under Decisions 0156, 0157 and 0161, whose approval is verified at the reviewed revision in P1; no delegation to an agent is used or required"
  fi
  rec_str reviewedRevision "$PIN"
  rec_str executorSha256 "$EXECUTOR_SHA"
  # The spend check (arcadia spend check, assessSpendRisk) on the launch environment as the Sessions get it (billing variables stripped by
  # env -u): only clear proceeds; risk and unknown both refuse. Only the verdict enum is read back, never a value.  REF:L155
  SPEND_CHECK="$(arcadia spend check --launch-env stripped --json || true)"
  SPEND_VERDICT="$(jq -r '.data.verdict | select(. == "clear" or . == "risk" or . == "unknown")' <<<"$SPEND_CHECK" 2>/dev/null || true)"
  [[ "$SPEND_VERDICT" == clear ]] || refuse "the spend check is ${SPEND_VERDICT:-unreadable}, not clear; run arcadia spend check --launch-env stripped and fix what it names: risk, unknown and an unreadable result all refuse"
  claim_operator_press_record
}

# ---------------------------------------------------------------------------------------------------------------
# P1 repo
# ---------------------------------------------------------------------------------------------------------------
# Decision 0173 at the reviewed revision: its option A is the recorded answer, and a named merged fix is really on main with
# its fixture or replay present. Whether the fixture truly reproduces the cause, or the fix's review happened, is recorded only.
check_day_grant_at_pin() {
  local file content kind commit reproduction ended batch
  file="$(grep -E -m1 '^docs/decisions/0173-.*\.md$' <<<"$1" || true)"
  [[ -n "$file" ]] || refuse "Decision 0173 is not in docs/decisions at $PIN"
  # The frontmatter only: the Decision's body quotes every option.
  content="$(git_repo show "$PIN:$file" | frontmatter_json)" || refuse "Decision 0173's frontmatter could not be read at $PIN"
  jq -e '.status == "approved" and ((.answer // "") | tostring | startswith("A. Daily grant"))' <<<"$content" >/dev/null || refuse "Decision 0173 is not answered with option A at $PIN"
  # Decision 0181 option A replaced Decision 0170's three attempts with the failed-batch stop P0 checked; every day-grant card
  # needs it on the reviewed revision, whatever the card's requiredDecisions list.
  file="$(grep -E -m1 '^docs/decisions/0181-.*\.md$' <<<"$1" || true)"
  [[ -n "$file" ]] || refuse "Decision 0181 is not in docs/decisions at $PIN; a Decision 0173 card's failed-batch gate implements it"
  content="$(git_repo show "$PIN:$file" | frontmatter_json)" || refuse "Decision 0181's frontmatter could not be read at $PIN"
  jq -e '.status == "approved" and ((.answer // "") | tostring | startswith("A. Continued serial runs"))' <<<"$content" >/dev/null || refuse "Decision 0181 is not answered with option A at $PIN"
  [[ "$(jq -r '.startRun.planActivation // .planActivation // null | type' "$DESCRIPTOR")" == null ]] || refuse "a Decision 0173 card runs on the active Plan and carries no planActivation"
  kind="$(jq -r '.previous.clearance.kind // ""' <<<"$DELEGATION")"
  if [[ "$kind" == merged-fix ]]; then
    commit="$(jq -r '.previous.clearance.commit' <<<"$DELEGATION")"; reproduction="$(jq -r '.previous.clearance.reproduction' <<<"$DELEGATION")"
    git_repo merge-base --is-ancestor "$commit" "$PIN" 2>/dev/null || refuse "Decision 0173: the fix commit $commit named for the previous attempt is not on the reviewed revision $PIN"
    git_repo cat-file -e "$PIN:$reproduction" 2>/dev/null || refuse "Decision 0173: the reproduction $reproduction named for the previous attempt is missing at $PIN"
  fi
  # The continue-after-fix Decision (0187 when written): a card going on past a failed batch needs its option A on the reviewed
  # revision, and each fix P0 passed (this card's, or the one the card after an earlier failure named) on the reviewed revision
  # and merged after its batch ended. Until the answer is on main, a failed batch stops for the operator as Decision 0181 had it.
  if [[ "$(jq 'length' <<<"${DAY_CLEARED_FAILURES:-[]}")" != 0 ]]; then
    # By its slug alone, never a number: every START sign-in mints the next number, and this one was raced for twice on
    # 2026-11-07. Exactly one record may carry the slug; its id comes from that file name and must match its frontmatter.
    local slug=decide-what-unattended-production-does-after-a-delegated-batch-fails-under-the matches id
    matches="$(grep -E "^docs/decisions/[0-9]{4}-$slug\.md\$" <<<"$1" || true)"
    [[ -n "$matches" ]] || refuse "Decision 0173: FAILED_BATCH: no Decision record at $PIN has the slug $slug, so a failed batch still stops for the operator (Decision 0181)"
    [[ "$(wc -l <<<"$matches" | tr -d ' ')" == 1 ]] || refuse "Decision 0173: FAILED_BATCH: more than one Decision record at $PIN has the slug $slug, so the continue-after-fix Decision cannot be told apart and a failed batch still stops for the operator"
    file="$matches"; id="${file#docs/decisions/}"; id="${id:0:4}"
    content="$(git_repo show "$PIN:$file" | frontmatter_json)" || refuse "Decision $id frontmatter could not be read at $PIN"
    jq -e --arg id "$id" '(.id | tostring) == $id and .status == "approved" and ((.answer // "") | tostring | startswith("A. Continue after a reviewed fix merges"))' <<<"$content" >/dev/null || refuse "Decision 0173: FAILED_BATCH: Decision $id ($file) is not answered with option A at $PIN, so a failed batch still stops for the operator (Decision 0181)"
    while IFS=$'\t' read -r commit ended batch reproduction; do
      git_repo merge-base --is-ancestor "$commit" "$PIN" 2>/dev/null || refuse "Decision 0173: FAILED_BATCH: the fix commit $commit named for the failed batch $batch is not on the reviewed revision $PIN"
      git_repo cat-file -e "$PIN:$reproduction" 2>/dev/null || refuse "Decision 0173: FAILED_BATCH: the reproduction $reproduction named for the failed batch $batch is missing at $PIN"
      node -e 'process.exit(Number(process.argv[1])*1000>Date.parse(process.argv[2])?0:1)' "$(git_repo show -s --format=%ct "$commit" 2>/dev/null || true)" "$ended" \
        || refuse "Decision 0173: FAILED_BATCH: the fix commit $commit is dated before the failed batch $batch ended at $ended; the continue-after-fix Decision goes on only after a fix merged after the failure"
    done < <(jq -r '.[] | [.commit, .endedAt, .batch, .reproduction] | @tsv' <<<"$DAY_CLEARED_FAILURES")
  fi
}
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
  if [[ "$DELEGATION_DECISION" == 0173 ]]; then check_day_grant_at_pin "$tree"; fi
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
      [[ "$DELEGATION_DECISION" != 0173 ]] || refuse "Decision 0173 covers the active Plan; the Plan $PLAN is a draft"
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
# No competing Session (P2 and, again, P4).
#
# Decision 0156 retains "zero live admissions and no live Sessions" as a START gate (Decision 0143's no-Session guard). This
# check RELAXES that gate for one case, as Decision 0201 option A approves. Background: Decision 0191 launches successor coordinators
# under tmux, so a bare "no tmux session at all" refuses every START while a relay coordinator runs.
#
# The one tolerated case: a live tmux session that (1) has the EXACT name `arcadia coordinator relay-sessions` returns for a
# registered, relay-launched, current custodian of this Project (none while a handoff is in flight), AND (2) is running the
# very process that row was launched as: a descendant of that pane's PID whose arguments carry `--session-id <the row's
# native_session_id>`. A row whose pane died, or a different process started under the same name, is a competing Session.
#
# Reading tmux fails closed: only tmux's own "no server" answers mean "no sessions". A denied socket, any other tmux error, a
# mise shim failure, or a missing tmux refuses. TMUX and TMUX_TMPDIR (which choose the server socket) are stripped, as the
# launcher's tmuxQueryEnv does, so this reads the socket the relay launched on, not one the caller's shell points at. `tmux`
# here may be a mise shim; a shim that cannot run (for example an untrusted mise.toml in the working directory) prints a
# `mise ERROR` and is therefore refused, never read as "no sessions".
# ---------------------------------------------------------------------------------------------------------------
# Bounded (a wedged tmux server must not hang the card: Issue #2084); `timeout` is a P0 tool and exits 124 when it fires.
tmux_q() { env -u TMUX -u TMUX_TMPDIR timeout 15 tmux "$@"; }
# Whether a descendant of pane `$1`'s process runs `--session-id $2`. Any failure to read the process table is "no".
pane_runs_session() {
  local panes procs
  # Every pane of every window of exactly this session (`-s`, and `=name:` as the repo's panePid does), and exactly one: the
  # relay creates one pane, so a second pane or window (where a stranger could hide) is a competing Session.
  panes="$(tmux_q list-panes -s -t "=$1:" -F '#{pane_pid}' 2>/dev/null)" || return 1
  [[ "$(grep -c . <<<"$panes")" == 1 && "$panes" =~ ^[0-9]+$ ]] || return 1
  procs="$(ps -axo pid=,ppid=,command= 2>/dev/null)" || return 1
  node -e 'const [uuid,...panes]=process.argv.slice(1);const kids=new Map(),cmd=new Map();
for(const l of require("fs").readFileSync(0,"utf8").split("\n")){const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);if(!m)continue;cmd.set(m[1],m[3]);(kids.get(m[2])??kids.set(m[2],[]).get(m[2])).push(m[1])}
const seen=new Set(),todo=panes.filter(Boolean);
while(todo.length){const pid=todo.pop();if(seen.has(pid))continue;seen.add(pid);
if(new RegExp("(^|\\s)--session-id "+uuid+"(\\s|$)").test(cmd.get(pid)??""))process.exit(0);todo.push(...(kids.get(pid)??[]))}
process.exit(1)' "$2" $panes <<<"$procs"
}
check_no_competing_session() {
  local when="$1" live="" out err why rc=0 name uuid stray="" registry note="" pairs="" tolerated=""
  # stdout alone is the session list; stderr (a shim's warning, say) is kept apart for the message and never becomes a name.
  out="$(tmux_q ls -F '#{session_name}' 2> "$RUN_DIR/tmux-ls.stderr")" || rc=$?
  err="$(head -c 400 "$RUN_DIR/tmux-ls.stderr" 2>/dev/null)"
  if (( rc != 0 )); then
    # Only tmux's own "no server" answers (the patterns of isNoTmuxServerError in src/commands/worker.ts) mean "no sessions".
    why="exit $rc"; (( rc != 124 )) || why+=", timed out"
    (( rc != 124 )) && grep -Eqi 'no server running on|error connecting to .*\(no such file or directory\)' <<<"$err" \
      || refuse "tmux could not be read ($why), so START cannot show that no competing Session runs${when:+ $when}: ${err%%$'\n'*}${out:+ $out}"
  else
    live="$out"
  fi
  if [[ -z "$live" ]]; then rec relayCoordinatorSessions '[]'; return 0; fi
  if registry="$(arcadia coordinator relay-sessions --project "$PROJECT" --json 2> "$RUN_DIR/relay-sessions.stderr")" \
    && jq -e '.ok == true and (.data.sessions | type == "array")' <<<"$registry" >/dev/null 2>&1; then
    pairs="$(jq -r '.data.sessions[] | select(.allowed == true) | [.tmuxName, .nativeSessionId] | @tsv' <<<"$registry")"
  else
    note="; the relay registry could not be read: $(cli_failure "$RUN_DIR/relay-sessions.stderr")"
  fi
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    uuid="$(awk -F'\t' -v n="$name" '$1 == n { print $2; exit }' <<<"$pairs")"
    if [[ -n "$uuid" ]] && pane_runs_session "$name" "$uuid"; then tolerated+="$name"$'\n'; else stray+="$name "; fi
  done <<<"$live"
  [[ -z "$stray" ]] || refuse "a tmux server with live sessions exists; no competing Session may run${when:+ $when} (not a registered relay coordinator running its recorded session: ${stray% }${note})"
  rec relayCoordinatorSessions "$(jq -Rn '[inputs | select(length > 0)]' <<<"$tolerated")"
}

# ---------------------------------------------------------------------------------------------------------------
# P2 state
# ---------------------------------------------------------------------------------------------------------------
phase_p2() {
  local freeze
  phase P2 state
  check_production_off
  rec policyRevisionBefore "$PROD_REVISION"
  # ADOPT:L99-L102 (no competing Session) and the plist/PID facts the restart needs.
  check_no_competing_session ""
  [[ -f "$HOME/Library/LaunchAgents/$WORKER_LABEL.plist" ]] || refuse "worker launch agent $HOME/Library/LaunchAgents/$WORKER_LABEL.plist is missing"  # ADOPT:L96
  OLD_PID="$(worker_pid)"
  [[ -n "$OLD_PID" ]] || refuse "worker job $WORKER_LABEL has no running PID"  # ADOPT:L98
  rec oldWorkerPid "$OLD_PID"
  # Decision 0161: the pre-restart worker need only be live and fresh (its heartbeat fresh and its pidfile the launchd PID, or that
  # PID's direct child); it may be unbound (source-run). A source-run worker's launchd process is the tsx CLI, which runs the worker
  # as its one direct child, so the pidfile names the child. The card binds the worker itself in P4 (a protected worker runs node
  # directly, so there the pidfile must equal the launchd PID) and no longer reads a retained pre-press sign-in receipt.
  PRE_BINDING="$(read_worker_binding)" || refuse "the pre-restart worker heartbeat could not be read"
  jq -e --argjson fresh "$HEARTBEAT_FRESH_MS" '.ageMs >= 0 and .ageMs < $fresh' <<<"$PRE_BINDING" >/dev/null || refuse "stale or mismatched pre-restart worker heartbeat"
  PRE_WORKER_PID="$(jq -r '.workerPid' <<<"$PRE_BINDING")"
  if [[ "$PRE_WORKER_PID" != "$OLD_PID" ]]; then
    [[ "$PRE_WORKER_PID" =~ ^[0-9]+$ && "$(ps -o ppid= -p "$PRE_WORKER_PID" 2>/dev/null | tr -d '[:space:]')" == "$OLD_PID" ]] \
      || refuse "stale or mismatched pre-restart worker heartbeat: the pidfile names $PRE_WORKER_PID, neither the launchd PID $OLD_PID nor its direct child"
  fi
  rec preRestartWorkerPid "$PRE_WORKER_PID"
  rec preRestartBinding "$(jq -c '.binding' <<<"$PRE_BINDING")"
  # The read-only checks that must hold before the sign-in sequence may claim the day (grant and request slots, request ignored by Git).
  SIGN_IN_ARGS=(start-run sign-in --repository "$ARCADIA_REPO" --workspace "$WORKSPACE" --project "$PROJECT" --card "$ID" --run-id "$RUN_ID"
    --run-directory "$RUN_DIR" --release "$PIN" --policy-revision "$PROD_REVISION" --policy-epoch "$PROD_EPOCH")
  arcadia "${SIGN_IN_ARGS[@]}" --check-only --json > "$RUN_DIR/sign-in-check.json" 2> "$RUN_DIR/sign-in-check.stderr" \
    && jq -e '.ok == true and .data.mode == "check-only"' "$RUN_DIR/sign-in-check.json" >/dev/null \
    || refuse "the sign-in sequence preconditions fail: $(cli_failure "$RUN_DIR/sign-in-check.stderr")"
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
  [[ ! -e "$ATTEMPT_FILE" ]] || refuse "the one-shot START allowance is consumed; never retry or reset"
  check_checkout_clean_on_main
  check_origin_is_pin
  [[ "$(git_repo rev-parse HEAD)" == "$HEAD_BEFORE" ]] || refuse "main moved between the preconditions and the allowance"
  check_day_window "the day ended during the preflight; no allowance consumed"
  # Decision 0163: one card per attempt of the chain, claimed exclusively together with the allowance (a refusal before
  # here consumed nothing and leaves the attempt free for the next card).
  local attempt_claim=""
  if [[ "$DELEGATION_DECISION" == 0173 ]]; then
    # Only one card may follow a given press, claimed exclusively together with the allowance.
    local day_dir="$LIBRARY_DIR/runs/day-grant/$(jq -r '.approvalCard + "--" + .approvalRun' <<<"$DELEGATION")"
    attempt_claim="$day_dir/after-$DAY_CHAIN_KEY.claimed"
    mkdir -p "$day_dir" || refuse "the Decision 0173 claim directory could not be created; nothing was changed"
    ( set -C; printf '%s %s\n' "$ID" "$RUN_ID" > "$attempt_claim" ) 2>/dev/null \
      || refuse "Decision 0173: another card already followed that press; nothing was changed"
  elif [[ "$DELEGATION" != null ]]; then
    local chain_dir="$LIBRARY_DIR/runs/delegation/$(jq -r '.originatingCard + "--" + .originatingRun' <<<"$DELEGATION")"
    attempt_claim="$chain_dir/attempt-$(jq -r '.attempt' <<<"$DELEGATION").claimed"
    mkdir -p "$chain_dir" || refuse "the Decision 0163 attempt claim directory could not be created; nothing was changed"
    ( set -C; printf '%s %s\n' "$ID" "$RUN_ID" > "$attempt_claim" ) 2>/dev/null \
      || refuse "Decision 0163 attempt $(jq -r '.attempt' <<<"$DELEGATION") of this delegation was already claimed by another card; nothing was changed"
  fi
  # REF:L366: exclusive creation (wx) and fsync; ANY later failure keeps this consumed.
  node -e 'const fs=require("fs"),p=require("path"),[file,id,run,pinSha,head]=process.argv.slice(1);const fd=fs.openSync(file,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify({state:"CONSUMED",at:new Date().toISOString(),requestId:id,runId:run,reviewedRevision:pinSha,headBefore:head,policyRevision:Number(process.env.START_RUN_POLICY_REVISION)})+"\n");fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const d=fs.openSync(p.dirname(file),"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}' \
    "$ATTEMPT_FILE" "$ID" "$RUN_ID" "$PIN" "$HEAD_BEFORE" || { [[ -z "$attempt_claim" ]] || rm -f "$attempt_claim"; refuse "could not exclusively consume the START allowance; nothing was changed"; }
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
  local ensure broker restart_at_ms new_pid i ready binding release runtime install_out
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
  # Decision 0161: only now reinstall the pinned worker label from the pinned compiled release, through the supported
  # `worker install --replace-label` run by that release itself (so it writes the protected plist), and restart it.
  release="$HOME/.local/share/arcadia/go-broker/releases/$PIN"
  [[ -f "$release/broker-manifest.json" ]] || refuse "the installed release $release has no broker manifest; no worker install was attempted"
  jq -e --arg pin "$PIN" '.schema == "arcadia-go-broker-install-v1" and .revision == $pin' "$release/broker-manifest.json" >/dev/null || refuse "the installed release manifest is not the reviewed revision $PIN; no worker install was attempted"
  runtime="$(jq -er '.runtimeExecutable' "$release/broker-manifest.json")" || refuse "the installed release manifest names no runtime; no worker install was attempted"
  [[ -x "$runtime" && -f "$release/dist/src/cli.js" ]] || refuse "the installed release runtime or CLI is missing; no worker install was attempted"
  echo "==> Installing $WORKER_LABEL as the protected worker of release $PIN and restarting it through launchd"
  restart_at_ms="$(( $(date +%s) * 1000 ))"
  RESTART_ATTEMPTED=true
  mutated "protected worker install and restart of $WORKER_LABEL attempted from release $PIN (old pid $OLD_PID); the plist stays rewritten, there is no rollback"
  checkpoint
  install_out="$(cd "$release" && timeout "$WORKER_INSTALL_TIMEOUT_SECONDS" "$runtime" "$release/dist/src/cli.js" worker install --replace-label "$WORKER_LABEL" --workspace "$WORKSPACE" 2>&1)" \
    || { printf '%s\n' "$install_out" > "$RUN_DIR/worker-install.log"; refuse "the protected worker install or restart failed: the worker may be down or still source-run; production stays Off and no renewal ran"; }
  printf '%s\n' "$install_out" > "$RUN_DIR/worker-install.log"
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
  EXPECTED_HEAD="$PIN"
  check_runtime_current
  check_production_off
}

# Decision 0161 (option A), after the bound restart: reuse a fresh receipt of this bound worker, or run the Decision 0143
# sequence exactly once (claim this press's own sequence record, one Haiku renewal, one bound-worker usage check). No retry.
phase_p4_sign_in() {
  local out decision changed
  phase P4 sign_in
  BOUND_HANDLER="$(jq -r '.binding.handlerHash' "$RUN_DIR/worker-binding.json")"
  # Decision 0143's Off / zero-admission / no-Session guards, fresh, before the day can be claimed.
  check_production_off
  check_no_competing_session "before the sign-in sequence"
  check_capacity
  SIGN_IN_ATTEMPTED=true
  mutated "Decision 0161 sign-in sequence invoked: reuses a fresh receipt of the bound worker, or claims this press's own sequence record before one Haiku renewal and, only on its success, publishes one diagnostic Decision to main and has the bound worker check usage once; a failure consumes this press's sequence, with no retry"
  checkpoint
  out="$(arcadia_t "$SIGN_IN_TIMEOUT_SECONDS" "${SIGN_IN_ARGS[@]}" --json 2> "$RUN_DIR/sign-in.stderr")" \
    || { printf '%s\n' "$out" > "$RUN_DIR/sign-in-result.json"; refuse "the sign-in sequence did not succeed, so there is no START: $(cli_failure "$RUN_DIR/sign-in.stderr")"; }
  printf '%s\n' "$out" > "$RUN_DIR/sign-in-result.json"
  jq -e '.ok == true and .data.mode == "run" and (.data.outcome == "reused" or .data.outcome == "checked")' <<<"$out" >/dev/null || refuse "the sign-in sequence returned no usable result; there is no START"
  rec signIn "$(jq -c '.data | {outcome, date, sequenceClaimed, decision, digest, nonce, publicationHead}' <<<"$out")"
  SIGN_IN_RECEIPT="$(jq -c '.data.receipt' <<<"$out")"
  check_signin_receipt
  # The only change the sequence may make to the checkout is its published diagnostic Decision (two commits, checked by the sequence).
  if [[ "$(jq -r '.data.outcome' <<<"$out")" == checked ]]; then
    decision="$(jq -er '.data.decision' <<<"$out")" || refuse "the sign-in sequence named no diagnostic Decision"
    EXPECTED_HEAD="$(jq -er '.data.publicationHead' <<<"$out")" || refuse "the sign-in sequence named no publication head"
    changed="$(git_repo diff --name-only "$PIN" "$EXPECTED_HEAD")"
    [[ "$changed" == "docs/decisions/$decision.md" ]] || refuse "the sign-in records changed more than the diagnostic Decision: $changed"
    mutated "this press's renewal sequence consumed; one Haiku renewal ran; diagnostic Decision docs/decisions/$decision.md published to main at $EXPECTED_HEAD; one bound-worker usage check ran"
  else
    mutated "no renewal: a fresh usage receipt of the bound worker was reused; no renewal sequence was claimed"
  fi
  [[ "$(git_repo rev-parse HEAD)" == "$EXPECTED_HEAD" && -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main checkout moved or changed during the sign-in sequence"
  [[ "$(timeout 30 git -C "$ARCADIA_REPO" ls-remote origin refs/heads/main | cut -f1)" == "$EXPECTED_HEAD" ]] || refuse "origin main is not the checkout after the sign-in sequence"
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
  [[ "$(git_repo rev-parse HEAD)" == "$EXPECTED_HEAD" && -z "$(git_repo status --porcelain=v1 --untracked-files=all)" ]] || refuse "main moved or became dirty before the Plan activation"
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
  check_signin_receipt  # REF:L245-L248, L364 as replaced by Decision 0161, again at the START: receipt bytes, bound worker, expiry and windows
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
  check_day_window "the day ended before activation; no activation"
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
  # Fixture-only shortening of the two bounded waits: honoured solely when this exact marker file exists inside the card's own library.
  # check-operator-scripts fails if the marker exists in a real library, so a real run can never take this branch.
  if [[ -f "$LIBRARY_DIR/.start-run-test-fixture" ]]; then
    local fixture_wait; fixture_wait="$(<"$LIBRARY_DIR/.start-run-test-fixture")"
    if [[ "$fixture_wait" =~ ^[0-9]+$ ]]; then WORKER_WAIT_SECONDS="$fixture_wait"; TRANSPORT_WAIT_SECONDS="$fixture_wait"; fi
  fi
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
  DELEGATION="$(jq -c '.startRun.delegation // null' "$DESCRIPTOR")"
  DELEGATION_DECISION="$(jq -r '.decision // ""' <<<"$DELEGATION")"
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
  phase_p4_sign_in
  phase_p5
  phase_p6
  return 0
}
main "$@"; exit $?
