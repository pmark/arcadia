#!/usr/bin/env bash
set -Eeuo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
case "${1:-run}" in
  --describe) cat "$library_dir/recover-qa-1662-20261022.json" ;;
  run) cd "$library_dir/../../.."; exec timeout 420 mise exec -- node --import tsx scripts/qa-recovery-1662.ts ;;
  *) echo 'usage: run|--describe' >&2; exit 2 ;;
esac
