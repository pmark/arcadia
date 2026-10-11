#!/usr/bin/env bash
# Readiness probing for scripts/restart-services-impl.sh, sourced, not run.
#
# A cold `next dev` dashboard on a loaded host can take far more than 2 s to
# answer its first request. The restart used one `curl --max-time 2` per probe
# and a single final re-probe, so one slow answer failed the restart (curl
# exit 28) and the rollback stopped every service (Issue #430, and again on
# 2026-10-11). Probes now allow READY_PROBE_TIMEOUT seconds each and retry until
# a deadline, so a slow service is waited for and only a dead one fails.

READY_PROBE_TIMEOUT="${ARCADIA_READY_PROBE_TIMEOUT:-10}"
READY_DEADLINE="${ARCADIA_READY_DEADLINE:-180}"
READY_RECHECK_DEADLINE="${ARCADIA_READY_RECHECK_DEADLINE:-60}"

for _setting in READY_PROBE_TIMEOUT READY_DEADLINE READY_RECHECK_DEADLINE; do
  if [[ ! "${!_setting}" =~ ^[1-9][0-9]{0,3}$ ]]; then
    echo "ARCADIA_${_setting} must be a whole number of seconds from 1 to 9999, got: ${!_setting}" >&2
    exit 2
  fi
done
unset _setting

# probe_until_ready <url> <deadline-seconds>: 0 once the URL answers with a
# success status, 1 when the deadline passes first.
probe_until_ready() {
  local url="$1" deadline="$2" start=$SECONDS
  while true; do
    if curl -fsS -o /dev/null --max-time "$READY_PROBE_TIMEOUT" "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( SECONDS - start >= deadline )); then
      return 1
    fi
    sleep 1
  done
}
