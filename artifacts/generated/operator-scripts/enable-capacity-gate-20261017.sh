#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$library_dir/../../.." && pwd)"
cd "$repo"
exec mise exec -- node --import tsx "$repo/scripts/workspace-config-edit-worker.ts" "$library_dir/enable-capacity-gate-20261017.json" "${1:-}"
