#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$library_dir/../../.." && pwd)"
exec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/activate-batch-10-reliability-20261114.json" "${1:-}"
