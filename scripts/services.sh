#!/usr/bin/env bash
#
# Arcadia's own implementation of the service contract.
# See docs/service-contract.md for what the three verbs must do.
#
#   scripts/services.sh [status|restart|stop]
#
# This is deliberately a thin adapter. The real work — pinning the toolchain,
# writing LaunchAgents that start through `mise exec`, managing logs — already
# lives in the restart-services script and is not reimplemented here. What this
# adds is the standard interface, so Arcadia can control this project the same
# way it controls any other, without knowing anything about launchd.
#
# It never touches git. Bringing the checkout to its base branch is Arcadia's
# job, under a safety contract a shell script has no way to honour.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ACTION="${1:-status}"

case "$ACTION" in
  status | restart | stop) ;;
  *)
    echo "usage: $0 [status|restart|stop]" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  # Honest refusal rather than a confusing launchctl error. The contract is
  # portable; this particular implementation is not, which is exactly why the
  # script belongs to the project rather than to Arcadia.
  echo "Arcadia's services are managed by launchd and only run on macOS." >&2
  echo "On another platform, run the dashboard, worker, and Intelligence processes directly." >&2
  exit 2
fi

# The operator-installed implementation. Kept in one place so its location is a
# single line to change rather than a search.
IMPL="${ARCADIA_RESTART_SCRIPT:-$HOME/.codex/skills/restart-arcadia-services/scripts/restart-services.sh}"

if [[ ! -x "$IMPL" ]]; then
  echo "Service control script not found or not executable: $IMPL" >&2
  echo "Set ARCADIA_RESTART_SCRIPT to its location, or install the restart-arcadia-services skill." >&2
  exit 2
fi

# That script takes <action> <repo>; Rebuster's takes them the other way round.
# Normalizing the argument order is the whole point of this adapter existing.
exec "$IMPL" "$ACTION" "$REPO"
