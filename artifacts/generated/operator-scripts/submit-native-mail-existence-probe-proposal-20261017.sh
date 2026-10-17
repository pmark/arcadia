#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id="submit-native-mail-existence-probe-proposal-20261017"
if [[ $# -ne 1 ]]; then printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64; fi
case "$1" in
  --describe) cat "$library_dir/$id.json" ;;
  run)
    run_dir="$library_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_PROPOSAL_RUN_DIR="$run_dir" ARCADIA_LIBRARY_DIR="$library_dir"
    if python3 - <<'PY' >"$run_dir/run.log" 2>&1
import hashlib, json, os, pathlib, signal, subprocess

library = pathlib.Path(os.environ['ARCADIA_LIBRARY_DIR'])
out = pathlib.Path(os.environ['ARCADIA_PROPOSAL_RUN_DIR'])
root = library.parent.parent.parent
proposal = 'proposal-native-mail-readonly-existence-probe-20261017'
ask_rel = f'.arcadia/asks/agent-ask-{proposal}.yaml'
ask_sha = '95a537f21c610d80893e01467d5ab9d61741242ccdccf2da1bb8a130794b115e'

def require(ok, message):
    if not ok: raise RuntimeError(message)

def command(args, timeout):
    print('COMMAND ' + json.dumps(args), flush=True)
    child = subprocess.Popen(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try: stdout, stderr = child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL); stdout, stderr = child.communicate(timeout=10)
        raise RuntimeError(f'Timed out after {timeout}s: ' + ' '.join(args[:4]))
    return child.returncode, stdout.decode(errors='replace'), stderr.decode(errors='replace')

def arcadia_json(args, timeout, name):
    code, stdout, stderr = command(['mise', 'exec', '--', 'pnpm', '-s', 'arcadia', *args, '--json'], timeout)
    (out / f'{name}.stdout.txt').write_text(stdout); (out / f'{name}.stderr.txt').write_text(stderr)
    require('{' in stdout, f'{name}: no JSON (exit {code}). {stderr[:500]}')
    return code, json.loads(stdout[stdout.index('{'):])

# Precondition: the exact reviewed proposal file is present and unchanged.
ask = root / ask_rel
require(ask.is_file() and not ask.is_symlink(), f'{ask_rel} is missing; it may already be archived (settled). Nothing was submitted.')
require(hashlib.sha256(ask.read_bytes()).hexdigest() == ask_sha, f'{ask_rel} changed since review; refusing to submit different content.')

# Precondition: the configured live workspace resolves through Arcadia's own resolver (never a guessed path).
_, resolved = arcadia_json(['workspace', 'resolve'], 60, 'workspace-resolve')
data = resolved.get('data') or {}
require(resolved.get('ok') is True and data.get('workspacePath') and data.get('experiment') is False,
        f'No configured live workspace resolved (source: {data.get("source")}). Nothing was submitted.')

# Submit: preview records the proposal. Exact replay returns the same receipt; changed content is refused.
# Pin the workspace just checked, so a resolver change between the two calls cannot redirect the write.
code, receipt = arcadia_json(['agent-ask', 'preview', '--workspace', data['workspacePath'], '--file', ask_rel], 120, 'preview')
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
require(hashlib.sha256(ask.read_bytes()).hexdigest() == ask_sha, f'{ask_rel} changed during preview; inspect receipt.json before trusting it.')
require(code == 0 and receipt.get('ok') is True, 'Preview refused: ' + json.dumps(receipt.get('error') or receipt)[:1500])
d = receipt.get('data') or {}
p = d.get('proposal') or {}
print('RECEIPT ' + json.dumps({'proposalId': p.get('id'), 'captureId': p.get('captureId'), 'requestId': (p.get('normalized') or {}).get('requestId'),
    'replayed': d.get('replayed'), 'projectWritesPerformed': d.get('projectWritesPerformed')}))
print('DISCOVERY ' + json.dumps(d.get('discovery'))[:4000])
print('SUBMITTED: proposal registered for consideration; it is not approved or settled.')
PY
    then
      cat "$run_dir/run.log"; printf 'Receipt: %s/receipt.json\n' "$run_dir"
    else
      cat "$run_dir/run.log" >&2; printf 'FAILED. Handoff log: %s/run.log\n' "$run_dir" >&2; exit 1
    fi ;;
  *) printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64 ;;
esac
