#!/usr/bin/env bash
# Wake a coding session when something it is waiting on happens.
#
# Nothing wakes a session on these events: the desktop PR monitor fires only on
# CI failures, conflicts and review comments. Run this in the harness's
# background mode (Claude Code `run_in_background`, or the host's equivalent);
# the harness re-invokes the session when the command exits.
#
#   scripts/wait-for-event.sh pr <owner/repo> <pr> [<pr>...]
#       exits on the first listed PR to leave OPEN: "PR <n> MERGED <sha>" or "PR <n> CLOSED"
#   scripts/wait-for-event.sh press <card-id> [<operator-scripts dir>]
#       exits on the card's next pressed run (not a preflight): "PRESS <card> <run> <outcome> <phase>"
#   scripts/wait-for-event.sh production
#       exits when production's state or policy revision changes: "PRODUCTION <state> rev <n> (was ...)"
#
# Read-only: it runs `gh pr view`, `arcadia production status --json` and reads
# run receipts. Polls every WAIT_INTERVAL seconds (default 60) and skips a failed
# read. After WAIT_TIMEOUT seconds (default 21600, 6 hours) it prints TIMEOUT and
# exits 3, so silence never looks like success. A bounded watch the operator
# asked for (2026-11-06); it decides and changes nothing.
set -u
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
kind=${1:-}; [ -n "$kind" ] && shift
interval=${WAIT_INTERVAL:-60}
deadline=$(( $(date +%s) + ${WAIT_TIMEOUT:-21600} ))
timeout_check() { if [ "$(date +%s)" -ge "$deadline" ]; then echo "TIMEOUT waiting on $kind $*"; exit 3; fi; }

production_snapshot() {
  arcadia production status --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const d = JSON.parse(s.slice(s.indexOf("{"))).data;
        const p = (d.read && d.read.policy) || {};
        process.stdout.write(`${d.display.state} rev ${p.revision}`);
      } catch { process.exit(1); }
    });'
}

press_runs() { # pressed (mode "run") receipts for a card, one "<run> <outcome> <phase>" per line
  local dir=$1/runs/$2 r
  [ -d "$dir" ] || return 0
  for r in "$dir"/*/receipt.json; do
    [ -f "$r" ] || continue
    node -e 'const r = require(process.argv[1]); if (r.mode === "run") console.log(`${process.argv[2]} ${r.outcome || r.status} ${r.phase}`)' "$r" "$(basename "$(dirname "$r")")" 2>/dev/null
  done | sort
}

case $kind in
  pr)
    [ "$#" -ge 2 ] || usage
    repo=$1; shift
    while :; do
      for n in "$@"; do
        s=$(gh pr view "$n" --repo "$repo" --json state,mergeCommit --jq '.state+" "+(.mergeCommit.oid // "")' 2>/dev/null) || continue
        case $s in MERGED*|CLOSED*) echo "PR $n ${s% }"; exit 0 ;; esac
      done
      timeout_check "$@"; sleep "$interval"
    done ;;
  press)
    [ "$#" -ge 1 ] || usage
    card=$1
    lib=${2:-$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)/artifacts/generated/operator-scripts}
    before=$(press_runs "$lib" "$card")
    while :; do
      now=$(press_runs "$lib" "$card")
      new=$(comm -13 <(echo "$before") <(echo "$now") | head -1)
      [ -n "$new" ] && { echo "PRESS $card $new"; exit 0; }
      timeout_check "$card"; sleep "$interval"
    done ;;
  production)
    before=""
    until before=$(production_snapshot); do timeout_check; sleep "$interval"; done
    while :; do
      sleep "$interval"
      now=$(production_snapshot) || { timeout_check; continue; }
      [ "$now" != "$before" ] && { echo "PRODUCTION $now (was $before)"; exit 0; }
      timeout_check
    done ;;
  *) usage ;;
esac
