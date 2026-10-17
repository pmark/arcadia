#!/bin/bash
# One measured headless OpenCode run. usage: run.sh <baseline|empty|control> <rep> [model]
# Needs OPENCODE (path to the opencode 1.19.3 binary). Config, data and cache are isolated per run under work/.
# Copy this directory to a scratch location first; runs write work/ and raw/ beside this script.
S=$(cd "$(dirname "$0")" && pwd); v=$1; r=$2; m=${3:-opencode/big-pickle}
W="$S/work/$v-$r"; rm -rf "$W"; mkdir -p "$W/proj/.opencode/plugin" "$S/raw"
[ "$v" = baseline ] || cp "$S/plugins/$v.js" "$W/proj/.opencode/plugin/probe.js"
cd "$W/proj" && git init -q . || exit 1
: > "$S/raw/hook-fired-$v-$r.log"
env -u OPENCODE_CONFIG_DIR -u OPENCODE_CONFIG XDG_CONFIG_HOME="$W/config" XDG_DATA_HOME="$W/data" XDG_CACHE_HOME="$W/cache" XDG_STATE_HOME="$W/state" \
 HOOK_LOG="$S/raw/hook-fired-$v-$r.log" OPENCODE_DISABLE_AUTOUPDATE=1 \
 OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","permission":{"bash":{"*":"deny","echo native-mail-probe":"allow"},"edit":"deny","webfetch":"deny"}}' \
 timeout 240 "$OPENCODE" run --format json --model "$m" \
  "Run the bash command: echo native-mail-probe  -- exactly once. Then reply with the single word DONE." \
  < /dev/null > "$S/raw/out-$v-$r.jsonl" 2> "$W/err.txt"
status=$?
echo "exit=$status"
exit "$status"
