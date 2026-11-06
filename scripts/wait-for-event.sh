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
#       exits when a run of the card that was not there at the start (not a preflight)
#       reaches a final outcome: "PRESS <card> <run> <outcome> <phase>"
#   scripts/wait-for-event.sh production
#       exits when production's state or policy revision changes: "PRODUCTION <state> rev <n> (was ...)"
#
# Read-only: it runs `gh pr view`, `arcadia production status --json` and reads
# run receipts. Polls every WAIT_INTERVAL seconds (default 60) and skips a failed
# read. After WAIT_TIMEOUT seconds (default 21600, 6 hours) it prints TIMEOUT and
# exits 3, so silence never looks like success. Once its baseline is taken it
# prints one "WATCHING ..." line to stderr, and it notes its first failed read
# there too. A bounded watch the operator asked for (2026-11-06); it decides and
# changes nothing.
set -u
usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
kind=${1:-}; [ -n "$kind" ] && shift
interval=${WAIT_INTERVAL:-60}
deadline=$(( $(date +%s) + ${WAIT_TIMEOUT:-21600} ))
timeout_check() { if [ "$(date +%s)" -ge "$deadline" ]; then echo "TIMEOUT waiting on $kind $*"; exit 3; fi; }
failed_once=""
read_failed() { [ -n "$failed_once" ] || { failed_once=1; echo "wait-for-event: a $kind read failed; retrying until TIMEOUT" >&2; }; }

production_snapshot() {
  arcadia production status --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const d = JSON.parse(s.slice(s.indexOf("{"))).data;
        const state = d.display.state, rev = d.read.policy.revision;
        if (typeof state !== "string" || typeof rev !== "number") process.exit(1);
        process.stdout.write(`${state} rev ${rev}`);
      } catch { process.exit(1); }
    });'
}

press_runs() { # pressed (mode "run") receipts for a card, one "<run> <outcome> <phase>" per line
  # A START run rewrites its receipt as it goes (outcome "in_progress" at each checkpoint).
  local dir=$1/runs/$2 r
  [ -d "$dir" ] || return 0
  for r in "$dir"/*/receipt.json; do
    [ -f "$r" ] || continue
    node -e 'const r = require(process.argv[1]); if (r.mode === "run") console.log(`${process.argv[2]} ${r.outcome || r.status} ${r.phase}`)' "$r" "$(basename "$(dirname "$r")")" 2>/dev/null
  done | sort
}

finished_new_runs() { # reads press_runs lines; keeps runs not in $known that have a final outcome
  local run outcome phase
  while read -r run outcome phase; do
    case $known in *" $run "*) continue ;; esac
    [ "$outcome" = in_progress ] || echo "$run $outcome $phase"
  done
}

case $kind in
  pr)
    [ "$#" -ge 2 ] || usage
    repo=$1; shift
    echo "WATCHING pr $repo $*" >&2
    while :; do
      for n in "$@"; do
        s=$(gh pr view "$n" --repo "$repo" --json state,mergeCommit --jq '.state+" "+(.mergeCommit.oid // "")' 2>/dev/null) || { read_failed; continue; }
        case $s in MERGED*|CLOSED*) echo "PR $n ${s% }"; exit 0 ;; esac
      done
      timeout_check "$@"; sleep "$interval"
    done ;;
  press)
    [ "$#" -ge 1 ] || usage
    card=$1
    lib=${2:-$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)/artifacts/generated/operator-scripts}
    known=" $(press_runs "$lib" "$card" | cut -d' ' -f1 | tr '\n' ' ')" # run ids already there, finished or not
    echo "WATCHING press $card in $lib" >&2
    while :; do
      new=$(press_runs "$lib" "$card" | finished_new_runs | head -1)
      [ -n "$new" ] && { echo "PRESS $card $new"; exit 0; }
      timeout_check "$card"; sleep "$interval"
    done ;;
  production)
    before=""
    until before=$(production_snapshot); do read_failed; timeout_check; sleep "$interval"; done
    echo "WATCHING production $before" >&2
    while :; do
      sleep "$interval"
      now=$(production_snapshot) || { read_failed; timeout_check; continue; }
      [ "$now" != "$before" ] && { echo "PRODUCTION $now (was $before)"; exit 0; }
      timeout_check
    done ;;
  *) usage ;;
esac
