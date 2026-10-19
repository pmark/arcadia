#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$library_dir/../../.." && pwd)"
exec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/accept-first-unattended-run-depends-on-next-run-actions-20261019.json" "${1:-}"
