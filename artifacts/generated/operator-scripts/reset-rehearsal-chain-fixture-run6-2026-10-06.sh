#!/usr/bin/env bash
# Rehearsal chain run6-2026-10-06: runs the shared reset.sh with this run's reviewed parameter file and nothing else.
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$library_dir/rehearsal-chain/reset.sh" "$library_dir/rehearsal-chain/params/run6-2026-10-06.json" "${1:-run}"
