#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -eq 1 ]] || { echo 'Use only run or --describe.' >&2; exit 2; }
case "$1" in
  --describe) cat "$library_dir/approve-scoped-container-audit-847-2026-10-02.json" ;;
  run)
    run_dir="$library_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_CONTAINER_OPERATOR_DESCRIPTOR="$library_dir/approve-scoped-container-audit-847-2026-10-02.json"
    export ARCADIA_CONTAINER_OPERATOR_RUN="$run_dir"
    if python3 - <<'PY' >"$run_dir/run.log" 2>&1
import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time, uuid
d = json.loads(pathlib.Path(os.environ['ARCADIA_CONTAINER_OPERATOR_DESCRIPTOR']).read_text())
out = pathlib.Path(os.environ['ARCADIA_CONTAINER_OPERATOR_RUN'])
root = pathlib.Path('/Users/pmark/Dev/MR/Arcadia/arcadia')
workspace = pathlib.Path('/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover')
def command(argv, cwd=root, timeout=30):
    child = subprocess.Popen(argv, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try: stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        stdout, stderr = child.communicate(timeout=5)
        raise RuntimeError('Bounded command timed out: '+argv[0])
    if child.returncode: raise RuntimeError('Command refused: '+argv[0]+' '+stderr[-2000:])
    return stdout
def sha(file): return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def validate_scoped_result(result, grant, active, workspace):
    nonce=result.get('nonce')
    if not isinstance(nonce,str) or str(uuid.UUID(nonce)) != nonce: raise RuntimeError('Invalid receipt nonce; no success recorded.')
    consumed=active.parent/(active.name+'.'+nonce+'.consumed')
    if not consumed.is_file() or json.loads(consumed.read_text()) != grant: raise RuntimeError('Exact Grant was not consumed for this response; retain the pending request and Grant.')
    expected=workspace/'artifacts/container-audits'/nonce/'receipt.json'
    if pathlib.Path(result.get('receipt','')).resolve() != expected.resolve(): raise RuntimeError('Response receipt path does not match its protected nonce.')
    receipt=json.loads(expected.read_text())
    if receipt.get('authority') != grant['authority'] or receipt.get('ready') is not True or receipt.get('removed') is not True: raise RuntimeError('Receipt authority or completion differs from this exact Grant; no success recorded.')
try:
    grant = d['grant']
    expiry = datetime.datetime.fromisoformat(grant['authority']['expiresAt'].replace('Z','+00:00'))
    if expiry <= datetime.datetime.now(datetime.timezone.utc): raise RuntimeError('Scope expired; request a fresh exact Decision/Grant.')
    if command(['git','branch','--show-current']).strip() != 'main': raise RuntimeError('Main checkout changed; no Git reconciliation is authorized.')
    for file, expected in d['sourcePins'].items():
        if sha(root/file) != expected: raise RuntimeError('Reviewed source is not installed on main: '+file+'. Merge PR #873 and use Recover Arcadia host services and protected transport; this action never reconciles Git.')
    pr = json.loads(command(['gh','pr','view','873','--repo','pmark/arcadia','--json','state,headRefOid,reviews,statusCheckRollup']))
    if pr['state'] != 'MERGED': raise RuntimeError('PR #873 must be operator-merged first; this action does not merge.')
    if not any(r['author']['login'] in ['coderabbitai','coderabbitai[bot]'] and r['state']=='APPROVED' and r.get('commit',{}).get('oid')==pr['headRefOid'] for r in pr['reviews']): raise RuntimeError('No exact-head CodeRabbit approval retained.')
    checks = {c.get('name'):c.get('conclusion') for c in pr['statusCheckRollup'] if c.get('__typename')=='CheckRun'}
    if any(checks.get(n) != 'SUCCESS' for n in ['lint','unit-1','unit-2','unit-3','unit-4','dashboard','e2e']): raise RuntimeError('Exact-head CI is not green.')
    release = pathlib.Path('/Users/pmark/.local/bin/arcadia-go-broker-codex').resolve().parent
    for file, expected in d['runtimePins'].items():
        if sha(release/file) != expected: raise RuntimeError('Reviewed protected runtime not installed; use the existing host recovery action.')
    heartbeat = json.loads((workspace/'.arcadia/preservation.heartbeat').read_text())
    route = heartbeat.get('containerAuditRequests',{})
    age = time.time()*1000-route.get('at',0)
    if age < 0 or age >= 15000 or route.get('transportHash') not in d['loadedTransportHashes']: raise RuntimeError('The reviewed host consumer is not running; use the existing host recovery action.')
    docker_config=out/'docker-config'
    docker_config.mkdir(mode=0o700)
    image = command(['/usr/local/bin/docker','--config',str(docker_config),'--host','unix:///Users/pmark/.docker/run/docker.sock','image','inspect',grant['authority']['image'],'--format','{{.Id}}']).strip()
    if image != grant['authority']['image']: raise RuntimeError('Reviewed immutable image is unavailable; never substitute a tag.')
    decision = root/d['decisionPath']
    cli = ['mise','exec','--','node','--import','tsx','src/cli.ts','decision','approve',d['decisionId'],'--project','arcadia','--answer',d['answer'],'--json']
    active = workspace/'.arcadia/container-audit-grant.json'
    consumed = [p for p in active.parent.glob(active.name+'.*.consumed') if json.loads(p.read_text()) == grant]
    if len(consumed)>1: raise RuntimeError('Ambiguous consumed receipts; retain them and request review.')
    if consumed:
        nonce = consumed[0].name[len(active.name)+1:-len('.consumed')]
        response = workspace/'artifacts/container-audit-responses'/f'{nonce}.json'
        if response.is_file():
            result = json.loads(response.read_text())
        else:
            recovery = workspace/'artifacts/container-audits'/nonce/'worker-result.json'
            if not recovery.is_file(): raise RuntimeError('Grant already consumed; inspect its host receipt. Do not reset or rerun it.')
            result = json.loads(recovery.read_text())
            if result.get('nonce') != nonce: raise RuntimeError('Recovery nonce mismatch; no rerun is authorized.')
            print('Recovered the original durable worker result; no audit reran.')
    else:
        # Before first authority write, refuse unrelated local changes/divergence.
        if sha(decision) == d['openDecisionHash']:
            if command(['git','status','--porcelain']).strip(): raise RuntimeError('Main is dirty; preserve it. No cleanup is authorized.')
            remote = command(['git','ls-remote','origin','refs/heads/main']).split()[0]
            if command(['git','rev-parse','HEAD']).strip() != remote: raise RuntimeError('Main is not synchronized; no reconciliation is authorized.')
            os.environ.update(GIT_AUTHOR_NAME='Cody Atlas',GIT_AUTHOR_EMAIL='cody.atlas@agents.arcadia.local',GIT_COMMITTER_NAME='Cody Atlas',GIT_COMMITTER_EMAIL='cody.atlas@agents.arcadia.local')
            receipt = json.loads(command(cli,timeout=120))
            (out/'decision-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
            if not receipt.get('ok'): raise RuntimeError('Canonical approval refused.')
            command(['git','push','origin','HEAD:refs/heads/main'],timeout=120)
        else:
            parser = 'import{parseDoc}from"./src/docs/parse.ts";import{readFileSync}from"node:fs";const p=process.argv[1];const r=parseDoc(p,p,readFileSync(p,"utf8"));if(r.errors.length)throw Error("Invalid Decision");console.log(JSON.stringify(r.doc));'
            current = json.loads(command(['mise','exec','--','node','--import','tsx','--input-type=module','-e',parser,str(decision)]))
            if current.get('status') != 'approved' or current.get('answer') != d['answer']: raise RuntimeError('Decision changed; no authority installed.')
            if command(['git','status','--porcelain']).strip(): raise RuntimeError('Approval retry has uncommitted recovery; preserve it.')
            remote = command(['git','ls-remote','origin','refs/heads/main']).split()[0]
            if command(['git','rev-parse','HEAD']).strip() != remote:
                command(['git','merge-base','--is-ancestor',remote,'HEAD'])
                paths = command(['git','diff','--name-only',remote+'..HEAD']).splitlines()
                subjects = command(['git','log','--format=%s',remote+'..HEAD']).splitlines()
                if paths != [d['decisionPath']] or subjects != [d['approvalCommitSubject']]: raise RuntimeError('Publication retry contains unrelated history; no push authorized.')
                command(['git','push','origin','HEAD:refs/heads/main'],timeout=120)
        if active.exists():
            if json.loads(active.read_text()) != grant: raise RuntimeError('A different host Grant exists; no overwrite is authorized.')
        else:
            fd=os.open(active,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'w') as file: json.dump(grant,file)
        result=json.loads(command(['mise','exec','--','node',str(release/'dist/scripts/request-container-browser-audit.js')],cwd=pathlib.Path(grant['repository']),timeout=450))
    (out/'audit-response.json').write_text(json.dumps(result,indent=2)+'\n')
    if not result.get('ok') or not result.get('ready'): raise RuntimeError('Scoped audit failed; retain its consumed Grant and receipt. A retry requires review, not a reset.')
    validate_scoped_result(result,grant,active,workspace)
    print(json.dumps(result,indent=2))
    print('One baseline audit completed. Chromium-version non-comparability remains explicit. No production or PPN release completion authority was granted.')
except Exception as error:
    text='Scoped container audit stopped: '+str(error)+'\nPreserve run.log, Decision receipts and host consumed-Grant receipts. Do not reset dashboard state, widen scope or perform manual Git reconciliation.\n'
    (out/'failure-handoff.txt').write_text(text)
    print(text,file=sys.stderr)
    sys.exit(1)
PY
    then cat "$run_dir/run.log"
    else cat "$run_dir/run.log"; exit 1
    fi ;;
  *) echo 'Use only run or --describe.' >&2; exit 2 ;;
esac
