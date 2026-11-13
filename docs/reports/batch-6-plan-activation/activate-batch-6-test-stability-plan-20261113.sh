#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$library_dir/../../.." && pwd)"
exec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/activate-batch-6-test-stability-plan-20261113.json" "${1:-}"
