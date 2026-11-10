#!/usr/bin/env bash
# Names the holder of the workspace's worker lock for `scripts/services.sh status`, sourced, not run.
#
# Issue #2183: a stale com.arcadia.worker launchd job held the worker pidfile, so the managed worker logged "Worker
# already running" and exited, and status said only `worker: stopped`. This reads the pidfile and, when its owner is a
# live process, names it (the launchd job when there is one) and prints the operator's remedy. It is read-only: it
# lists launchd jobs and processes and never boots out, kills or restarts anything.
#
# It lives here, not in scripts/restart-services-impl.sh, because that file's bytes are pinned by the terminal-Off
# operator action (ARCADIA_RESTART_IMPL_SHA256); a status-only diagnosis must not change a pinned restart path.

# worker_lock_holder_note <repo> <workspace>: prints nothing unless the pidfile names a live process.
worker_lock_holder_note() {
  local repo="$1" workspace="$2" pidfile raw pid label command domain managed key
  pidfile="$workspace/.arcadia/worker.pid"
  [[ -n "$workspace" && -f "$pidfile" ]] || return 0
  # The pidfile is a JSON record ({"pid":N,"owner":...,"at":...}); workers from before ownership records wrote a bare PID.
  raw="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"
  if [[ "$raw" =~ ^[1-9][0-9]*$ ]]; then
    pid="$raw"
  else
    pid="$(printf '%s' "$raw" | sed -n 's/.*"pid":\([1-9][0-9]*\).*/\1/p')"
  fi
  [[ -n "$pid" ]] || return 0
  # Alive: signal 0 succeeds, or (EPERM for a sandboxed caller) ps still lists it.
  if ! kill -0 "$pid" 2>/dev/null && [[ -z "$(ps -p "$pid" -o pid= 2>/dev/null | tr -d '[:space:]')" ]]; then
    return 0
  fi
  domain="gui/$(id -u)"
  key="$(printf '%s' "$repo" | cksum | awk '{print $1}')"
  managed="com.arcadia.local.${key}.worker"
  label="$(launchctl list 2>/dev/null | awk -v p="$pid" '$1 == p { print $3; exit }')"
  if [[ -n "$label" ]]; then
    echo "  lock held by pid $pid (launchd job $label), not this checkout's managed worker."
    echo "  to retire it, run: launchctl bootout ${domain}/${label}   (then move its plist out of ~/Library/LaunchAgents so it cannot return at login)"
  else
    command="$(ps -p "$pid" -o command= 2>/dev/null | head -n 1 | cut -c 1-160)"
    echo "  lock held by pid $pid (not a launchd job${command:+: $command}), not this checkout's managed worker."
    echo "  stop that process first."
  fi
  echo "  then start the managed worker: launchctl kickstart -k ${domain}/${managed}"
}
