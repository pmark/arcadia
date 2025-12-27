#!/usr/bin/env bash
set -euo pipefail

echo "Arcadia health check"

echo "User: $(whoami)"
echo "AI directory:"
ls -la "${HOME}/AI" || true

echo "LaunchAgent status:"
launchctl list | grep -i arcadia || true

echo "Recent logs:"
LOG_DIR="${HOME}/Library/Logs/Arcadia"
if [[ -d "${LOG_DIR}" ]]; then
  ls -lt "${LOG_DIR}" | head -n 10 || true
fi

echo "If the orchestrator is running, you should see it in launchctl list output"
