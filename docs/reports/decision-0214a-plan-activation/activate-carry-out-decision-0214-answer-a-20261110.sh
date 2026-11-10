#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$library_dir/../../.." && pwd)"
exec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/activate-carry-out-decision-0214-answer-a-20261110.json" "${1:-}"
