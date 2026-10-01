#!/usr/bin/env bash
set -euo pipefail
library="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test "$#" -eq 1 || { echo 'Only run and --describe are accepted.' >&2; exit 2; }
case "$1" in
  --describe) cat "$library/approve-browser-audit-preparation-0078-2026-10-01.json" ;;
  run)
    run_dir="$library/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_PREPARATION_RUN_DIR="$run_dir"
    export ARCADIA_PREPARATION_DESCRIPTOR="$library/approve-browser-audit-preparation-0078-2026-10-01.json"
    if python3 - <<'PYTHON' >"$run_dir/run.log" 2>&1
import datetime, hashlib, json, os, pathlib, signal, subprocess
descriptor_path = pathlib.Path(os.environ['ARCADIA_PREPARATION_DESCRIPTOR'])
descriptor = json.loads(descriptor_path.read_text())
out = pathlib.Path(os.environ['ARCADIA_PREPARATION_RUN_DIR'])
root = pathlib.Path('/Users/pmark/.codex/worktrees/4e4e/arcadia')
branch = 'codex/restricted-host-browser-audit'
answer = 'Prepare a host-owned audit route'
decision = root / 'docs/decisions/0078-choose-a-bounded-host-owned-loopback-headless-audit-route-for-issue-847-before.md'
def sha(file): return hashlib.sha256(file.read_bytes()).hexdigest()
def command(args, timeout=30):
    child = subprocess.Popen(args, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try: stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        stdout, stderr = child.communicate(timeout=5)
        print(stdout, stderr, flush=True)
        raise RuntimeError('Bounded command timed out: ' + args[0])
    if stderr: print(stderr, flush=True)
    if child.returncode:
        print(stdout, flush=True)
        raise RuntimeError('Command refused: ' + args[0])
    return stdout
def remote():
    value = command(['git','ls-remote','origin','refs/heads/' + branch]).strip().split()
    if len(value) != 2: raise RuntimeError('Remote candidate branch is absent.')
    return value[0]
cli = ['mise','exec','--','node','--import','tsx','src/cli.ts','decision','approve','0078','--project','arcadia','--answer',answer,'--json']
try:
    if datetime.datetime.now(datetime.timezone.utc) >= datetime.datetime.fromisoformat(descriptor['expires_at'].replace('Z','+00:00')): raise RuntimeError('Preparation approval contract expired.')
    if descriptor['policy_revision'] != 'arcadia-host-browser-audit-preparation-v1' or descriptor['answer'] != answer: raise RuntimeError('Policy/answer changed.')
    if command(['git','rev-parse','--show-toplevel']).strip() != str(root): raise RuntimeError('Candidate checkout changed.')
    if command(['git','branch','--show-current']).strip() != branch: raise RuntimeError('Candidate branch changed; no reconciliation is authorized.')
    if command(['git','remote','get-url','origin']).strip() != 'https://github.com/pmark/arcadia.git': raise RuntimeError('Repository changed.')
    if command(['git','status','--porcelain']).strip(): raise RuntimeError('Candidate is dirty; preserve it before retrying.')
    for relative, expected in descriptor['pinned_source_sha256'].items():
        if sha(root/relative) != expected: raise RuntimeError('Reviewed preparation source changed: ' + relative)
    archive = root/'.arcadia/asks/archive/agent-ask-propose-bounded-host-browser-audit-847-2026-10-01.yaml'
    if sha(archive) != descriptor['pinned_ask_sha256']: raise RuntimeError('Original proposal changed.')
    head = command(['git','rev-parse','HEAD']).strip()
    command(['git','merge-base','--is-ancestor',descriptor['pinned_candidate_revision'],head])
    extra = command(['git','diff','--name-only',descriptor['pinned_candidate_revision'],head]).strip().splitlines()
    allowed = ['MISSION_LOG.md','docs/reports/restricted-host-browser-audit-2026-10-01.md',str(decision.relative_to(root)), 'tests/browser-audit-operator-action.test.ts','tests/browser-audit-preparation-operator-action.test.ts','tests/fixtures/browserAuditPreparationApproval.py']
    if any(value not in allowed and not value.startswith(('.arcadia/asks/','artifacts/generated/operator-scripts/')) for value in extra): raise RuntimeError('Candidate changed outside the exact preparation/record scope.')
    # Recover only our own canonical answer commit after a publication failure.
    prior = None
    for file in sorted(out.parent.glob('*/receipt.json'), reverse=True):
        value = json.loads(file.read_text())
        if value.get('id') == descriptor['id'] and value.get('descriptor_sha256') == sha(descriptor_path) and value.get('approved_head') == head and value.get('decision_sha256') == sha(decision):
            prior = value; break
    if prior:
        if remote() != head: command(['git','push','origin','HEAD:refs/heads/' + branch], 120)
        if remote() != head: raise RuntimeError('Canonical answer remains local only.')
        (out/'receipt.json').write_text(json.dumps(prior, indent=2))
        print(json.dumps(prior)); raise SystemExit(0)
    if sha(decision) != descriptor['pinned_decision_sha256']: raise RuntimeError('Decision is not the exact original open proposal.')
    if remote() != head: raise RuntimeError('Candidate is not synchronized; no Git reconciliation is authorized.')
    pr = json.loads(command(['gh','pr','view','863','--repo','pmark/arcadia','--json','headRefOid,headRefName,state,isDraft,statusCheckRollup']))
    if pr['state'] != 'OPEN' or pr['isDraft'] or pr['headRefOid'] != head or pr['headRefName'] != branch: raise RuntimeError('PR identity or reviewed head changed.')
    required = ['lint','unit-1','unit-2','unit-3','unit-4','dashboard','e2e']
    checks = {value.get('name'): value for value in pr['statusCheckRollup']}
    if any(checks.get(name,{}).get('conclusion') != 'SUCCESS' for name in required): raise RuntimeError('Current-head CI is not green.')
    preview = json.loads(command(cli + ['--dry-run'], 120))
    if not preview.get('ok') or preview['data']['absolutePath'] != str(decision) or preview['data']['applied'] or preview['data']['consequence'] is not None: raise RuntimeError('Canonical answer preview changed scope.')
    applied = json.loads(command(cli, 120))
    if not applied.get('ok') or not applied['data']['applied'] or applied['data']['absolutePath'] != str(decision): raise RuntimeError('Canonical answer did not apply to this candidate.')
    approved_head = command(['git','rev-parse','HEAD']).strip()
    changed = command(['git','diff','--name-only',head,approved_head]).strip().splitlines()
    if changed != [str(decision.relative_to(root))]: raise RuntimeError('Unexpected canonical answer effects; retain and inspect this candidate.')
    receipt = {'id':descriptor['id'], 'descriptor_sha256':sha(descriptor_path), 'answer':answer, 'decision_sha256':sha(decision), 'approved_head':approved_head, 'canonical_receipt':applied, 'effect':'inactive preparation only; no activation or merge'}
    (out/'receipt.json').write_text(json.dumps(receipt, indent=2))
    command(['git','push','origin','HEAD:refs/heads/' + branch], 120)
    if remote() != approved_head: raise RuntimeError('Canonical answer remains local only; retry this same receipt.')
    print(json.dumps(receipt))
except Exception as error:
    (out/'failure-handoff.txt').write_text(str(error) + '\nNo merge, activation, permission change, or Git reconciliation is authorized. Preserve this run and any canonical answer commit.\n')
    raise
PYTHON
    then cat "$run_dir/run.log"; echo "Receipt: $run_dir/receipt.json"
    else cat "$run_dir/run.log" >&2; echo "Failure handoff: $run_dir/failure-handoff.txt" >&2; exit 1
    fi
    ;;
  *) echo 'Only run and --describe are accepted.' >&2; exit 2 ;;
esac
