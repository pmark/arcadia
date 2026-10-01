#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  --describe) cat "$library_dir/open-browser-audit-boundary-decision-847-2026-10-01.json" ;;
  run)
    run_dir="$library_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_AUDIT_DECISION_RUN_DIR="$run_dir"
    export ARCADIA_AUDIT_DECISION_DESCRIPTOR="$library_dir/open-browser-audit-boundary-decision-847-2026-10-01.json"
    if python3 - <<'PYTHON' >"$run_dir/run.log" 2>&1
import hashlib, json, os, pathlib, signal, subprocess, sys
root = pathlib.Path('/Users/pmark/Dev/MR/Arcadia/arcadia')
out = pathlib.Path(os.environ['ARCADIA_AUDIT_DECISION_RUN_DIR'])
descriptor = json.loads(pathlib.Path(os.environ['ARCADIA_AUDIT_DECISION_DESCRIPTOR']).read_text())
proposal = 'propose-bounded-host-browser-audit-847-2026-10-01'
request = 'open-browser-audit-boundary-decision-847-2026-10-01'
ask = '.arcadia/asks/agent-ask-' + proposal + '.yaml'
archive = '.arcadia/asks/archive/agent-ask-' + proposal + '.yaml'
def command(args, timeout=30):
    child = subprocess.Popen(args, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try: stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        stdout, stderr = child.communicate(timeout=5)
        print(stdout, stderr, flush=True)
        raise RuntimeError('Bounded host command timed out: ' + args[0])
    if stderr: print(stderr, flush=True)
    if child.returncode:
        print(stdout, flush=True)
        raise RuntimeError('Command refused: ' + args[0])
    return stdout
cli = ['mise','exec','--','node','--import','tsx','src/cli.ts','agent-ask','settle',
       '--proposal',proposal,'--request-id',request,'--disposition','accepted','--operator','--json']
try:
    if command(['git','rev-parse','--show-toplevel']).strip() != str(root): raise RuntimeError('Primary checkout changed.')
    if command(['git','branch','--show-current']).strip() != 'main': raise RuntimeError('Main is not checked out; no Git reconciliation is authorized.')
    if command(['git','remote','get-url','origin']).strip() != 'https://github.com/pmark/arcadia.git': raise RuntimeError('Repository changed.')
    if command(['git','status','--porcelain']).strip(): raise RuntimeError('Main is dirty; preserve and review it before retrying.')
    file = root / (archive if (root/archive).is_file() else ask)
    if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != descriptor['pinnedAskSha256']:
        raise RuntimeError('The exact reviewed Ask is not on main yet or changed. Merge the reviewed repair PR before using this action.')
    # Read the remote without fetching or moving refs. A retry may contain only
    # this script's own already-applied settlement ahead of the remote.
    remote = command(['git','ls-remote','origin','refs/heads/main']).split()[0]
    head = command(['git','rev-parse','HEAD']).strip()
    if file == root/ask and head != remote: raise RuntimeError('Main is not synchronized; this action never reconciles Git.')
    os.environ.update(GIT_AUTHOR_NAME='Cody Atlas', GIT_AUTHOR_EMAIL='cody.atlas@agents.arcadia.local',
                      GIT_COMMITTER_NAME='Cody Atlas', GIT_COMMITTER_EMAIL='cody.atlas@agents.arcadia.local')
    preview = json.loads(command(cli, timeout=120))
    (out/'preview.json').write_text(json.dumps(preview,indent=2)+'\n')
    receipt = preview.get('data',{}).get('receipt',{})
    if not preview.get('ok') or receipt.get('proposalRequestId') != proposal or receipt.get('intent') != 'decision':
        raise RuntimeError('Canonical Decision preview did not match this proposal.')
    if receipt.get('previewFingerprint') != descriptor['pinnedPreview']:
        raise RuntimeError('Settlement preview changed; ask an agent to refresh the exact reviewed button. No broader effect is accepted.')
    documents = receipt.get('review',{}).get('documents',[])
    decision = next((doc for doc in documents if doc.get('path') == descriptor['pinnedDecisionPath']), None)
    if not decision or hashlib.sha256((decision.get('after') or '').encode()).hexdigest() != descriptor['pinnedDecisionSha256']:
        raise RuntimeError('Canonical preview no longer describes the exact unresolved Decision.')
    if receipt.get('applied'):
        if not (root/descriptor['pinnedDecisionPath']).is_file() or hashlib.sha256((root/descriptor['pinnedDecisionPath']).read_bytes()).hexdigest() != descriptor['pinnedDecisionSha256']:
            raise RuntimeError('Decision state changed after settlement; this one-shot action is no longer live.')
        command(['git','merge-base','--is-ancestor',remote,'HEAD'])
        # Only recover the existing exact settlement commit. Refuse unrelated
        # local commits rather than pushing a mixed branch on a retry.
        subjects = command(['git','log','--format=%s',remote+'..HEAD']).splitlines()
        if subjects not in ([], ['chore(arcadia): settle ' + proposal]): raise RuntimeError('Publication retry contains unrelated history.')
        applied = preview
    else:
        applied = json.loads(command(cli + ['--apply','--preview',descriptor['pinnedPreview']], timeout=120))
    (out/'settlement-receipt.json').write_text(json.dumps(applied,indent=2)+'\n')
    if not applied.get('ok') or not applied.get('data',{}).get('receipt',{}).get('applied'): raise RuntimeError('No applied canonical receipt returned.')
    decision_file = root/descriptor['pinnedDecisionPath']
    if not decision_file.is_file() or hashlib.sha256(decision_file.read_bytes()).hexdigest() != descriptor['pinnedDecisionSha256']:
        raise RuntimeError('Applied Decision differs from its reviewed unresolved state; publication withheld.')
    if not (root/archive).is_file() or hashlib.sha256((root/archive).read_bytes()).hexdigest() != descriptor['pinnedAskSha256']:
        raise RuntimeError('Archived Ask changed; publication withheld.')
    if command(['git','status','--porcelain']).strip(): raise RuntimeError('Settlement left recovery files; publication withheld.')
    print(command(['git','push','origin','HEAD:refs/heads/main'], timeout=120),flush=True)
    print('Unresolved browser-audit Decision opened and published. No Decision was answered and no audit authority was granted.',flush=True)
    print(json.dumps(applied,indent=2),flush=True)
except Exception as error:
    text = 'Browser-audit Decision handoff stopped: '+str(error)+'\nRetain run.log and any settlement receipt. Ask an agent to inspect and refresh this narrow action; do not clear claims, reset dashboard state, broaden permissions or reconcile Git manually.\n'
    (out/'failure-handoff.txt').write_text(text)
    print(text,file=sys.stderr,flush=True)
    sys.exit(1)
PYTHON
    then cat "$run_dir/run.log"
    else cat "$run_dir/run.log"; cat "$run_dir/failure-handoff.txt"; exit 1
    fi
    ;;
  *) echo "Use only run or --describe." >&2; exit 2 ;;
esac
