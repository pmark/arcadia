#!/usr/bin/env bash
# Shared executor of every standing-grant card (Decision 0241, options A, B and E). A card is the three-line launcher
# src/operatorActions/startRunDayGrant.ts#standingGrantLauncher plus a descriptor whose `standingGrant` block carries the pins.
#
#   standing-grant.sh run        <descriptor.json>   the operator's press: verify, consume the one-shot marker, write the approval receipt
#   standing-grant.sh preflight  <descriptor.json>   the same checks with no press record and no consumption
#   standing-grant.sh --describe <descriptor.json>   print the descriptor
#
# The press does one thing: it records the operator's standing approval for Rowan's presses of START cards on the named Plan at
# concurrency one. It has no 24-hour window and no end of its own: it ends only on an operator STOP card, an operator-issued Off or
# a press of the revoke card (src/operatorActions/startRunDayGrant.ts decides). It refuses unless Decision 0241 is answered A, B
# or E in this checkout. It turns nothing on, starts no Session and changes no production state, so the only mutations are this
# run's own files and the card's one-shot marker.
#
# Only an operator press counts. Nothing here can prove who pressed: this deployment has no identity layer. It requires
# what the /actions runner records for a press from a browser at a non-loopback address with no delegated marker, the same proof
# scripts/day-grant.sh requires. That stops accidents, not an agent set on forging it.
set -Eeuo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
ARCADIA_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PRESS_RECORD_MAX_AGE_MS=120000
STANDING_SLUG="may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so"

CONSUMED=false
REASON=""
RECORD='{}'
PHASE=checks
rec() { RECORD="$(jq -c --arg k "$1" --argjson v "$2" '.[$k] = $v' <<<"$RECORD")"; }
rec_str() { rec "$1" "$(jq -n --arg v "$2" '$v')"; }

json_envelope() {
  node -e 'const b=[];process.stdin.on("data",c=>b.push(c)).on("end",()=>{const s=Buffer.concat(b).toString("utf8");
try{JSON.parse(s);process.stdout.write(s);return}catch{}
for(const i of [...s.matchAll(/^\{/gm)].map(m=>m.index).reverse()){try{JSON.parse(s.slice(i));process.stdout.write(s.slice(i));return}catch{}}
process.stdout.write(s)})'
}
arcadia() { (cd "$ARCADIA_REPO" && timeout 180 mise exec -- pnpm -s arcadia "$@" | json_envelope); }
# The frontmatter only: a Decision's or Plan's body may quote any answer or status.
frontmatter_json() {
  (cd "$ARCADIA_REPO" && node -e 'const {parse}=require("yaml");let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const m=/^---\r?\n([\s\S]*?)\r?\n---/.exec(s);if(!m)process.exit(2);process.stdout.write(JSON.stringify(parse(m[1])))})')
}

# Returns the write's status. A refusal's own receipt is best effort; the receipts a press relies on are checked by their callers.
write_receipt() {
  jq -n --arg id "${ID:-unknown}" --arg runId "${RUN_ID:-unknown}" --arg mode "${MODE:-unknown}" --arg started "${STARTED_AT:-}" \
    --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg outcome "$1" --arg phase "$PHASE" --argjson consumed "$CONSUMED" --arg reason "$REASON" --argjson record "$RECORD" \
    '{schema: "arcadia-standing-grant-receipt-v1", id: $id, runId: $runId, mode: $mode, startedAt: $started, updatedAt: $updated,
      outcome: $outcome, phase: $phase, allowanceConsumed: $consumed, reason: $reason, record: $record}' \
    > "${RECEIPT}.tmp" 2>/dev/null && mv "${RECEIPT}.tmp" "$RECEIPT" 2>/dev/null
}
refuse() {
  REASON="$*"
  trap - ERR
  echo "REFUSED: $*" >&2
  write_receipt refused || echo "The refusal's receipt could not be written to $RECEIPT." >&2
  exit 1
}
on_error() {
  local code=$? command="$BASH_COMMAND"
  trap - ERR
  REASON="command failed (exit $code): $command"
  write_receipt refused || echo "The refusal's receipt could not be written to $RECEIPT." >&2
  exit "$code"
}

check_press_record() {
  local dir out
  dir="${ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY:-}"
  [[ "${ARCADIA_OPERATOR_SCRIPT_ID:-}" == "$ID" && -n "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" && -f "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR:-}" ]] || refuse "launch this card from the /actions operator-action library"
  [[ "$(cd "$(dirname "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR")" && pwd -P)/$(basename "$ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR")" == "$DESCRIPTOR" ]] || refuse "the launching descriptor is not this card's descriptor"
  [[ -z "${CODEX_SANDBOX:-}" ]] || refuse "host-only card: an agent sandbox may not run it"
  [[ -n "${ARCADIA_OPERATOR_SCRIPT_RUN_ID:-}" && -n "$dir" && -f "$dir/run.json" ]] || refuse "there is no operator press record for this run; press this card on the /actions page"
  out="$(node -e '
const fs=require("fs"),p=require("path");
const [dir,runId,id,ppid,maxAgeMs,descriptor]=process.argv.slice(1);
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
if(fs.existsSync(p.join(dir,"standing-grant.claimed")))fail("the operator press record is already claimed");
if(r.press!==undefined)fail("a delegated press never counts as the operator standing approval");
if(r.browserPress!==true)fail("the standing approval is the operator press on the /actions page in a browser at the Tailnet address; this press record does not show one");
process.stdout.write(JSON.stringify({startedAt:r.startedAt}));
' "$dir" "$ARCADIA_OPERATOR_SCRIPT_RUN_ID" "$ID" "$PPID" "$PRESS_RECORD_MAX_AGE_MS" "${ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR:-}")" || refuse "${out:-the operator press record could not be checked}"
  PRESS_WINDOW="$out"
  OPERATOR_RUN_ID="$ARCADIA_OPERATOR_SCRIPT_RUN_ID"
  OPERATOR_RUN_DIR="$dir"
  rec_str operatorRunId "$OPERATOR_RUN_ID"
}

check_authority() {
  local executor_pin plan project decision decision_fm project_fm plan_fm status matches
  jq -e '.schema == "arcadia-operator-script-v1" and .kind == "grant" and .standingGrant.schema == "arcadia-standing-grant-v1" and .standingGrant.decision == "0241" and .standingGrant.concurrency == 1 and .standingGrant.provider == "claude-code-cli"' "$DESCRIPTOR" >/dev/null || refuse "the descriptor is not a Decision 0241 standing-grant card"
  executor_pin="$(jq -er '.standingGrant.executorSha256' "$DESCRIPTOR")"
  [[ "$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$SELF")" == "$executor_pin" ]] || refuse "this executor is not the one the card pins (standingGrant.executorSha256)"
  [[ ! -e "$ATTEMPT_FILE" ]] || refuse "this standing-grant card is consumed; a new grant needs a new card and a new press"
  node -e 'process.exit(Date.now() < Date.parse(process.argv[1]) ? 0 : 1)' "$(jq -er '.expires_at' "$DESCRIPTOR")" || refuse "this standing-grant card expired unpressed; ask for a fresh card"
  [[ -z "${ARCADIA_WORKSPACE:-}" ]] || refuse "ARCADIA_WORKSPACE is set; the configured workspace must resolve on its own"
  plan="$(jq -er '.standingGrant.plan' "$DESCRIPTOR")"; project="$(jq -er '.standingGrant.project' "$DESCRIPTOR")"
  # The Decision is found by its slug alone, never by a number: exactly one record may carry it.
  matches="$(find "$ARCADIA_REPO/docs/decisions" -maxdepth 1 -name "[0-9][0-9][0-9][0-9]-$STANDING_SLUG.md" -print)"
  [[ -n "$matches" ]] || refuse "the standing-grant Decision (slug $STANDING_SLUG) is not in this checkout"
  [[ "$(wc -l <<<"$matches" | tr -d ' ')" == 1 ]] || refuse "several Decision records share the slug $STANDING_SLUG; stop for the operator"
  decision="$matches"
  decision_fm="$(frontmatter_json < "$decision")" || refuse "the standing-grant Decision's frontmatter could not be read in this checkout"
  jq -e --arg id "$(basename "$decision" | cut -c1-4)" '.status == "approved" and (.id | tostring) == $id and ((.answer // "") | tostring | (startswith("A. Standing grant") or startswith("B. Standing grant") or startswith("E. Standing grant")))' <<<"$decision_fm" >/dev/null \
    || refuse "Decision $(basename "$decision" | cut -c1-4) is not answered A, B or E in this checkout"
  project_fm="$(frontmatter_json < "$ARCADIA_REPO/PROJECT.md")" || refuse "PROJECT.md frontmatter could not be read in this checkout"
  jq -e --arg p "$plan" '.active_plan == $p' <<<"$project_fm" >/dev/null || refuse "the Plan $plan is not the Project's active Plan in this checkout"
  [[ -f "$ARCADIA_REPO/docs/plans/$plan.md" ]] || refuse "the Plan $plan is not in this checkout"
  plan_fm="$(frontmatter_json < "$ARCADIA_REPO/docs/plans/$plan.md")" || refuse "the Plan $plan frontmatter could not be read in this checkout"
  jq -e '.status == "active"' <<<"$plan_fm" >/dev/null || refuse "the Plan $plan is not active in this checkout"
  status="$(arcadia production status --json)" || refuse "production status could not be read"
  jq -e '.ok == true and .data.read.status == "ok"' <<<"$status" >/dev/null || refuse "production status is unreadable"
  # The baseline of "only this chain moved production": the check starts here.
  rec policyRevisionAtApproval "$(jq '.data.read.policy.revision' <<<"$status")"
  rec policyEpochAtApproval "$(jq '.data.read.policy.epoch' <<<"$status")"
  rec_str project "$project"; rec_str plan "$plan"
  rec_str provider "$(jq -er '.standingGrant.provider' "$DESCRIPTOR")"; rec_str spendDecision "$(jq -er '.standingGrant.spendDecision' "$DESCRIPTOR")"
}

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
  RECEIPT="$RUN_DIR/receipt.json"
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ATTEMPT_FILE="$LIBRARY_DIR/$ID.consumed.json"
  mkdir -p "$RUN_DIR"
  trap on_error ERR
  write_receipt in_progress || { echo "REFUSED: the receipt $RECEIPT cannot be written; nothing was consumed or approved" >&2; return 1; }

  if [[ "$MODE" == run ]]; then check_press_record; fi
  check_authority
  if [[ "$MODE" == preflight ]]; then
    write_receipt preflight_ok || { echo "REFUSED: the preflight receipt $RECEIPT cannot be written" >&2; return 1; }
    echo "PREFLIGHT OK: nothing was consumed or approved. Receipt: $RECEIPT"
    return 0
  fi
  PHASE=consume
  ( set -C; printf '%s\n' "$RUN_ID" > "$OPERATOR_RUN_DIR/standing-grant.claimed" ) 2>/dev/null || refuse "the operator press record was claimed concurrently"
  node -e 'const fs=require("fs"),[file,id,run]=process.argv.slice(1);const fd=fs.openSync(file,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify({state:"CONSUMED",at:new Date().toISOString(),requestId:id,runId:run})+"\n");fs.fsyncSync(fd)}finally{fs.closeSync(fd)}' "$ATTEMPT_FILE" "$ID" "$RUN_ID" \
    || refuse "could not exclusively consume this standing-grant card; nothing was approved"
  CONSUMED=true
  # No window: the press time is recorded and nothing computes an end from it.
  rec_str pressStartedAt "$(jq -r '.startedAt' <<<"$PRESS_WINDOW")"
  rec_str authority "The operator's own press of this standing-grant card from /actions under Decision 0241: Rowan may press START cards on Plan $(jq -r '.standingGrant.plan' "$DESCRIPTOR") at concurrency one with no 24-hour end, until an operator STOP card, an operator-issued Off or the revoke card ends it"
  REASON=""
  # No approved receipt, no grant: START cards read this file. The card is consumed by now and that is harmless, because it
  # changed nothing else: the operator recovers by pressing a new standing-grant card.
  if ! write_receipt approved; then
    echo "REFUSED: this press consumed its card but the approved receipt could not be written to $RECEIPT, so NO grant was approved. Nothing else changed. Fix what stopped the write, then press a new standing-grant card." >&2
    REASON="the approved receipt could not be written; no grant was approved; press a new standing-grant card"
    write_receipt refused || true
    return 1
  fi
  echo "STANDING GRANT APPROVED with no end date. Nothing was started. Receipt: $RECEIPT"
}
main "$@"; exit $?
