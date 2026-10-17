#!/bin/bash
# One measured headless Claude Code run. usage: run.sh <baseline|empty|control> <rep>
# Copy this directory to a scratch location first; settings name probe scripts by absolute path.
S=$(cd "$(dirname "$0")" && pwd); v=$1; r=$2
mkdir -p "$S/work" "$S/raw"
sed "s|<fixture>|$S|g" "$S/raw/settings-$v.json" > "$S/work/settings-$v.json"
cd "$S/work"
env -u CLAUDE_CODE_REMOTE_SDK_URL -u SESSION_INGRESS_URL -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
 timeout 180 claude --print --output-format stream-json --verbose --model haiku \
  --setting-sources "" --settings "$S/work/settings-$v.json" \
  --allowedTools "Bash(echo native-mail-probe)" --max-turns 3 \
  "Run the Bash command: echo native-mail-probe  -- exactly once. Then reply with the single word DONE." \
  < /dev/null > "$S/raw/out-$v-$r.jsonl" 2> "$S/work/err-$v-$r.txt"
echo "exit=$?"
