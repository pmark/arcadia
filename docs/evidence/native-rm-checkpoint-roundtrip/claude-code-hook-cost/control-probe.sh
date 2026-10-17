#!/bin/sh
# Positive control: inject a fixed payload via additionalContext so the instrument must detect it.
cat >/dev/null
printf '%s\n' "$(date +%s%N) $1" >> "$(dirname "$0")/raw/hook-fired.log"
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"NATIVE-MAIL-CONTROL: 1 unacknowledged message (control payload, not real mail)."}}\n' "$1"
exit 0
