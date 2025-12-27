#!/usr/bin/env bash
set -euo pipefail

ARC_HOME="${HOME}"
AI_BASE="${AI_BASE:-${ARC_HOME}/AI}"
DEV_BASE="${DEV_BASE:-${ARC_HOME}/Dev}"
ARCADIA_BASE="${ARCADIA_BASE:-${ARC_HOME}/Arcadia}"

echo "Bootstrapping Arcadia user environment"

mkdir -p "${DEV_BASE}" "${ARCADIA_BASE}"
mkdir -p "${AI_BASE}/models" "${AI_BASE}/runtimes" "${AI_BASE}/workspaces/private-rag" "${AI_BASE}/workspaces/public-rag"

chmod 700 "${DEV_BASE}" "${ARCADIA_BASE}" "${AI_BASE}" "${AI_BASE}/models" "${AI_BASE}/runtimes" "${AI_BASE}/workspaces" "${AI_BASE}/workspaces/private-rag" "${AI_BASE}/workspaces/public-rag"

echo "Creating Python venv for Arcadia runtime"
PY_ENV="${AI_BASE}/runtimes/py-arcadia"
if [[ ! -d "${PY_ENV}" ]]; then
  python3 -m venv "${PY_ENV}"
fi

source "${PY_ENV}/bin/activate"
pip install --upgrade pip wheel
pip install fastapi uvicorn[standard] pydantic httpx
deactivate

echo "Creating log directory"
mkdir -p "${ARC_HOME}/Library/Logs/Arcadia"
chmod 700 "${ARC_HOME}/Library/Logs/Arcadia"

echo "Done"
echo "Next step is scripts/04_install_launchd_agents.sh"
