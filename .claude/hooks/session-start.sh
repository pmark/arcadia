#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# This repository pins its toolchain with mise (mise.toml) and every
# `package.json` script that needs it runs through `mise exec --`. Cloud
# Claude Code containers do not ship mise, and this environment's egress
# policy blocks mise.run (curl to it returns 403 "policy denial"), so mise
# cannot be installed here either -- see
# docs/proposals/cloud-session-workspace-friction.md for the friction this
# caused across two prior sessions before this hook existed.
#
# The container's preinstalled Node/pnpm already satisfy what mise would
# have activated closely enough (verified: better-sqlite3's prebuild-install
# binary loads without a rebuild). So instead of installing real mise, this
# shims a `mise` binary that only understands the one form this repo's
# scripts actually use -- `mise exec -- <command...>` -- and runs the
# command directly. Local operator machines are untouched: this only runs
# under Claude Code's remote/web environment, and a real `mise` on PATH
# always wins.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v mise >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/bin"
  cat > "$HOME/.local/bin/mise" << 'SHIM'
#!/bin/bash
# Passthrough shim -- see .claude/hooks/session-start.sh for why this exists.
if [ "${1:-}" = "exec" ]; then
  shift
  while [ "${1:-}" = "--" ]; do
    shift
  done
  exec "$@"
fi
exec true
SHIM
  chmod +x "$HOME/.local/bin/mise"
fi

export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

cd "$CLAUDE_PROJECT_DIR"
pnpm install
