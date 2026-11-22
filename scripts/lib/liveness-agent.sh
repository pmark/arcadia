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
  printf '%s\n' production liveness-check --successor-press
  url="$(liveness_dashboard_url "$repo")"
  if [[ -n "$url" ]]; then printf '%s\n' --dashboard-url "$url"; fi
  if [[ -n "${ARCADIA_LIVENESS_STALE_SECONDS:-}" ]]; then printf '%s\n' --stale-seconds "$ARCADIA_LIVENESS_STALE_SECONDS"; fi
}

# The commit the timer's release must contain: the successor-press main-moved
# retry (PR #2776). The timer passes --successor-press, so a release without the
# retry would press cards it cannot recover from a moved main.
LIVENESS_REQUIRED_COMMIT="${ARCADIA_LIVENESS_REQUIRED_COMMIT:-ddfae2b62}"

# <repo> <program and arguments before the command...>: succeeds only when
# production status reads Off (inactive). An unreadable status refuses too.
liveness_production_is_off() {
  local repo="$1" out
  shift
  out="$(cd "$repo" && "$@" production status --json 2>/dev/null)" || out=""
  # A here-string, not `printf | grep -q`: grep -q exits at the first match, and
  # under the caller's pipefail the writer's SIGPIPE (141) on the real, large
  # status JSON would read as "not Off" (#2778 live proof, 2026-11-18).
  if grep -Eq '"desiredState"[[:space:]]*:[[:space:]]*"inactive"' <<<"$out"; then
    return 0
  fi
  echo "liveness-check not changed: production is not Off (or its status could not be read); the timer that presses successor cards is installed only while production is Off." >&2
  return 1
}

# <leading directory or ""> prints the PATH the timer runs under, so the tools its
# code path starts by bare name resolve: gh (src/production/productionSuccessor.ts,
# main's checks), node and pnpm (the replay step), and tmux and claude (a relay
# launch, not wired yet). launchd gives a job nothing but this value. Directories
# come from where the tools are now, so no user's home is assumed: the leading
# one, the mise shims directory when it exists, each tool's directory, then the
# system ones, each once. A missing gh, node or pnpm refuses, naming it: the timer
# would otherwise skip every press in silence. Builtins only, so a test can run it
# under a PATH of stubs.
liveness_path_value() {
  local lead="${1:-}" shims search="$PATH" spec tool need found dir path_value=""
  local -a dirs=() parts=()
  shims="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/shims"
  [[ -n "$lead" ]] && dirs+=("$lead")
  if [[ -d "$shims" ]]; then dirs+=("$shims"); search="$shims:$search"; fi
  IFS=: read -r -a parts <<<"$search"
  for spec in "gh|required|the successor step reads main's checks with it" "node|required|the timer's arcadia commands run on it" "pnpm|required|the replay step runs it" "tmux|optional|a relay launch will need it, but is not wired yet" "claude|optional|a relay launch will need it, but is not wired yet"; do
    IFS='|' read -r tool need _ <<<"$spec"
    # Walk the directories, not `type -P`: bash 3.2 answers that from its hash
    # table and ignores a temporary PATH.
    found=""
    for dir in ${parts[@]+"${parts[@]}"}; do
      if [[ "$dir" == /* && -x "$dir/$tool" && ! -d "$dir/$tool" ]]; then found="$dir/$tool"; break; fi
    done
    if [[ "$found" == /* ]]; then
      dirs+=("${found%/*}")
    elif [[ "$need" == required ]]; then
      echo "liveness-check not changed: required tool $tool was not found on PATH (${spec##*|}); install it, or run this from a shell where it resolves." >&2
      return 1
    else
      echo "note: $tool was not found on PATH, so the timer's PATH omits it (${spec##*|})." >&2
    fi
  done
  dirs+=(/usr/bin /bin /usr/sbin /sbin)
  for dir in "${dirs[@]}"; do
    [[ "$dir" == /* && ":$path_value:" != *":$dir:"* ]] && path_value="${path_value:+$path_value:}$dir"
  done
  printf '%s' "$path_value"
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
