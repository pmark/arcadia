#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id="accept-enrollment-and-saved-config-2026-10-02-v2"
if [[ $# -ne 1 ]]; then printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64; fi
case "$1" in
  --describe) cat "$library_dir/$id.json" ;;
  run)
    run_dir="$library_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_ENROLLMENT_REVIEW_RUN_DIR="$run_dir"
    if python3 - <<'PY' >"$run_dir/run.log" 2>&1
import hashlib, json, os, pathlib, signal, subprocess, sys, time

root = pathlib.Path('/Users/pmark/Dev/MR/Arcadia/arcadia')
out = pathlib.Path(os.environ['ARCADIA_ENROLLMENT_REVIEW_RUN_DIR'])
action_id = 'accept-enrollment-and-saved-config-2026-10-02-v2'
proposal = 'enroll-any-session-and-preserve-production-config-2026-10-02-v2'
base = 'fdafca81cc3843f3355e883cfe92d057c01fa609'
preparation = 'ec53674aaaad0148e3ed7e6f3da3a9bb75ab3d64'
target = 'a5a6844e751a6441576871b8b20ae8ccf2ab9d6e'
fingerprint = '46b22ffc37626a52b33ab66ebff899f85a77e5179eda0a0272683c1b687b5f19'
ask_sha = 'd097ab1e6b42e0bb6fb4312db982733e6cc95e5906aa4ebbcf943f456d898e74'
library = root / 'artifacts/generated/operator-scripts'
pair = [f'artifacts/generated/operator-scripts/{action_id}.{ext}' for ext in ('sh', 'json')]
ask_path = f'.arcadia/asks/agent-ask-{proposal}.yaml'
archive_path = f'.arcadia/asks/archive/agent-ask-{proposal}.yaml'
plan_path = 'docs/plans/bootstrap-managed-production-to-build-flight-deck.md'
retained = {
 '20261002T151612Z-53615/settlement-preview.json': 'bf24d6befcc5e82e779e5f01e63da5263bd4eb53e2d28172fbc40b3f82fdcb67',
 '20261002T151612Z-53615/settlement-receipt.json': '2d15009f5f65cbf97ef83786e580a3744c008526af10ffb22d5931de09398c11',
 '20261002-orchestration-refresh-preview/settlement-preview.json': 'bd88f149c24ebc8c269f2fbfd4e92ebecead950c856583bbe23137ec035a541b',
}
keys = ['arcadia/enroll-session-through-governed-host-request', 'arcadia/persist-inactive-production-configuration']
lock = library / 'runs' / (action_id + '.publication-lock')
owned_lock = False
deadline = time.monotonic() + 240

def require(condition, message):
    if not condition: raise RuntimeError(message)

def digest(data): return hashlib.sha256(data).hexdigest()

def command(args, timeout=30):
    remaining = deadline - time.monotonic()
    require(remaining > 0, 'Four-minute publication budget exhausted; preserve all receipts.')
    timeout = min(timeout, remaining)
    print('COMMAND ' + json.dumps(args), flush=True)
    child = subprocess.Popen(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try: stdout, stderr = child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate(timeout=10)
        (out / 'timed-out-command.json').write_text(json.dumps({'command': args, 'stdout': stdout.decode(errors='replace')[-8000:], 'stderr': stderr.decode(errors='replace')[-8000:]}, indent=2) + '\n')
        raise RuntimeError('Bounded command timed out: ' + ' '.join(args[:3]))
    require(child.returncode == 0, 'Command refused: ' + ' '.join(args[:3]) + '\n' + stderr.decode(errors='replace')[:2000])
    return stdout

def git(*args): return command(['git', *args])

def at(sha, path):
    if not git('ls-tree', '--name-only', sha, '--', path).strip(): return None
    return git('show', f'{sha}:{path}')

def canonical(args, filename):
    data = command(args, 60).decode()
    result = json.loads(data[data.index('{'):])
    (out / filename).write_text(json.dumps(result, indent=2) + '\n')
    require(result.get('ok') is True, 'Canonical observation refused; no publication attempted.')
    return result['data']

def validate_local():
    require(git('rev-parse', '--show-toplevel').decode().strip() == str(root), 'Wrong primary checkout.')
    require(git('branch', '--show-current').strip() == b'main', 'Wrong branch.')
    require(git('remote', 'get-url', 'origin').strip() == b'https://github.com/pmark/arcadia.git', 'Wrong origin.')
    require(git('rev-parse', 'HEAD').decode().strip() == target, 'HEAD drift: only the exact already-applied settlement may publish.')
    require(git('rev-list', '--reverse', f'{base}..{target}').decode().splitlines() == [preparation, target], 'Exact two-commit lineage drift.')
    for sha, parent in [(preparation, base), (target, preparation)]:
        require(git('rev-list', '--parents', '-n', '1', sha).decode().split()[1:] == [parent], 'Commit parent drift.')
    require(git('show', '-s', '--format=%s', preparation).decode().strip() == 'chore: preserve reviewed enrollment operator action', 'Preparation subject drift.')
    require(set(git('diff', '--name-only', base, preparation).decode().splitlines()) == set(pair), 'Preparation contains unreviewed paths.')
    original_descriptor = json.loads(at(preparation, pair[1]))
    require(digest(at(preparation, pair[0])) == original_descriptor['reviewedScriptSha256'] == '3f9f2e4abac2e0f9e0be5a1accd39a3523f426ce338187a5d2b08ac51616a487', 'Original script digest drift.')
    require(original_descriptor['reviewedBase'] == base and original_descriptor['askSha256'] == ask_sha and original_descriptor['settlementFingerprint'] == fingerprint, 'Original publication authority drift.')
    descriptor = json.loads((root / pair[1]).read_bytes())
    require(descriptor['reviewedScriptSha256'] == digest((root / pair[0]).read_bytes()), 'Live retry script digest drift.')
    require(descriptor['recovery']['commits'] == [preparation, target] and descriptor['recovery']['base'] == base and descriptor['recovery']['retained'] == retained, 'Live retry envelope drift.')
    preparation_files = descriptor['recovery'].get('preparationFiles', {})
    require(set(preparation_files) == {'docs/managed-production-readiness.md', 'docs/notes-to-self.md', 'docs/reports/autonomous-production-session-friction-2026-10-02.md'}, 'Pinned narrative preparation path envelope drift.')
    for path, sha in preparation_files.items():
        prepared_file = root / path
        require(prepared_file.is_file() and not prepared_file.is_symlink() and prepared_file.resolve().is_relative_to(root), 'Preparation document missing, symlinked or outside repository: ' + path)
        require(digest(prepared_file.read_bytes()) == sha, 'Preparation document drift: ' + path)
    require(not git('diff', '--cached', '--name-only').strip(), 'Existing staged changes refuse publication.')
    for entry in filter(None, git('status', '--porcelain', '-z').decode().split('\0')):
        state, path = entry[:2], entry[3:]
        if state == '??' and path.startswith('.arcadia/asks/'): continue
        if state == ' M' and path in pair: continue
        if state in (' M', '??') and path in preparation_files:
            require((root/path).is_file() and not (root/path).is_symlink(), 'Preparation document must remain a regular file.')
            require(digest((root/path).read_bytes()) == preparation_files[path], 'Preparation document drift.')
            continue
        raise RuntimeError('Unrelated changed path refuses publication: ' + path)
    receipts = {}
    for name, sha in retained.items():
        data = (library/'runs'/name).read_bytes()
        require(digest(data) == sha, 'Retained receipt changed: ' + name)
        receipts[name] = json.loads(data)['data']['receipt']
    original = receipts['20261002T151612Z-53615/settlement-preview.json']
    refreshed = receipts['20261002-orchestration-refresh-preview/settlement-preview.json']
    applied = receipts['20261002T151612Z-53615/settlement-receipt.json']
    require(not original['applied'] and not refreshed['applied'], 'Preview is no longer the retained before-image.')
    require(original['review']['documents'] == refreshed['review']['documents'], 'Original and refreshed document effects differ.')
    require(all(r['previewFingerprint'] == fingerprint for r in (original, refreshed, applied)), 'Fingerprint drift.')
    require(applied['applied'] is True and applied['documentsCommit'] == target and applied['queueActionKeys'] == keys and applied['authority']['kind'] == 'operator_acceptance', 'Exact accepted settlement is missing.')
    require(git('show', '-s', '--format=%s', target).decode().strip() == f'chore(arcadia): settle {proposal}', 'Settlement subject drift.')
    documents = original['review']['documents']
    require(len(documents) == 3 and {d['path'] for d in documents} == {plan_path, ask_path, archive_path}, 'Document envelope drift.')
    expected_paths = set()
    for document in documents:
        path = document['path']
        before = None if document['before'] is None else document['before'].encode()
        after = None if document['after'] is None else document['after'].encode()
        parent_bytes = at(preparation, path)
        if path == ask_path:
            # The canonical before-image describes an untracked input. Its
            # archived exact bytes, not a fictitious parent blob, prove custody.
            require(parent_bytes is None and before is not None and digest(before) == ask_sha and after is None, 'Untracked Ask archive precondition drift.')
            require(at(target, archive_path) == before, 'Ask archival lost or changed original input bytes.')
        else:
            require(parent_bytes == before, 'Tracked document parent differs from exact preview: ' + path)
        require(at(target, path) == after, 'Settlement after-image differs: ' + path)
        if parent_bytes != after: expected_paths.add(path)
    require(set(git('diff', '--name-only', preparation, target).decode().splitlines()) == expected_paths == {plan_path, archive_path}, 'Settlement adds or omits reviewed paths.')
    require((root/archive_path).read_bytes() == at(target, archive_path), 'Archived Ask working copy drift.')
    require((root/plan_path).read_bytes() == at(target, plan_path), 'Canonical Plan working copy drift.')
    return applied

try:
    lock.mkdir()
    owned_lock = True
    (lock/'owner.json').write_text(json.dumps({'pid': os.getpid(), 'run': str(out)}) + '\n')
    applied = validate_local()
    # Observe the existing idempotent receipt only. Never repeat --apply.
    observed = canonical(['arcadia', 'agent-ask', 'settle', '--proposal', proposal, '--request-id', 'refresh-accept-enrollment-and-saved-config-2026-10-02-v2', '--disposition', 'accepted', '--responsibility', 'agent', '--before', 'arcadia/prove-literal-split-browser-and-ledger', '--revision', '180', '--json'], 'canonical-applied-observation.json')['receipt']
    for field in ('id', 'proposalId', 'proposalRequestId', 'settlementRequestId', 'disposition', 'projectSlug', 'intent', 'effects', 'queueActionKeys', 'queuePosition', 'nextActionKey', 'previewFingerprint', 'queueRevision', 'applied', 'authority', 'documentsCommit'):
        require(observed.get(field) == applied.get(field), 'Canonical applied receipt drift at ' + field)
    policy = canonical(['arcadia', 'production', 'status', '--json'], 'production-before.json')
    p = policy['read']['policy']
    require(p['desiredState'] == 'inactive' and p['revision'] == 29 and p['epoch'] == 19 and p['scope'] is None and p['authority'] is None and policy['liveAdmissions'] == 0, 'Production state drift; retry grants no activation.')
    before_remote = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').decode().split()[0]
    require(before_remote in (base, target), 'Remote main diverged; preserve both local commits for protected recovery.')
    (out/'validated-publication.json').write_text(json.dumps({'appliedReceipt': applied['id'], 'commits': [preparation, target], 'remoteBefore': before_remote, 'target': target, 'untrackedAskArchiveValidated': True}, indent=2) + '\n')
    validate_local()
    if before_remote != target:
        command(['git', 'push', 'origin', f'{target}:refs/heads/main'], 120)
    after_remote = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').decode().split()[0]
    require(after_remote == target, 'Exact remote publication not confirmed; preserve validation and inspect the remote before any retry.')
    (out/'publication.json').write_text(json.dumps({'publishedSha': target, 'commits': [preparation, target], 'alreadyPublished': before_remote == target, 'settlementReapplied': False}, indent=2) + '\n')
    print('Exact accepted settlement published; acceptance was not repeated. Off was observed before publication; this action does not activate production or change the older proof pointer.')
    print('Next: inspect the prepared three-record scope resolution, then obtain its separate exact governed approval and pointer transition.')
except Exception as error:
    message = ('Publication retry stopped: ' + str(error) + '\nNext: preserve this run and every prior failed receipt, both local commits, all Asks and the reviewed retry pair. Resolve only the named precondition; never repeat acceptance, reset/rebase Git, force-push, or revive a Grant. A stale lock requires proof its recorded process is terminal before operator recovery.\n')
    (out/'failure-handoff.txt').write_text(message)
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)
finally:
    if owned_lock:
        (lock/'owner.json').unlink()
        lock.rmdir()
PY
    then cat "$run_dir/run.log"; printf 'Publication receipt: %s/publication.json\n' "$run_dir"
    else cat "$run_dir/run.log" >&2; printf 'Failure handoff: %s/failure-handoff.txt\n' "$run_dir" >&2; exit 1
    fi
    ;;
  *) printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64 ;;
esac
