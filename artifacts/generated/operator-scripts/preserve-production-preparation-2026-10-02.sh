#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id="preserve-production-preparation-2026-10-02"
[[ $# -eq 1 ]] || { printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64; }
case "$1" in
  --describe) cat "$library_dir/$id.json" ;;
  run)
    export ARCADIA_PREPARATION_DESCRIPTOR="$library_dir/$id.json"
    python3 - <<'PY'
import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time

descriptor_path = pathlib.Path(os.environ['ARCADIA_PREPARATION_DESCRIPTOR'])
descriptor_bytes = descriptor_path.read_bytes()
descriptor = json.loads(descriptor_bytes)
contract = descriptor['preparationRecovery']
root = pathlib.Path(contract['checkout']).resolve()
library = root/'artifacts/generated/operator-scripts'
action_id = descriptor['id']
run = library/'runs'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid()))
run.mkdir(parents=True)
transaction = library/'runs/transactions'/(action_id+'.json')
lock = library/'runs'/(action_id+'.custody-lock')
deadline = time.monotonic()+240
owned = False
state = None
sha = lambda data: hashlib.sha256(data).hexdigest()

def require(test, message):
    if not test: raise RuntimeError(message)

def save(value):
    transaction.parent.mkdir(parents=True, exist_ok=True)
    temporary = transaction.with_suffix('.tmp-'+str(os.getpid()))
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.replace(transaction)

def command(args, timeout=30, env=None):
    remaining = deadline-time.monotonic()
    require(remaining>0, 'Four-minute recovery budget exhausted.')
    child = subprocess.Popen(args, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try: stdout, stderr = child.communicate(timeout=min(timeout, remaining))
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try: stdout, stderr = child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate(timeout=10)
        (run/'timeout.json').write_text(json.dumps({'command':args, 'stdout':stdout.decode(errors='replace')[-4000:], 'stderr':stderr.decode(errors='replace')[-4000:]}, indent=2)+'\n')
        raise RuntimeError('Bounded command timed out: '+' '.join(args[:3]))
    with (run/'commands.jsonl').open('a') as log:
        log.write(json.dumps({'command':args, 'exitCode':child.returncode, 'stdout':stdout.decode(errors='replace')[-4000:], 'stderr':stderr.decode(errors='replace')[-4000:]})+'\n')
    require(child.returncode==0, 'Command refused: '+' '.join(args[:3])+' '+stderr.decode(errors='replace')[:1500])
    return stdout

def git(*args): return command(['git',*args])

try:
    require(descriptor_path.resolve().parent==library.resolve(), 'Descriptor is outside the primary library.')
    require(action_id=='preserve-production-preparation-2026-10-02' and descriptor['schema']=='arcadia-operator-script-v1', 'Wrong action identity.')
    base = contract['base']
    branch = contract['recoveryBranch']
    require(branch=='codex/preserve-production-preparation-20261002', 'Wrong bounded recovery branch.')
    pair = ['artifacts/generated/operator-scripts/'+action_id+ext for ext in ('.sh','.json')]
    require(sha((root/pair[0]).read_bytes())==contract['scriptSha256'], 'Recovery script changed.')
    expected = dict(contract['files'])
    require(not set(pair).intersection(expected), 'Own ignored pair must remain separate from the dirty manifest.')
    expected[pair[0]] = {'sha256':sha((root/pair[0]).read_bytes()), 'status':'ignored'}
    expected[pair[1]] = {'sha256':sha(descriptor_bytes), 'status':'ignored'}
    require(not {'PROJECT.md','MISSION_LOG.md','CONSTITUTION.md'}.intersection(expected), 'Managed authority is outside recovery scope.')
    require(all(p in ('AGENTS.md','docs/managed-production-readiness.md','docs/notes-to-self.md') or p.startswith('docs/reports/') or p.startswith('.arcadia/asks/') or p in pair or p.startswith('artifacts/generated/operator-scripts/accept-enrollment-and-saved-config-2026-10-02-v2.') for p in expected), 'Recovery path envelope widened.')
    fingerprint = sha(json.dumps({'base':base,'branch':branch,'files':expected},sort_keys=True,separators=(',',':')).encode())
    lock.mkdir()
    owned = True
    (lock/'owner.json').write_text(json.dumps({'pid':os.getpid(),'run':str(run)})+'\n')
    require(git('rev-parse','--show-toplevel').decode().strip()==str(root), 'Wrong repository.')
    require(git('rev-parse','--git-common-dir').decode().strip()=='.git', 'Recovery requires the primary checkout.')
    require(git('remote','get-url','origin').decode().strip()=='https://github.com/pmark/arcadia.git', 'Wrong publication origin.')
    require(git('rev-parse','refs/heads/main').decode().strip()==base, 'Local main ref changed; preserve preparation and re-review.')
    if transaction.exists():
        state=json.loads(transaction.read_text())
        require(state['fingerprint']==fingerprint and state['base']==base and state['branch']==branch, 'Existing custody transaction differs; no substitute is permitted.')
    current_branch = git('branch','--show-current').decode().strip()
    head = git('rev-parse','HEAD').decode().strip()

    def validate_bytes():
        require(descriptor_path.read_bytes()==descriptor_bytes, 'Descriptor changed during recovery.')
        for relative,pinned in expected.items():
            file=root/relative
            require(file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(root), 'Missing or escaping preparation: '+relative)
            require(sha(file.read_bytes())==pinned['sha256'], 'Preparation bytes changed: '+relative)

    def validate_commit(commit):
        require(git('rev-list','--parents','-n','1',commit).decode().split()==[commit,base], 'Recovery is not one exact snapshot commit.')
        require(git('show','-s','--format=%B',commit).decode().strip()=='chore: preserve reviewed managed-production preparation\n\nArcadia-Preparation-Recovery: '+action_id, 'Wrong recovery commit identity.')
        require(set(git('diff','--name-only',base,commit).decode().splitlines())==set(expected), 'Snapshot contains missing or extra paths.')
        for relative,pinned in expected.items():
            require(sha(git('show',commit+':'+relative))==pinned['sha256'], 'Committed preparation drift: '+relative)
            mode=git('ls-tree',commit,'--',relative).decode().split()[0]
            require(mode==('100755' if relative.endswith('.sh') else '100644'), 'Committed preparation mode drift: '+relative)
        require(not git('status','--porcelain','--untracked-files=all').strip(), 'Recovery checkout changed after snapshot; preserve it.')
        validate_bytes()

    if state is None:
        require(current_branch=='main' and head==base, 'Initial recovery requires the exact published main.')
        require(not git('diff','--cached','--name-only').strip(), 'Pre-existing staging refuses recovery.')
        require(not git('ls-files','--',*pair).strip(), 'Own recovery pair is already tracked without this transaction.')
        require(set(git('check-ignore','--',*pair).decode().splitlines())==set(pair), 'Own recovery pair ignore policy changed.')
        require(git('ls-remote','--exit-code','origin','refs/heads/main').decode().split()[0]==base, 'Remote main drift before recovery.')
        status={}
        for entry in filter(None,git('status','--porcelain','-z','--untracked-files=all').decode().split('\0')):
            require(entry[:2] in (' M','??'), 'Unsupported dirty state: '+entry)
            status[entry[3:]]=entry[:2]
        require(status=={p:v['status'] for p,v in contract['files'].items()}, 'Exact dirty-path/status manifest differs; do not stage unrelated work.')
        validate_bytes()
        require(not git('branch','--list',branch).strip(), 'Recovery branch already exists without this transaction.')
        state={'schema':'arcadia-preparation-custody-v1','fingerprint':fingerprint,'base':base,'branch':branch,'phase':'intent','run':str(run)}
        save(state)
        (run/'input-manifest.json').write_text(json.dumps(expected,indent=2)+'\n')

    if 'commit' not in state and current_branch==branch and head!=base:
        validate_commit(head)
        state.update({'commit':head,'phase':'committed'})
        save(state)

    if 'commit' not in state:
        require(head==base and current_branch in ('main',branch), 'Interrupted preparation moved; preserve it for review.')
        if current_branch=='main': git('switch','-c',branch)
        validate_bytes()
        changed=git('status','--porcelain','-z','--untracked-files=all').decode().split('\0')
        changed_paths={entry[3:] for entry in changed if entry}
        require(set(contract['files'])<=changed_paths<=set(expected), 'Preparation paths changed before staging.')
        staged=set(git('diff','--cached','--name-only').decode().splitlines())
        require(staged<=set(expected), 'Interrupted staging contains unrelated paths.')
        tracked=sorted(p for p,v in contract['files'].items() if v['status']==' M')
        untracked=sorted(p for p,v in contract['files'].items() if v['status']=='??')
        require(len(tracked)+len(untracked)==len(contract['files']), 'Unsupported preparation manifest status.')
        if tracked: git('add','-u','--',*tracked)
        if untracked: git('add','--',*untracked)
        git('add','-f','--',*pair)
        require(set(git('diff','--cached','--name-only').decode().splitlines())==set(expected), 'Exact snapshot staging failed.')
        validate_bytes()
        author_env={**os.environ,'GIT_AUTHOR_NAME':'Cody Atlas','GIT_AUTHOR_EMAIL':'cody.atlas@agents.arcadia.local','GIT_COMMITTER_NAME':'Cody Atlas','GIT_COMMITTER_EMAIL':'cody.atlas@agents.arcadia.local'}
        command(['git','-c','core.hooksPath=/dev/null','commit','-m','chore: preserve reviewed managed-production preparation','-m','Arcadia-Preparation-Recovery: '+action_id],60,author_env)
        state['commit']=git('rev-parse','HEAD').decode().strip()
        state['phase']='committed'
        save(state)

    require(git('branch','--show-current').decode().strip()==branch and git('rev-parse','HEAD').decode().strip()==state['commit'], 'Snapshot branch/head moved.')
    validate_commit(state['commit'])
    advertised=git('ls-remote','origin','refs/heads/'+branch).decode().strip()
    require(not advertised or advertised.split()[0]==state['commit'], 'Remote recovery branch has different work; never force-push.')
    if not advertised: command(['git','push','origin',state['commit']+':refs/heads/'+branch],120)
    require(git('ls-remote','--exit-code','origin','refs/heads/'+branch).decode().split()[0]==state['commit'], 'Exact recovery publication unconfirmed.')
    validate_commit(state['commit'])
    pulls=json.loads(command(['gh','pr','list','--repo','pmark/arcadia','--head',branch,'--base','main','--state','all','--json','number,url,state,headRefOid,isDraft']))
    require(len(pulls)<=1, 'Ambiguous recovery PR; preserve exact branch for review.')
    if not pulls:
        body=run/'pr-body.md'
        body.write_text(contract['prBody'])
        url=command(['gh','pr','create','--repo','pmark/arcadia','--draft','--base','main','--head',branch,'--title','Preserve reviewed managed-production preparation','--body-file',str(body)],60).decode().strip()
        pull=json.loads(command(['gh','pr','view',url,'--repo','pmark/arcadia','--json','url,state,headRefOid,isDraft']))
    else: pull=pulls[0]
    require(pull['state']=='OPEN' and pull['headRefOid']==state['commit'] and pull['isDraft'] is True, 'Recovery PR is not draft and open on the exact snapshot.')
    state.update({'phase':'published','pullRequest':pull['url']})
    save(state)
    receipt={'snapshotCommit':state['commit'],'pullRequest':pull['url'],'draft':pull['isDraft'],'mainRefUnchanged':git('rev-parse','refs/heads/main').decode().strip()==base,'governanceSettled':False,'brokerCandidate':False,'productionActivated':False,'next':'Continue the recovery session to attach and validate this exact PR, resolve the known library-check baseline, and run its review loop when ready. AGENTS changes require operator merge review. After reviewed integration, protected continuation restores main; scope approval and make-next remain separate.','run':str(run)}
    require(receipt['mainRefUnchanged'], 'Main ref changed during custody; preserve all receipts.')
    (run/'preparation-preservation.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2),flush=True)
except Exception as error:
    failure={'error':str(error),'transaction':state,'run':str(run),'next':'Preserve this run, the transaction, branch, staging and every input. Retry only the same exact custody action after inspecting the named condition; never reset, remove a lock without terminal-owner proof, reapply settlement, force-push or fabricate a broker binding.'}
    (run/'failure-handoff.json').write_text(json.dumps(failure,indent=2)+'\n')
    print(json.dumps(failure,indent=2),file=sys.stderr,flush=True)
    sys.exit(1)
finally:
    if owned:
        (lock/'owner.json').unlink()
        lock.rmdir()
PY
    ;;
  *) printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64 ;;
esac
