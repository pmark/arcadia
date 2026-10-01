"""Exact-answer button fixture. Every Git, GitHub and canonical CLI is mocked."""
import hashlib, json, os, pathlib, sys, unittest.mock
root, library, mode = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
identifier = 'approve-browser-audit-preparation-0078-2026-10-01'
descriptor = json.loads((library/(identifier+'.json')).read_text())
descriptor['expires_at'] = '2000-01-01T00:00:00Z' if mode == 'expired' else '2099-01-01T00:00:00Z'
decision = root/descriptor['decision']; decision.parent.mkdir(parents=True)
before, after = 'fixture open Decision', 'fixture approved exact answer'
decision.write_text(after if mode == 'retry' else before + ('drift' if mode == 'changed' else ''))
descriptor['pinned_decision_sha256'] = hashlib.sha256(before.encode()).hexdigest()
archive = root/'.arcadia/asks/archive/agent-ask-propose-bounded-host-browser-audit-847-2026-10-01.yaml'
archive.parent.mkdir(parents=True); archive.write_text('fixture original proposal')
descriptor['pinned_ask_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
for relative in descriptor['pinned_source_sha256']:
    file = root/relative; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('fixture reviewed source')
    descriptor['pinned_source_sha256'][relative] = hashlib.sha256(file.read_bytes()).hexdigest()
descriptor_file = root/'descriptor.json'; descriptor_file.write_text(json.dumps(descriptor))
out = root/'runs/current'; out.mkdir(parents=True)
os.environ.update(ARCADIA_PREPARATION_RUN_DIR=str(out), ARCADIA_PREPARATION_DESCRIPTOR=str(descriptor_file))
state = {'head':'after' if mode == 'retry' else 'before', 'remote':'before'}
if mode == 'retry':
    prior = root/'runs/previous'; prior.mkdir()
    (prior/'receipt.json').write_text(json.dumps({'id':identifier,'descriptor_sha256':hashlib.sha256(descriptor_file.read_bytes()).hexdigest(),'approved_head':'after','decision_sha256':hashlib.sha256(after.encode()).hexdigest()}))
shell = (library/(identifier+'.sh')).read_text()
embedded = shell.split("<<'PYTHON' >\"$run_dir/run.log\" 2>&1\n")[1].split('\nPYTHON\n')[0]
source = embedded.replace('root = pathlib.Path('+repr(descriptor['candidate'])+')', 'root = pathlib.Path('+repr(str(root))+')')
assert source != embedded
class Child:
    def __init__(self,args,**kwargs):
        assert kwargs['cwd'] == root
        self.args, self.returncode = args, 0
    def communicate(self,timeout):
        args = self.args
        if args[0] == 'mise':
            assert mode != 'retry', 'Publication recovery must never approve again'
            dry = '--dry-run' in args
            if not dry:
                assert mode == 'fresh', 'A refused precondition must never approve'
                state['head']='after'; decision.write_text(after); (root/'approved').write_text('yes')
            return json.dumps({'ok':True,'data':{'absolutePath':str(decision),'applied':not dry,'consequence':None}}), ''
        if args[0] == 'gh':
            checks = [{'name':name,'conclusion':'FAILURE' if mode == 'ci-failed' else 'SUCCESS'} for name in ['lint','unit-1','unit-2','unit-3','unit-4','dashboard','e2e']]
            return json.dumps({'state':'OPEN','isDraft':False,'headRefOid':state['head'],'headRefName':'codex/restricted-host-browser-audit','statusCheckRollup':checks}), ''
        assert args[0] == 'git'
        if args[1:] == ['rev-parse','--show-toplevel']: return str(root), ''
        if args[1:] == ['branch','--show-current']: return 'codex/restricted-host-browser-audit', ''
        if args[1:] == ['remote','get-url','origin']: return 'https://github.com/pmark/arcadia.git', ''
        if args[1:] == ['status','--porcelain']: return '', ''
        if args[1:] == ['rev-parse','HEAD']: return state['head'], ''
        if args[1] == 'ls-remote': return state['remote']+' refs/heads/codex/restricted-host-browser-audit', ''
        if args[1] == 'merge-base': return '', ''
        if args[1] == 'diff': return (descriptor['decision'] if args[-2:] == ['before','after'] else ''), ''
        if args[1] == 'push':
            assert mode in ['fresh','retry']; state['remote']=state['head']; return 'published exact answer', ''
        raise AssertionError('Unexpected command: '+repr(args))
with unittest.mock.patch('subprocess.Popen',Child):
    exec(compile(source,'preparation-approval-fixture','exec'))
