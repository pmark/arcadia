# The liveness-check launchd agent for scripts/restart-services-impl.sh, sourced,
# not run. Unlike the other services it is a timer, not a daemon: launchd starts
# one short `arcadia production liveness-check` a minute, and it alerts when the
# worker has stopped making progress, so it depends on nothing the worker runs.
#
# It runs a compiled go-broker release rather than the checkout. A release is
# immutable and has its own node_modules and recorded runtime, so a card's
# fast-forward of main or a half-written tree cannot break the one thing that
# reports breakage. Only until a release with the command is installed does it
# fall back to the checkout, through mise like the other services.

LIVENESS_SERVICE="liveness-check"
LIVENESS_INTERVAL_SECONDS=60

liveness_release_runtime() {
  local runtime
  runtime="$(sed -n 's/.*"runtimeExecutable"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/broker-manifest.json" 2>/dev/null | head -n 1)"
  [[ -n "$runtime" && -x "$runtime" ]] || return 1
  printf '%s' "$runtime"
}

# The installed release that has the command, or a non-zero exit.
liveness_release_dir() {
  local home="$1" target dir
  target="$(readlink "$home/.local/bin/arcadia-advance-broker-claude" 2>/dev/null)" || return 1
  dir="$(dirname "$target")"
  [[ -f "$dir/dist/src/commands/productionLiveness.js" && -f "$dir/dist/src/cli.js" ]] || return 1
  liveness_release_runtime "$dir" >/dev/null || return 1
  printf '%s' "$dir"
}

# The operator's Tailnet base, which the Discord bot already holds. Only this one
# key is read from its .env; a timer has no shell, so the plist carries the link.
liveness_dashboard_url() {
  local repo="$1"
  if [[ -n "${ARCADIA_DASHBOARD_URL:-}" ]]; then
    printf '%s' "$ARCADIA_DASHBOARD_URL"
    return 0
  fi
  [[ -f "$repo/apps/discord-bot/.env" ]] || return 0
  local raw
  raw="$(sed -n 's/^ARCADIA_DASHBOARD_URL=//p' "$repo/apps/discord-bot/.env" | tail -n 1)"
  # As dotenv reads it: a quoted value is whole, and an unquoted one ends at `#`.
  case "$raw" in
    \"*) raw="${raw#\"}"; printf '%s' "${raw%%\"*}" ;;
    \'*) raw="${raw#\'}"; printf '%s' "${raw%%\'*}" ;;
    *) raw="${raw%%#*}"; printf '%s' "${raw%"${raw##*[![:space:]]}"}" ;;
  esac
}

# The rule `production liveness-check --stale-seconds` enforces. A value it would
# refuse must not reach the plist, where it would fail every run in silence.
liveness_stale_seconds_valid() {
  local value="${ARCADIA_LIVENESS_STALE_SECONDS:-}"
  [[ -z "$value" ]] && return 0
  [[ "$value" =~ ^[0-9]+$ ]] && (( 10#$value >= 30 ))
}

# The command after the program, one argument per line, for both launch routes.
# It names no workspace on purpose: run from the checkout with launchd's bare
# environment, it resolves the workspace exactly as the worker's agent does.
liveness_command_args() {
  local repo="$1" url
  printf '%s\n' production liveness-check
  url="$(liveness_dashboard_url "$repo")"
  if [[ -n "$url" ]]; then printf '%s\n' --dashboard-url "$url"; fi
  if [[ -n "${ARCADIA_LIVENESS_STALE_SECONDS:-}" ]]; then printf '%s\n' --stale-seconds "$ARCADIA_LIVENESS_STALE_SECONDS"; fi
}

liveness_xml() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  printf '%s' "$s"
}

# <label> <workdir> <PATH> <HOME> <stdout log> <stderr log> <plist file> <NODE_PATH or ""> <argv...>
write_liveness_plist() {
  local label="$1" workdir="$2" path_value="$3" home="$4" out="$5" err="$6" plist="$7" node_path="$8" arg
  shift 8
  {
    printf '<?xml version="1.0" encoding="UTF-8"?>\n'
    printf '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    printf '<plist version="1.0">\n<dict>\n'
    printf '  <key>Label</key><string>%s</string>\n' "$(liveness_xml "$label")"
    printf '  <key>ProgramArguments</key>\n  <array>\n'
    for arg in "$@"; do
      printf '    <string>%s</string>\n' "$(liveness_xml "$arg")"
    done
    printf '  </array>\n'
    printf '  <key>WorkingDirectory</key><string>%s</string>\n' "$(liveness_xml "$workdir")"
    printf '  <key>RunAtLoad</key><true/>\n'
    printf '  <key>StartInterval</key><integer>%s</integer>\n' "$LIVENESS_INTERVAL_SECONDS"
    printf '  <key>StandardOutPath</key><string>%s</string>\n' "$(liveness_xml "$out")"
    printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$(liveness_xml "$err")"
    printf '  <key>EnvironmentVariables</key>\n  <dict>\n'
    printf '    <key>PATH</key><string>%s</string>\n' "$(liveness_xml "$path_value")"
    printf '    <key>HOME</key><string>%s</string>\n' "$(liveness_xml "$home")"
    if [[ -n "$node_path" ]]; then
      printf '    <key>NODE_PATH</key><string>%s</string>\n' "$(liveness_xml "$node_path")"
    fi
    printf '  </dict>\n'
    printf '</dict>\n</plist>\n'
  } > "$plist"
}
