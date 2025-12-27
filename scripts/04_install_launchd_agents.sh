#!/usr/bin/env bash
set -euo pipefail

PLIST_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/launchd"
PLIST_DST_DIR="${HOME}/Library/LaunchAgents"

mkdir -p "${PLIST_DST_DIR}"

echo "Installing launchd agents"
cp "${PLIST_SRC_DIR}/com.arcadia.orchestrator.plist" "${PLIST_DST_DIR}/com.arcadia.orchestrator.plist"

echo "Loading agent"
launchctl unload "${PLIST_DST_DIR}/com.arcadia.orchestrator.plist" >/dev/null 2>&1 || true
launchctl load "${PLIST_DST_DIR}/com.arcadia.orchestrator.plist"

echo "Done"
echo "Use scripts/90_health_check.sh to validate"
