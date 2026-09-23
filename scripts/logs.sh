#!/usr/bin/env bash
#
# Follow Arcadia's service logs in one terminal.
#
#   scripts/logs.sh [all|worker|errors|dashboard|intelligence|discord]   (pnpm logs ...)
#   scripts/logs.sh session [name]
#
# all (default) follows every managed service's stdout and stderr, each line
# prefixed with its source. `session` attaches read-only to a live coding-agent
# Session's tmux pane: you watch exactly what the agent sees, and keystrokes are
# not sent to it. Detach with Ctrl-b d.
#
# Read-only: this never starts, stops, or signals anything.

set -euo pipefail

TARGET="${1:-all}"
LINES="${LOG_LINES:-20}"

# The service logs are keyed by the main checkout's path (see the
# restart-arcadia-services script), so resolve it even from a worktree.
common_dir="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --path-format=absolute --git-common-dir)"
MAIN_CHECKOUT="$(dirname "$common_dir")"
LOG_DIR="$HOME/Library/Logs/arcadia-services-$(printf '%s' "$MAIN_CHECKOUT" | cksum | awk '{print $1}')"

if [[ "$TARGET" == "session" ]]; then
  sessions="$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^arcadia-' || true)"
  if [[ -z "$sessions" ]]; then
    echo "No live coding-agent Session (no arcadia-* tmux session)." >&2
    exit 1
  fi
  name="${2:-$(printf '%s\n' "$sessions" | tail -1)}"
  if ! printf '%s\n' "$sessions" | grep -qx "$name"; then
    echo "No live Session named $name. Live Sessions:" >&2
    printf '  %s\n' $sessions >&2
    exit 1
  fi
  if [[ "$(printf '%s\n' "$sessions" | wc -l)" -gt 1 && -z "${2:-}" ]]; then
    echo "Several live Sessions; attaching to the newest. Others:" >&2
    printf '%s\n' "$sessions" | grep -vx "$name" | sed 's/^/  /' >&2
  fi
  exec tmux attach-session -r -t "=$name:"
fi

case "$TARGET" in
  all) patterns=("*.out.log" "*.err.log") ;;
  worker) patterns=("worker.out.log" "worker.err.log") ;;
  errors) patterns=("*.err.log") ;;
  dashboard | intelligence) patterns=("$TARGET.out.log" "$TARGET.err.log") ;;
  discord) patterns=("discord-bot.out.log" "discord-bot.err.log") ;;
  *)
    echo "usage: $0 [all|worker|errors|dashboard|intelligence|discord] | session [name]" >&2
    exit 2
    ;;
esac

if [[ ! -d "$LOG_DIR" ]]; then
  echo "No service logs at $LOG_DIR. Are the services installed? (scripts/services.sh status)" >&2
  exit 1
fi

files=()
shopt -s nullglob
for pattern in "${patterns[@]}"; do files+=("$LOG_DIR"/$pattern); done
shopt -u nullglob
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No logs matching '$TARGET' in $LOG_DIR" >&2
  exit 1
fi

echo "Following ${#files[@]} log(s) in $LOG_DIR (Ctrl-C to stop)" >&2
# tail's "==> file <==" headers become a per-line source prefix. The macOS
# keychain "trust settings" lines are noise from every CLI start and are dropped.
tail -n "$LINES" -F "${files[@]}" 2>/dev/null |
  awk '
    /^==> .* <==$/ { n = split($2, part, "/"); src = part[n]; sub(/\.log$/, "", src); next }
    /failed to copy trust settings of system certificate/ { next }
    NF { printf "%-18s %s\n", src, $0; fflush() }
  '
