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
#       exits when production's state or policy revision changes: "PRODUCTION <state> rev <n> (was ...)",
#       or when a new operator escalation appears for an in-scope Action (any Action while no
#       scope is active), such as a red required check, which changes neither:
#       "PRODUCTION <state> rev <n> ESCALATION <project/action> <kind>"
#   scripts/wait-for-event.sh production --edges
#       opt-in, quieter: exits only on a class change (active_* <-> inactive_*), the same new
#       escalation, or a changed scope: "PRODUCTION <state> rev <n> SCOPE <k> actions (was <j>)".
#       An idle/building flip or a revision bump alone does not exit
#   scripts/wait-for-event.sh ready <owner/repo> <pr> [<pr>...]
#       exits on the first PR that is ready to merge or dead, one line, proof= last:
#       "EVENT ready <pr> <head> next=<arcadia work merge-check --pr <n>|operator-merge> proof=<url>"
#       (open, not draft, newest marker "Independent review, head <full 40-char head>:" says PASS,
#       no worker FAIL, every check green, merge state CLEAN), or
#       "EVENT blocked <pr> <head> reason=<worker-fail|review-fail|checks-fail> proof=<url|checks>",
#       or the pr-mode "PR <n> MERGED <sha>" / "PR <n> CLOSED"
#
# Read-only: it runs `gh pr view`, `gh api`, `arcadia production status --json` and reads
# run receipts. Polls every WAIT_INTERVAL seconds (default 60) and skips a failed
# read. After WAIT_TIMEOUT seconds (default 21600, 6 hours) it prints TIMEOUT and
# exits 3, so silence never looks like success. Once its baseline is taken it
# prints one "WATCHING ..." line to stderr, and it notes its first failed read
# there too. A bounded watch the operator asked for (2026-11-06); it decides and
# changes nothing.
set -u
usage() { sed -n '2,/^[^#]/{/^#/p;}' "$0" | sed 's/^# \{0,1\}//'; exit 2; } # the whole leading comment block
kind=${1:-}; [ -n "$kind" ] && shift
interval=${WAIT_INTERVAL:-60}
deadline=$(( $(date +%s) + ${WAIT_TIMEOUT:-21600} ))
timeout_check() { if [ "$(date +%s)" -ge "$deadline" ]; then echo "TIMEOUT waiting on $kind $*"; exit 3; fi; }
failed_once=""
read_failed() { [ -n "$failed_once" ] || { failed_once=1; echo "wait-for-event: a $kind read failed; retrying until TIMEOUT" >&2; }; }

production_snapshot() { # "<state> rev <n>", then ";<project/action> <kind>" per escalation, sorted; $1=edges leads with "scope=<sorted,joined|null>;"
  arcadia production status --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const d = JSON.parse(s.slice(s.indexOf("{"))).data;
        const state = d.display.state, rev = d.read.policy.revision;
        if (typeof state !== "string" || typeof rev !== "number") process.exit(1);
        const scope = Array.isArray(d.read.policy.scope?.actions) ? d.read.policy.scope.actions : null;
        const escalations = (Array.isArray(d.operatorEscalations) ? d.operatorEscalations : [])
          .filter((e) => typeof e?.actionKey === "string" && typeof e?.kind === "string")
          .filter((e) => !scope || scope.includes(e.actionKey))
          .map((e) => `${e.actionKey} ${e.kind}`.replace(/;/g, ","));
        const lead = process.argv[1] === "edges" ? [`scope=${scope ? [...scope].sort().join(",").replace(/;/g, ",") : "null"}`] : [];
        process.stdout.write([...lead, `${state} rev ${rev}`, ...[...new Set(escalations)].sort()].join(";"));
      } catch { process.exit(1); }
    });' "${1:-}"
}

state_class() { case ${1%% *} in active_*) echo active ;; inactive_*) echo inactive ;; esac; } # observation_unavailable and the like have none

scope_count() { case $1 in scope=null) echo null ;; scope=) echo 0 ;; *) local c=${1#scope=}; c=${c//[^,]/}; echo $(( ${#c} + 1 )) ;; esac; } # "scope=a,b" -> 2

ready_event() { # <pr> <pr view json> <comments, one {body,html_url} per line>: the pr-mode line, an EVENT line, or nothing
  node -e '
    const fs = require("fs");
    const [n, viewFile, commentsFile] = process.argv.slice(1);
    const v = JSON.parse(fs.readFileSync(viewFile, "utf8"));
    const comments = fs.readFileSync(commentsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const head = v.headRefOid, url = (c) => c.html_url || "none";
    const out = (s) => { console.log(s); process.exit(0); };
    const blocked = (reason, proof) => out(`EVENT blocked ${n} ${head} reason=${reason} proof=${proof}`);
    if (v.state === "MERGED" || v.state === "CLOSED") out(`PR ${n} ${v.state}${v.mergeCommit?.oid ? ` ${v.mergeCommit.oid}` : ""}`);
    if (v.state !== "OPEN") process.exit(0);
    let worker = null, marker = null; // R4 any worker FAIL for the head; R0/R3 the newest anchored marker for it
    for (const c of comments) {
      const b = c.body || "";
      if (/^\s*Arcadia worker: /.test(b) && b.includes("**Do not merge") && [...b.matchAll(/`([0-9a-f]{7,40})`/g)].some((m) => head.startsWith(m[1]))) worker = c;
      const m = /^[*_\s]*Independent review, head ([0-9a-f]{7,40})/im.exec(b);
      if (m && head.startsWith(m[1])) marker = { c, b, sha: m[1], rest: b.slice(m.index + m[0].length).split("\n")[0] };
    }
    if (worker) blocked("worker-fail", url(worker));
    let pass = false, line = "";
    if (marker) {
      const w = /^\s*:[*_`\s]*([A-Za-z]+)[*_`]*\W*([A-Za-z]+)?/.exec(marker.rest) || [];
      const verdict = (w[1] || "").toUpperCase();
      pass = verdict === "PASS" && (w[2] || "").toUpperCase() !== "WITH";
      const bad = marker.b.split("\n").some((l) => { // R2 a Blocking finding/Blocking: line, unless none, 0 or no
        const m = /^(?:Blocking findings?\b|Blocking:)(.*)$/i.exec(l.replace(/^[*_`>#\- ]+/, ""));
        return m && !["none", "0", "no"].includes(m[1].replace(/^[\s:*_`()-]+/, "").split(/\s/)[0].toLowerCase().replace(/[^a-z0-9]/g, ""));
      });
      if (verdict === "FAIL" || bad) blocked("review-fail", url(marker.c));
      line = marker.rest;
    }
    const states = (v.statusCheckRollup || []).map((x) => (x.conclusion || x.state || x.status || "").toUpperCase());
    if (states.some((s) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(s))) blocked("checks-fail", "checks");
    const green = states.length > 0 && states.every((s) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(s));
    if (v.isDraft || !pass || marker.sha !== head || !green || v.mergeStateStatus !== "CLEAN") process.exit(0); // R6, R1, R2: keep waiting
    const tail = (/PASS[*_`]*\s*[—–-]+\s*(.*)$/i.exec(line) || [])[1] || ""; // R5: anchored lines, or right after "PASS —" on the marker line
    const lead = /^[*_`]*Loosens a gate:\s*no\b[.;,]?\s*(.*)$/i.exec(tail), auth = /^[*_`]*Changes agent authority:\s*no\b/i;
    const loosens = /^\s*[*_`-]*\s*Loosens a gate:\s*no\b/im.test(marker.b) || !!lead;
    const authority = /^\s*[*_`-]*\s*Changes agent authority:\s*no\b/im.test(marker.b) || auth.test(tail) || (!!lead && auth.test(lead[1]));
    out(`EVENT ready ${n} ${head} next=${loosens && authority ? `arcadia work merge-check --pr ${n}` : "operator-merge"} proof=${url(marker.c)}`);
  ' "$@"
}

new_escalation() { # first ";"-separated entry of $2 that $1 lacks
  local entry
  local IFS=";"
  set -f # split on ";" only; never glob an entry against the working directory
  for entry in $2; do
    case ";$1;" in *";$entry;"*) ;; *) set +f; echo "$entry"; return ;; esac
  done
  set +f
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
  ready)
    [ "$#" -ge 2 ] || usage
    repo=$1; shift
    tmp=$(mktemp -d) || exit 1
    trap 'rm -rf "$tmp"' EXIT
    echo "WATCHING ready $repo $*" >&2
    while :; do
      for n in "$@"; do
        { gh pr view "$n" --repo "$repo" --json state,isDraft,headRefOid,mergeStateStatus,statusCheckRollup,mergeCommit >"$tmp/view" 2>/dev/null &&
          gh api --paginate "repos/$repo/issues/$n/comments" --jq '.[] | {body, html_url}' >"$tmp/comments" 2>/dev/null &&
          out=$(ready_event "$n" "$tmp/view" "$tmp/comments"); } || { read_failed; continue; }
        [ -n "$out" ] && { echo "$out"; exit 0; }
      done
      timeout_check "$@"; sleep "$interval"
    done ;;
  production)
    edges=""; [ "${1:-}" = --edges ] && edges=edges
    before=""
    if [ -n "$edges" ]; then # quieter: only a class change, a new escalation or a scope change exits; each other update replaces the baseline
      until before=$(production_snapshot edges) && [ -n "$(state_class "${before#*;}")" ]; do read_failed; timeout_check; sleep "$interval"; done
      echo "WATCHING production ${before#*;}" >&2
      while :; do
        sleep "$interval"
        now=$(production_snapshot edges) || { read_failed; timeout_check; continue; }
        [ -n "$(state_class "${now#*;}")" ] || { read_failed; timeout_check; continue; } # no class: keep the last known one
        b=${before#*;} n=${now#*;}
        [ "$(state_class "$b")" != "$(state_class "$n")" ] && { echo "PRODUCTION ${n%%;*} (was ${b%%;*})"; exit 0; }
        added=$(new_escalation "${b#"${b%%;*}"}" "${n#"${n%%;*}"}") # the escalations alone: a state or revision change is not one
        [ -n "$added" ] && { echo "PRODUCTION ${n%%;*} ESCALATION $added"; exit 0; }
        [ "${before%%;*}" != "${now%%;*}" ] && { echo "PRODUCTION ${n%%;*} SCOPE $(scope_count "${now%%;*}") actions (was $(scope_count "${before%%;*}"))"; exit 0; }
        before=$now
        timeout_check
      done
    fi
    until before=$(production_snapshot); do read_failed; timeout_check; sleep "$interval"; done
    echo "WATCHING production ${before%%;*}" >&2
    while :; do
      sleep "$interval"
      now=$(production_snapshot) || { read_failed; timeout_check; continue; }
      [ "${now%%;*}" != "${before%%;*}" ] && { echo "PRODUCTION ${now%%;*} (was ${before%%;*})"; exit 0; }
      added=$(new_escalation "$before" "$now")
      [ -n "$added" ] && { echo "PRODUCTION ${now%%;*} ESCALATION $added"; exit 0; }
      before=$now # a cleared escalation leaves the baseline, so its return wakes the session
      timeout_check
    done ;;
  *) usage ;;
esac
