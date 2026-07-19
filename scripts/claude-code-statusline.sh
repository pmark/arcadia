#!/bin/bash

# Capture Claude Code's authoritative status-line payload for Arcadia while
# still rendering a useful one-line status inside Claude Code.
input=$(cat)
snapshot_path=${ARCADIA_CLAUDE_USAGE_PATH:-"$HOME/.arcadia/telemetry/claude-code.json"}
snapshot_dir=$(dirname "$snapshot_path")
mkdir -p "$snapshot_dir"

captured_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
temporary_path=$(mktemp "${snapshot_path}.tmp.XXXXXX")
if printf '%s' "$input" | jq --arg captured_at "$captured_at" '. + {arcadia_captured_at: $captured_at}' > "$temporary_path"; then
  mv "$temporary_path" "$snapshot_path"
else
  rm -f "$temporary_path"
fi

model=$(printf '%s' "$input" | jq -r '.model.display_name // "Claude"')
context=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // 0 | round')
five_hour=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty | round')
seven_day=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty | round')

limits=""
[ -n "$five_hour" ] && limits=" | 5h ${five_hour}%"
[ -n "$seven_day" ] && limits="${limits} | 7d ${seven_day}%"
echo "[$model] Context ${context}%${limits}"
