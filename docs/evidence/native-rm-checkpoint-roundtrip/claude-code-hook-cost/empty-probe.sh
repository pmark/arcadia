#!/bin/sh
# Empty-inbox branch stand-in: consume hook stdin, emit zero bytes, exit 0.
cat >/dev/null
printf '%s\n' "$(date +%s%N) $1" >> "$(dirname "$0")/raw/hook-fired.log"
exit 0
