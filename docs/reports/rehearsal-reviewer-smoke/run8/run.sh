#!/bin/zsh
# Usage: run.sh <label>   (SMOKE_DRY=1 to stop before the paid model call)
N=/private/tmp/claude-501/-Users-pmark-Dev-MR-Arcadia-arcadia/ceb509ea-dacf-4b5b-9ba6-2621299b95f6/scratchpad/qa-run8-smoke
W=/Users/pmark/Dev/MR/Arcadia/arcadia
WPATH=$(plutil -extract EnvironmentVariables.PATH raw -o - ~/Library/LaunchAgents/com.arcadia.local.742852621.worker.plist)
cd $W
env -i HOME=$HOME PATH="$WPATH" SMOKE_SRC=$W/src ${SMOKE_DRY:+SMOKE_DRY=$SMOKE_DRY} ${SMOKE_BODY:+SMOKE_BODY=$SMOKE_BODY} /opt/homebrew/bin/mise -C $W exec -- node --import tsx $N/${SMOKE_SCRIPT:-smoke.mts} $1 > $N/out-$1.txt 2>&1
echo "exit=$?"
python3 - "$N/calls-$1.log" <<'PY'
import json,sys
for l in open(sys.argv[1]):
  d=json.loads(l); print(d['cmd'], d['args'][:4], 'status',d['status'],'ms',d['ms'],'err',d['error'], ('ERR: '+d['stderrHead'][:300].replace(chr(10),' | ')) if d['status'] not in (0,) else '')
PY
