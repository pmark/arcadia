#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="/Users/pmark/Dev/MR/Arcadia/arcadia"
ACTION="${1:-restart}"
REPO_ARG="${2:-$DEFAULT_REPO}"

usage() {
  echo "Usage: $0 [restart|stop|status] [arcadia-repository-path]" >&2
}

case "$ACTION" in
  restart|stop|status) ;;
  *) usage; exit 2 ;;
esac
if [[ $# -gt 2 ]]; then
  usage
  exit 2
fi

if [[ ! -d "$REPO_ARG" ]]; then
  echo "Not an Arcadia checkout: directory does not exist: $REPO_ARG" >&2
  exit 2
fi
# The Arcadia workspace this checkout's worker/intelligence services must
# govern. This is deliberately independent of the operator's ambient
# `defaultWorkspace` (`arcadia config set defaultWorkspace ...`): that default
# tracks whatever workspace the operator is driving interactively right now,
# and can point at a different portfolio entirely. Without an explicit
# `--workspace` here, `worker start`/`intelligence serve` silently fell back to
# that ambient default, so this checkout's own preservation heartbeat
# (`<workspace>/.arcadia/preservation.heartbeat`) went stale and every
# `arcadia go`/`arcadia advance` request from this repo failed with
# "Protected Arcadia go request path is unavailable" even though *a* worker
# was running -- just for the wrong workspace.
ARCADIA_WORKSPACE_DEFAULT="/Users/pmark/Dev/MR/Arcadia/workspaces/arcadia"
WORKSPACE="${ARCADIA_WORKSPACE:-$ARCADIA_WORKSPACE_DEFAULT}"

REPO="$(cd "$REPO_ARG" && pwd -P)"

if [[ "$ACTION" == "restart" && ! -d "$WORKSPACE" ]]; then
  echo "Arcadia workspace not found: $WORKSPACE" >&2
  echo "Set ARCADIA_WORKSPACE to this checkout's real workspace path." >&2
  exit 2
fi

validate_repo() {
  local package_file="$REPO/package.json"
  [[ -f "$package_file" ]] &&
    [[ -f "$REPO/pnpm-workspace.yaml" ]] &&
    [[ -f "$REPO/docs/arcadia-semantics.md" ]] &&
    [[ -f "$REPO/src/commands/intelligence.ts" ]] &&
    [[ -f "$REPO/src/commands/worker.ts" ]] &&
    grep -Eq '"name"[[:space:]]*:[[:space:]]*"@pmark/arcadia"' "$package_file"
}

if ! validate_repo; then
  echo "Not an Arcadia checkout: $REPO" >&2
  echo "Expected @pmark/arcadia plus its workspace, semantics, Intelligence, and worker files." >&2
  exit 2
fi

for required in lsof ps cksum awk sed grep sort head tail tr seq find curl uname id launchctl; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Required command not found: $required" >&2
    exit 2
  fi
done
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script requires launchd and only runs on macOS." >&2
  exit 2
fi

resolve_mise_bin() {
  local configured="${ARCADIA_MISE_BIN:-}"
  local candidate=""

  if [[ -n "$configured" ]]; then
    if [[ "$configured" == */* ]]; then
      printf '%s' "$configured"
    else
      command -v "$configured" || true
    fi
    return 0
  fi

  for candidate in "$(command -v mise 2>/dev/null || true)" /opt/homebrew/bin/mise /usr/local/bin/mise "$HOME/.local/bin/mise"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
}

resolve_legacy_node_bin() {
  local configured="${ARCADIA_NODE_BIN:-}"
  local node_spec="" candidate=""
  if [[ -n "$configured" ]]; then
    if [[ "$configured" == */* ]]; then printf '%s' "$configured"; else command -v "$configured" || true; fi
    return 0
  fi
  if [[ -f "$REPO/.nvmrc" ]]; then
    node_spec="$(tr -d '[:space:]' < "$REPO/.nvmrc" | head -n 1)"
    if [[ "$node_spec" =~ ^v?([0-9]+)(\.[0-9]+)?(\.[0-9]+)?$ ]]; then
      local requested_major="${BASH_REMATCH[1]}" requested_version="${node_spec#v}"
      local nvm_root="${NVM_DIR:-${HOME}/.nvm}/versions/node"
      if [[ "$requested_version" == "$requested_major" ]]; then
        candidate="$(find "$nvm_root" -maxdepth 1 -type d -name "v${requested_major}.*" 2>/dev/null | sort -V | tail -n 1)/bin/node"
      else
        candidate="$nvm_root/v${requested_version}/bin/node"
      fi
      if [[ -x "$candidate" ]]; then printf '%s' "$candidate"; return 0; fi
    fi
  fi
  command -v node || true
}

RUNTIME_MODE="legacy"
MISE_BIN=""
NODE_BIN=""
PNPM_BIN=""
PNPM_VERSION=""

if [[ "$ACTION" == "restart" ]]; then
  if [[ -f "$REPO/mise.toml" ]]; then
    RUNTIME_MODE="mise"
    MISE_BIN="$(resolve_mise_bin)"
    if [[ -z "$MISE_BIN" || ! -x "$MISE_BIN" ]]; then
      echo "Required command not found or not executable: mise" >&2
      echo "Install mise or set ARCADIA_MISE_BIN." >&2
      exit 2
    fi
    "$MISE_BIN" trust "$REPO/mise.toml" >/dev/null
    "$MISE_BIN" -C "$REPO" install >/dev/null
    "$MISE_BIN" -C "$REPO" exec -- corepack enable pnpm >/dev/null
    NODE_BIN="$("$MISE_BIN" -C "$REPO" which node 2>/dev/null || true)"
    PNPM_BIN="$("$MISE_BIN" -C "$REPO" which pnpm 2>/dev/null || true)"
    NODE_VERSION="$("$MISE_BIN" -C "$REPO" exec -- node --version 2>/dev/null || true)"
    PNPM_VERSION="$("$MISE_BIN" -C "$REPO" exec -- pnpm --version 2>/dev/null || true)"
  else
    NODE_BIN="$(resolve_legacy_node_bin)"
    if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
      echo "Required command not found or not executable: node" >&2
      echo "Install the version requested by $REPO/.nvmrc or set ARCADIA_NODE_BIN." >&2
      exit 2
    fi
    NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null || true)"
    PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
    PNPM_VERSION="$(PATH="${NODE_BIN%/*}:$PATH" pnpm --version 2>/dev/null || true)"
  fi
  if [[ ! "$NODE_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Unable to determine Node version from: $NODE_BIN" >&2
    exit 2
  fi
  if [[ ! "$PNPM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Unable to determine pnpm version through: $MISE_BIN" >&2
    exit 2
  fi

  # The pinned Node comes from mise.toml, not package.json.
  #
  # package.json deliberately carries no engines.node -- pnpm's own preflight
  # compared it against whatever Node the ambient pnpm ran under rather than the
  # Node any command actually used, so it warned forever about nothing. See the
  # repository's CLAUDE.md.
  #
  # Reading it here anyway produced an empty first field in a space-separated
  # pair, and `read` with the default IFS collapses leading whitespace: the pnpm
  # version slid into the Node slot and reported "package.json requests major
  # 11.7.0". The pnpm check then silently passed on an empty expectation, so
  # both guards were broken at once. mise.toml is the version that is actually
  # enforced, so it is what this compares against.
  EXPECTED_NODE_VERSION="$(sed -n 's/^[[:space:]]*node[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO/mise.toml" 2>/dev/null | head -n 1)"
  EXPECTED_NODE_MAJOR="${EXPECTED_NODE_VERSION%%.*}"

  # Read as a single value so there is no field to collapse.
  if [[ "$RUNTIME_MODE" == "mise" ]]; then
    EXPECTED_PNPM_VERSION="$("$MISE_BIN" -C "$REPO" exec -- node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(pkg.packageManager ?? "").match(/^pnpm@(.+)$/)?.[1] ?? "");
  ' "$REPO/package.json" 2>/dev/null || true)"
  else
    EXPECTED_PNPM_VERSION="$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(pkg.packageManager ?? "").match(/^pnpm@(.+)$/)?.[1] ?? "");
  ' "$REPO/package.json" 2>/dev/null || true)"
  fi

  ACTUAL_NODE_MAJOR="${NODE_VERSION#v}"
  ACTUAL_NODE_MAJOR="${ACTUAL_NODE_MAJOR%%.*}"
  if [[ -n "$EXPECTED_NODE_MAJOR" && "$ACTUAL_NODE_MAJOR" != "$EXPECTED_NODE_MAJOR" ]]; then
    echo "Node version mismatch: mise.toml pins $EXPECTED_NODE_VERSION but the selected runtime is $NODE_VERSION." >&2
    exit 2
  fi
  if [[ -n "$EXPECTED_PNPM_VERSION" && "$PNPM_VERSION" != "$EXPECTED_PNPM_VERSION" ]]; then
    echo "pnpm version mismatch: package.json requests pnpm@$EXPECTED_PNPM_VERSION but the selected pnpm is $PNPM_VERSION." >&2
    exit 2
  fi
fi

RUNTIME_DIR="${NODE_BIN%/*}"
if [[ "$RUNTIME_MODE" == "mise" ]]; then RUNTIME_DIR="${MISE_BIN%/*}"; fi
TSX_ENTRY="$REPO/node_modules/tsx/dist/cli.mjs"
NEXT_ENTRY="$REPO/apps/dashboard/node_modules/next/dist/bin/next"
DISCORD_TSX_ENTRY="$REPO/apps/discord-bot/node_modules/tsx/dist/cli.mjs"
if [[ "$ACTION" == "restart" ]]; then
  for entry in "$TSX_ENTRY" "$NEXT_ENTRY" "$DISCORD_TSX_ENTRY"; do
    if [[ ! -f "$entry" ]]; then
      echo "Missing service runtime entrypoint: $entry" >&2
      echo "Run pnpm install in the checkout before restarting services." >&2
      exit 2
    fi
  done
  if [[ -d "$REPO/node_modules/better-sqlite3" ]]; then
    if [[ "$RUNTIME_MODE" == "mise" ]]; then
      if ! "$MISE_BIN" -C "$REPO" exec -- node -e 'require("better-sqlite3")' >/dev/null 2>&1; then
        echo "Node/native dependency mismatch: better-sqlite3 cannot load under mise Node $NODE_VERSION." >&2
        echo "Rebuild dependencies with: $MISE_BIN -C $REPO exec -- pnpm rebuild better-sqlite3" >&2
        exit 2
      fi
    elif ! (cd "$REPO" && "$NODE_BIN" -e 'require("better-sqlite3")' >/dev/null 2>&1); then
      echo "Node/native dependency mismatch: better-sqlite3 cannot load under $NODE_BIN ($NODE_VERSION)." >&2
      echo "Rebuild dependencies with: PATH=${NODE_BIN%/*}:\$PATH pnpm rebuild better-sqlite3" >&2
      exit 2
    fi
  fi
fi

REPO_KEY="$(printf '%s' "$REPO" | cksum | awk '{print $1}')"
LOG_DIR="${HOME}/Library/Logs/arcadia-services-${REPO_KEY}"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
mkdir -p "$LOG_DIR" "$LAUNCH_AGENTS_DIR"

UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
SERVICES=(intelligence worker dashboard discord-bot)
STARTED_THIS_ATTEMPT=0

service_port() {
  case "$1" in
    intelligence) echo 4710 ;;
    dashboard) echo 3020 ;;
    *) echo "" ;;
  esac
}

service_url() {
  case "$1" in
    intelligence) echo "http://127.0.0.1:4710/api/intelligence/health" ;;
    dashboard) echo "http://127.0.0.1:3020/" ;;
    *) echo "" ;;
  esac
}

service_label() { printf 'com.arcadia.local.%s.%s' "$REPO_KEY" "$1"; }
plist_for() { printf '%s/%s.plist' "$LAUNCH_AGENTS_DIR" "$(service_label "$1")"; }
out_log_for() { printf '%s/%s.out.log' "$LOG_DIR" "$1"; }
err_log_for() { printf '%s/%s.err.log' "$LOG_DIR" "$1"; }

# --- launchd helpers --------------------------------------------------------

is_loaded() {
  launchctl print "${DOMAIN}/$(service_label "$1")" >/dev/null 2>&1
}

tracked_pid() {
  launchctl print "${DOMAIN}/$(service_label "$1")" 2>/dev/null \
    | awk -F ' = ' '/^[[:space:]]*pid = /{print $2; exit}'
}

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  printf '%s' "$s"
}

print_logs() {
  local service="$1"
  local out err
  out="$(out_log_for "$service")"
  err="$(err_log_for "$service")"
  echo "$service output: $out" >&2
  [[ -s "$out" ]] && tail -n 80 "$out" >&2 || true
  echo "$service errors: $err" >&2
  [[ -s "$err" ]] && tail -n 80 "$err" >&2 || true
}

unload_service() {
  local service="$1"
  local label; label="$(service_label "$service")"
  if is_loaded "$service"; then
    launchctl bootout "${DOMAIN}/${label}" >/dev/null 2>&1 || true
  fi
  # One-time cleanup net for jobs left behind by the old `launchctl submit`
  # scheme, which does not reliably replace or remove itself.
  launchctl remove "$label" >/dev/null 2>&1 || true
  local attempt
  for attempt in $(seq 1 30); do
    is_loaded "$service" || return 0
    sleep 0.1
  done
}

write_plist() {
  local service="$1" workdir="$2"
  shift 2
  local label; label="$(service_label "$service")"
  local out; out="$(out_log_for "$service")"
  local err; err="$(err_log_for "$service")"
  : > "$out"
  : > "$err"

  {
    printf '<?xml version="1.0" encoding="UTF-8"?>\n'
    printf '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    printf '<plist version="1.0">\n<dict>\n'
    printf '  <key>Label</key><string>%s</string>\n' "$(xml_escape "$label")"
    printf '  <key>ProgramArguments</key>\n  <array>\n'
    for arg in "$@"; do
      printf '    <string>%s</string>\n' "$(xml_escape "$arg")"
    done
    printf '  </array>\n'
    printf '  <key>WorkingDirectory</key><string>%s</string>\n' "$(xml_escape "$workdir")"
    printf '  <key>RunAtLoad</key><true/>\n'
    printf '  <key>KeepAlive</key><true/>\n'
    printf '  <key>ThrottleInterval</key><integer>5</integer>\n'
    printf '  <key>StandardOutPath</key><string>%s</string>\n' "$(xml_escape "$out")"
    printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$(xml_escape "$err")"
    printf '  <key>EnvironmentVariables</key>\n  <dict>\n'
    # launchd does not initialize a shell. Migrated checkouts invoke mise as
    # the first ProgramArgument; legacy checkouts retain their resolved Node.
    printf '    <key>PATH</key><string>%s</string>\n' "$(xml_escape "${RUNTIME_DIR}:$PATH")"
    printf '    <key>HOME</key><string>%s</string>\n' "$(xml_escape "$HOME")"
    printf '  </dict>\n'
    printf '</dict>\n</plist>\n'
  } > "$(plist_for "$service")"
}

launch_service() {
  local service="$1"
  local workdir args
  if [[ "$RUNTIME_MODE" == "mise" ]]; then
    # -C sets the cwd of the launched process, not just where mise looks for
    # config, so it overrides the WorkingDirectory written into the plist. Point
    # it at each service's own directory: mise walks upward to find the
    # repository's mise.toml either way, so the runtime is still pinned, while
    # the process keeps the cwd it needs. With -C "$REPO", Next started from the
    # repository root and exited with "Couldn't find any `pages` or `app`
    # directory".
    case "$service" in
      intelligence) workdir="$REPO"; args=("$MISE_BIN" -C "$workdir" exec -- node "$TSX_ENTRY" "$REPO/src/cli.ts" intelligence serve) ;;
      worker) workdir="$REPO"; args=("$MISE_BIN" -C "$workdir" exec -- node "$TSX_ENTRY" "$REPO/src/cli.ts" worker start) ;;
      dashboard) workdir="$REPO/apps/dashboard"; args=("$MISE_BIN" -C "$workdir" exec -- node "$NEXT_ENTRY" dev -H 0.0.0.0 -p 3020) ;;
      discord-bot) workdir="$REPO/apps/discord-bot"; args=("$MISE_BIN" -C "$workdir" exec -- node "$DISCORD_TSX_ENTRY" "$REPO/apps/discord-bot/src/main.ts") ;;
      *) echo "Unknown service: $service" >&2; return 1 ;;
    esac
  else
    case "$service" in
      intelligence) workdir="$REPO"; args=("$NODE_BIN" "$TSX_ENTRY" "$REPO/src/cli.ts" intelligence serve) ;;
      worker) workdir="$REPO"; args=("$NODE_BIN" "$TSX_ENTRY" "$REPO/src/cli.ts" worker start) ;;
      dashboard) workdir="$REPO/apps/dashboard"; args=("$NODE_BIN" "$NEXT_ENTRY" dev -H 0.0.0.0 -p 3020) ;;
      discord-bot) workdir="$REPO/apps/discord-bot"; args=("$NODE_BIN" "$DISCORD_TSX_ENTRY" "$REPO/apps/discord-bot/src/main.ts") ;;
      *) echo "Unknown service: $service" >&2; return 1 ;;
    esac
  fi

  unload_service "$service"
  write_plist "$service" "$workdir" "${args[@]}"
  if ! launchctl bootstrap "$DOMAIN" "$(plist_for "$service")"; then
    echo "$service failed to load into launchd." >&2
    print_logs "$service"
    return 1
  fi
}

wait_for_service() {
  local service="$1"
  local url pid attempt
  url="$(service_url "$service")"
  for attempt in $(seq 1 80); do
    pid="$(tracked_pid "$service" 2>/dev/null || true)"
    if [[ -z "$pid" ]]; then
      echo "$service exited before becoming ready." >&2
      print_logs "$service"
      return 1
    fi
    if [[ -z "$url" ]]; then
      if [[ "$attempt" -ge 6 ]]; then
        return 0
      fi
    elif curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "$service timed out during readiness checks." >&2
  print_logs "$service"
  return 1
}

# --- foreign-process safety net --------------------------------------------
# launchd is authoritative for services we manage. This net only catches
# processes launchd doesn't know about: stragglers from before this script
# adopted launchd, or anything a person started by hand on our ports.

pid_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

pid_owned_by_repo() {
  local cwd; cwd="$(pid_cwd "$1")"
  [[ "$cwd" == "$REPO" || "$cwd" == "$REPO/"* ]]
}

pid_command() { ps -p "$1" -o command= 2>/dev/null || true; }

# The restart may be invoked by an automation host whose long-lived parent
# process has this checkout as its cwd and whose command line mentions one of
# Arcadia's service entrypoints. Never classify this script or any ancestor of
# it as a stray service: terminating the caller aborts the restart immediately
# after stop_all, leaving every managed service unloaded.
is_self_or_ancestor() {
  local candidate="$1" current="$$" parent
  while [[ -n "$current" && "$current" -gt 1 ]]; do
    [[ "$candidate" == "$current" ]] && return 0
    parent="$(ps -p "$current" -o ppid= 2>/dev/null | tr -d ' ' || true)"
    [[ -n "$parent" && "$parent" != "$current" ]] || break
    current="$parent"
  done
  return 1
}

listener_pids() {
  lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

port_conflict_pid() {
  local port="$1" pid
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if ! pid_owned_by_repo "$pid"; then
      echo "$pid"
      return 0
    fi
  done < <(listener_pids "$port")
  return 1
}

check_port_conflicts() {
  local service port conflict
  local failed=0
  for service in intelligence dashboard; do
    port="$(service_port "$service")"
    conflict="$(port_conflict_pid "$port" 2>/dev/null || true)"
    if [[ -n "$conflict" ]]; then
      echo "Conflict: $service port $port is owned by PID $conflict outside $REPO." >&2
      echo "Command: $(pid_command "$conflict")" >&2
      failed=1
    fi
  done
  [[ "$failed" -eq 0 ]]
}

sweep_stray_processes() {
  local pid command
  while read -r pid command; do
    [[ -n "$pid" ]] || continue
    # Filter thousands of unrelated macOS processes before the comparatively
    # expensive cwd lookup. Besides being faster, this keeps a restart within
    # bounded automation execution windows.
    case "$command" in
      *"intelligence serve"*|*"worker start"*|*"arcadia-dashboard dev"*|*"arcadia-discord-bot dev"*|*"src/main.ts"*) ;;
      *) continue ;;
    esac
    is_self_or_ancestor "$pid" && continue
    pid_owned_by_repo "$pid" || continue
    kill -TERM "$pid" 2>/dev/null || true
  done < <(ps -axo pid=,command=)
}

stop_all() {
  local service
  for service in "${SERVICES[@]}"; do
    unload_service "$service"
  done
  sweep_stray_processes
}

rollback() {
  local exit_code=$?
  if [[ "$STARTED_THIS_ATTEMPT" -eq 1 ]]; then
    echo "Restart failed; stopping every Arcadia service started by this attempt." >&2
    stop_all
  fi
  exit "$exit_code"
}

status_all() {
  local service port conflict tracked
  local exit_code=0
  for service in "${SERVICES[@]}"; do
    port="$(service_port "$service")"
    if [[ -n "$port" ]]; then
      conflict="$(port_conflict_pid "$port" 2>/dev/null || true)"
      if [[ -n "$conflict" ]]; then
        echo "$service: port/process conflict outside checkout (PID $conflict, port $port)"
        exit_code=1
        continue
      fi
    fi
    tracked="$(tracked_pid "$service" 2>/dev/null || true)"
    if [[ -n "$tracked" ]]; then
      if [[ -n "$port" ]]; then
        echo "$service: running (pid $tracked; $(service_url "$service"))"
      else
        echo "$service: running (pid $tracked)"
      fi
    else
      echo "$service: stopped"
    fi
  done
  echo "Logs: $LOG_DIR"
  return "$exit_code"
}

case "$ACTION" in
  status)
    status_all
    ;;
  stop)
    stop_all
    if ! check_port_conflicts; then
      exit 1
    fi
    echo "Stopped Arcadia services for $REPO"
    echo "Logs: $LOG_DIR"
    ;;
  restart)
    trap rollback EXIT INT TERM
    stop_all
    check_port_conflicts
    STARTED_THIS_ATTEMPT=1
    for service in "${SERVICES[@]}"; do
      launch_service "$service"
    done
    for service in "${SERVICES[@]}"; do
      wait_for_service "$service"
    done
    # Re-probe HTTP services after all non-HTTP services have survived startup.
    curl -fsS --max-time 2 "$(service_url intelligence)" >/dev/null
    curl -fsS --max-time 2 "$(service_url dashboard)" >/dev/null
    STARTED_THIS_ATTEMPT=0
    trap - EXIT INT TERM
    echo "Arcadia services are ready for $REPO"
    if [[ "$RUNTIME_MODE" == "mise" ]]; then echo "mise: $MISE_BIN"; else echo "Runtime: legacy checkout fallback"; fi
    echo "Node: $NODE_BIN ($NODE_VERSION)"
    echo "pnpm: $PNPM_BIN ($PNPM_VERSION)"
    for service in "${SERVICES[@]}"; do
      pid="$(tracked_pid "$service")"
      url="$(service_url "$service")"
      if [[ -n "$url" ]]; then
        echo "$service: pid $pid — $url"
      else
        echo "$service: pid $pid"
      fi
    done
    echo "Logs: $LOG_DIR"
    ;;
esac
