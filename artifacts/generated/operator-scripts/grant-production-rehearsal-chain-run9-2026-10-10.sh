#!/usr/bin/env bash
# Rehearsal chain run9-2026-10-10: runs the shared grant.sh with this run's reviewed parameter file and nothing else.
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$library_dir/rehearsal-chain/grant.sh" "$library_dir/rehearsal-chain/params/run9-2026-10-10.json" "${1:-run}"
