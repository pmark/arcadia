#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$library_dir/../../.." && pwd)"
exec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/accept-grant-operator-action-v6-criterion-2026-09-30.json" "${1:-}"
