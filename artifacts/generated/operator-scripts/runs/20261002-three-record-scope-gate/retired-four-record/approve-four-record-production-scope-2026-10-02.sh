#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -ne 1 ]]; then printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64; fi
case "$1" in
  --describe) cat "$library_dir/approve-four-record-production-scope-2026-10-02.json" ;;
  run)
    run_dir="$library_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_SCOPE_LIBRARY="$library_dir" ARCADIA_SCOPE_RUN="$run_dir"
    if python3 - <<'PYTHON' >"$run_dir/run.log" 2>&1
import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time
library = pathlib.Path(os.environ['ARCADIA_SCOPE_LIBRARY']).resolve()
out = pathlib.Path(os.environ['ARCADIA_SCOPE_RUN']).resolve()
root = library.parents[2]
id = 'approve-four-record-production-scope-2026-10-02'
descriptor_path = library/(id+'.json')
descriptor_bytes = descriptor_path.read_bytes()
d = json.loads(descriptor_bytes)
proposal = 'approve-four-record-managed-production-critical-path-2026-10-02'
answer = 'Approve four implementation Actions'
ask = '.arcadia/asks/agent-ask-'+proposal+'.yaml'
archive = '.arcadia/asks/archive/agent-ask-'+proposal+'.yaml'
pair = ['artifacts/generated/operator-scripts/'+id+'.'+ext for ext in ('sh','json')]
prep_paths = set(pair + [ask] + list(d['preparationFiles']))
base = d['reviewedBase']
decision_path = d['decision']['path']
request = 'record-four-record-scope-decision-2026-10-02'
cli = ['mise','exec','--','node','--import','tsx','src/cli.ts']
settle = cli+['agent-ask','settle','--proposal',proposal,'--request-id',request,'--disposition','accepted','--json']
lock = library/'runs'/(id+'.lock')
owned = False
deadline = time.monotonic()+240

def require(test, message):
    if not test: raise RuntimeError(message)
def digest(data): return hashlib.sha256(data).hexdigest()
def command(args, timeout=30):
    remaining = deadline-time.monotonic()
    require(remaining>0,'Four-minute total command budget expired.')
    print('COMMAND '+json.dumps(args),flush=True)
    child = subprocess.Popen(args,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try: stdout,stderr=child.communicate(timeout=min(timeout,remaining))
    except subprocess.TimeoutExpired:
        try: os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: stdout,stderr=child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            try: os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            stdout,stderr=child.communicate(timeout=10)
        (out/'timeout.json').write_text(json.dumps({'command':args,'stdout':stdout.decode(errors='replace')[-8000:],'stderr':stderr.decode(errors='replace')[-8000:]},indent=2)+'\n')
        raise RuntimeError('Bounded command timed out: '+args[0])
    require(child.returncode==0,'Command refused: '+' '.join(args[:3])+'\n'+stderr.decode(errors='replace')[-3000:]+stdout.decode(errors='replace')[-3000:])
    return stdout

def git(*args): return command(['git',*args])
def blob(sha,path):
    if not git('ls-tree','--name-only',sha,'--',path).strip(): return None
    return git('show',sha+':'+path)
def canonical(args,name):
    output=command(args,90).decode();value=json.loads(output[output.index('{'):])
    (out/name).write_text(json.dumps(value,indent=2)+'\n')
    require(value.get('ok') is True,'Canonical command refused; preserve its exact receipt.')
    return value['data']
def policy_guard(name):
    expiry_guard()
    policy=canonical(cli+['production','status','--json'],name)
    p=policy['read']['policy'];require(p['desiredState']=='inactive' and p['revision']==29 and p['epoch']==19 and p['scope'] is None and p['authority'] is None and policy['liveAdmissions']==0,'Off policy precondition drift; scope approval activates nothing.')
    expiry_guard()
def remote():
    values=git('ls-remote','--exit-code','origin','refs/heads/main').decode().split()
    require(len(values)==2 and values[1]=='refs/heads/main','Exact origin/main was not observed.')
    return values[0]
def expiry_guard():
    require(datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(d['expiresAt'].replace('Z','+00:00')),'This exact one-shot scope choice expired.')
def pending_answer():
    if not (root/decision_path).is_file():return False
    dirty=bool(git('status','--porcelain','--',decision_path).strip())
    if not dirty:return False
    require(blob('HEAD',decision_path)==d['decision']['openContent'].encode() and decision_state()=='approved','Uncommitted Decision differs from the exact canonical answer.')
    staged=set(git('diff','--cached','--name-only').decode().splitlines())
    if staged:
        require(staged=={decision_path} and git('show',':'+decision_path)==(root/decision_path).read_bytes(),'Staged Decision differs from the exact current answer.')
    return True

def guard_source():
    expiry_guard()
    require(descriptor_path.read_bytes()==descriptor_bytes,'Descriptor changed during execution.')
    require(digest((root/pair[0]).read_bytes())==d['reviewedScriptSha256'],'Reviewed script changed.')
    for path,expected in d['preparationFiles'].items():require(digest((root/path).read_bytes())==expected,'Preparation artifact changed: '+path)
    for path,expected in d['unchangedFiles'].items():require(digest((root/path).read_bytes())==expected,'Governed scope or pointer changed: '+path)
    source=root/(ask if (root/ask).exists() else archive)
    require(source.is_file() and digest(source.read_bytes())==d['askSha256'],'Original reviewed scope Ask changed or vanished.')
    recovering=pending_answer()
    require(not git('diff','--cached','--name-only').strip() or recovering,'Pre-existing staged changes refuse this approval.')
    for entry in filter(None,git('status','--porcelain','--untracked-files=all','-z').decode().split('\0')):
        state,path=entry[:2],entry[3:]
        if path==decision_path and recovering and state in (' M','M '):continue
        if path==ask and state=='??':continue
        if path in d['preparationFiles'] and state in ('??',' M'):continue
        raise RuntimeError('Unrelated working-copy change refuses approval: '+path)

def decision_state():
    # Reuse the repository's canonical document reader, never a local YAML parser.
    code='''import {readFileSync} from "node:fs"; import {isDeepStrictEqual} from "node:util"; import {documentState} from "./src/operatorActions/planAmendment.ts"; const d=JSON.parse(readFileSync(process.argv[1],"utf8")); const current=documentState(readFileSync(d.decision.path,"utf8"));const open=documentState(d.decision.openContent);const approved=structuredClone(open);Object.assign(approved.fields,{status:"approved",answer:d.answer,decided:d.decided,updated:d.decided});process.stdout.write(JSON.stringify({state:isDeepStrictEqual(current,open)?"open":isDeepStrictEqual(current,approved)?"approved":"drift"}));'''
    return json.loads(command(['mise','exec','--','node','--import','tsx','--input-type=module','-e',code,str(descriptor_path)]))['state']

def history(receipt):
    head=git('rev-parse','HEAD').decode().strip()
    commits=git('rev-list','--reverse',base+'..'+head).decode().splitlines()
    require(len(commits)<=3,'Unrelated local commits refuse publication.')
    parent=base
    for index,sha in enumerate(commits):
        require(git('rev-list','--parents','-n','1',sha).decode().split()[1:]==[parent],'Unexpected commit parents; no reconciliation is authorized.')
        paths=set(git('diff','--no-renames','--name-only',parent,sha).decode().splitlines())
        if index==0:
            require(paths==prep_paths and git('show','-s','--format=%s',sha).decode().strip()=='chore: preserve reviewed four-record scope gate','Preparation commit differs from the reviewed exact files.')
            for path in prep_paths:require(blob(sha,path)==(root/path).read_bytes() if path!=ask else digest(blob(sha,path) or b'')==d['askSha256'],'Preparation commit source drift: '+path)
        elif index==1:
            require(receipt.get('applied') is True and receipt.get('documentsCommit')==sha,'History lacks the exact canonical Decision settlement.')
            require(paths=={decision_path,ask,archive},'Decision creation touched other documents.')
            require(blob(sha,decision_path)==d['decision']['openContent'].encode() and blob(sha,ask) is None and digest(blob(sha,archive) or b'')==d['askSha256'],'Canonical creation differs from reviewed open Decision or original archive.')
        else:
            require(paths=={decision_path} and decision_state()=='approved','Only the exact scope answer may follow Decision creation.')
            require(blob(sha,decision_path)==(root/decision_path).read_bytes(),'Approval commit differs from the current exact answer.')
        parent=sha
    return head,commits

try:
    require(d['schema']=='arcadia-operator-script-v1' and d['id']==id and d['answer']==answer and d['agentAsk']=={'proposal':proposal,'intent':'decision','targetRef':None},'Scope approval identity changed.')
    require(d['policyRevision']=='arcadia-critical-path-count-exception-v1' and d['scope']==['persist-inactive-production-configuration','enroll-session-through-governed-host-request','make-one-plan-serial-execution-durable','prove-installed-three-action-autonomous-rehearsal'],'Count exception policy or exact four IDs changed.')
    require(datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(d['expiresAt'].replace('Z','+00:00')),'This exact one-shot scope choice expired.')
    lock.mkdir();owned=True;(lock/'owner.json').write_text(json.dumps({'pid':os.getpid(),'run':str(out)})+'\n')
    require(git('rev-parse','--show-toplevel').decode().strip()==str(root)==d['checkout'],'Wrong primary checkout.')
    require(git('branch','--show-current').strip()==b'main','Wrong branch; no Git reconciliation is authorized.')
    require(git('remote','get-url','origin').decode().strip()==d['origin'],'Wrong origin.')
    git('merge-base','--is-ancestor',base,'HEAD')
    guard_source()
    identity=canonical(cli+['identity','resolve','--agent','codex','--tier','standard','--json'],'identity.json')
    os.environ.update(identity['gitEnv'])
    policy_guard('production-before.json')
    receipt=canonical(settle,'decision-preview.json')['receipt']
    require(receipt['intent']=='decision' and receipt['projectSlug']=='arcadia' and receipt['proposalRequestId']==proposal and receipt['queueActionKeys']==[],'Canonical preview widened scope.')
    if not receipt['applied']:
        review=receipt['review'];docs=review['documents']
        require(review['queueBefore']==review['queueAfter'] and len(docs)==3,'Preview changed queue or extra documents.')
        expected={decision_path:(None,d['decision']['openContent']),ask:((root/ask).read_text(),None),archive:(None,(root/ask).read_text())}
        require({v['path']:(v['before'],v['after']) for v in docs}==expected,'Fresh preview differs from the exact open Decision and archival.')
    head,commits=history(receipt);observed_remote=remote()
    require(observed_remote in [base,*commits],'Remote divergence refuses; protected host recovery is required.')
    if not receipt['applied']:
        if not commits:
            guard_source();policy_guard('production-before-preparation.json');git('add','-f','--',*sorted(prep_paths))
            require(set(git('diff','--cached','--name-only').decode().splitlines())==prep_paths,'Staged preparation differs from the exact reviewed set.')
            git('commit','-m','chore: preserve reviewed four-record scope gate')
        guard_source()
        policy_guard('production-before-settlement.json')
        receipt=canonical(settle+['--preview',receipt['previewFingerprint'],'--operator','--apply'],'decision-settlement.json')['receipt']
    else:(out/'decision-settlement.json').write_text(json.dumps({'receipt':receipt},indent=2)+'\n')
    require(receipt['applied'] is True and receipt.get('documentsCommit') and not receipt.get('recovery'),'Decision settlement needs canonical recovery; no second application is permitted.')
    head,commits=history(receipt);guard_source()
    state=decision_state();require(state in ('open','approved'),'The exact Decision state changed; refuse a different answer.')
    if state=='open' or pending_answer():
        approval=cli+['decision','approve',d['decision']['id'],'--project','arcadia','--answer',answer,'--decided',d['decided'],'--json']
        preview=canonical(approval+['--dry-run'],'answer-preview.json')
        require(preview['relativePath']==decision_path and preview['applied'] is False and preview['consequence'] is None,'Scope answer preview changed other governed state.')
        guard_source();policy_guard('production-before-answer.json');applied=canonical(approval,'answer-receipt.json')
        require(applied['relativePath']==decision_path and applied['applied'] is True and applied['consequence'] is None,'Exact scope answer was not canonically recorded.')
    require(decision_state()=='approved','Canonical approved answer differs from the exact reviewed scope choice.')
    guard_source();published_head,commits=history(receipt)
    require(len(commits)==3,'Expected preparation, open Decision and exact answer commits are missing.')
    (out/'validated-scope-answer.json').write_text(json.dumps({'id':id,'descriptorSha256':digest(descriptor_bytes),'decision':decision_path,'answer':answer,'commits':commits,'publishedHead':published_head,'scope':d['scope'],'authority':'Record-count judgment only; no Action creation, pointer transition, packet approval or production activation'},indent=2)+'\n')
    observed_remote=remote();require(observed_remote in [base,*commits],'Remote advanced outside this exact reviewed lineage; preserve all commits.')
    if observed_remote!=published_head:command(['git','push','origin',published_head+':refs/heads/main'],120)
    require(remote()==published_head,'Publication not confirmed; preserve answer and receipt before retry.')
    (out/'publication.json').write_text(json.dumps({'publishedSha':published_head,'commits':commits,'decision':decision_path,'answer':answer,'actionCreated':False,'pointerChanged':False,'productionActivated':False},indent=2)+'\n')
    print('Exact four-record scope exception recorded and published. No Action, pointer, packet or production authority changed.')
    print('Next: continue this session to draft/preview the separate durable/rehearsal Actions and exact saved-configuration pointer transition through existing canonical writers.')
except Exception as error:
    message='Scope approval stopped: '+str(error)+'\nNext: preserve this run, any preparation/Decision/answer commits and all earlier receipts. Retry only this exact still-live choice after its named precondition is restored; an applied Decision or answer is validated, never replaced. A drifted scope or expiry requires fresh review. No reset, force-push, arbitrary staging, packet rebinding, lease clearing, production activation or manual governance edits are authorized.\n'
    (out/'failure-handoff.txt').write_text(message);print(message,file=sys.stderr,flush=True);sys.exit(1)
finally:
    if owned:(lock/'owner.json').unlink();lock.rmdir()
PYTHON
    then cat "$run_dir/run.log"; printf 'Publication receipt: %s/publication.json\n' "$run_dir"
    else cat "$run_dir/run.log" >&2; printf 'Failure handoff: %s/failure-handoff.txt\n' "$run_dir" >&2; exit 1
    fi
    ;;
  *) printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64 ;;
esac
