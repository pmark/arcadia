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
import hashlib, json, os, pathlib, signal, subprocess, sys

root = pathlib.Path('/Users/pmark/Dev/MR/Arcadia/arcadia')
out = pathlib.Path(os.environ['ARCADIA_ENROLLMENT_REVIEW_RUN_DIR'])
action_id = 'accept-enrollment-and-saved-config-2026-10-02-v2'
proposal = 'enroll-any-session-and-preserve-production-config-2026-10-02-v2'
base = 'fdafca81cc3843f3355e883cfe92d057c01fa609'
fingerprint = '46b22ffc37626a52b33ab66ebff899f85a77e5179eda0a0272683c1b687b5f19'
ask_sha = 'd097ab1e6b42e0bb6fb4312db982733e6cc95e5906aa4ebbcf943f456d898e74'
pair = [f'artifacts/generated/operator-scripts/{action_id}.{ext}' for ext in ('sh', 'json')]
ask_path = f'.arcadia/asks/agent-ask-{proposal}.yaml'
archive_path = f'.arcadia/asks/archive/agent-ask-{proposal}.yaml'
keys = ['arcadia/enroll-session-through-governed-host-request', 'arcadia/persist-inactive-production-configuration']

def command(args, timeout=120):
    child = subprocess.Popen(args, cwd=root, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, start_new_session=True)
    try:
        output, _ = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try: output, _ = child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            output, _ = child.communicate()
        print(output, flush=True)
        raise RuntimeError('Bounded command timed out: ' + ' '.join(args[:3]))
    if child.returncode:
        print(output, flush=True)
        raise RuntimeError('Command refused: ' + ' '.join(args[:3]))
    return output

def canonical(args, name):
    output = command(args)
    value = json.loads(output[output.index('{'):])
    (out / name).write_text(json.dumps(value, indent=2) + '\n')
    if not value.get('ok'): raise RuntimeError('Canonical command did not confirm success.')
    return value

def validate_history(receipt):
    head = command(['git', 'rev-parse', 'HEAD'], 30).strip()
    commits = command(['git', 'rev-list', '--reverse', f'{base}..{head}'], 30).splitlines()
    if len(commits) > 2: raise RuntimeError('Unreviewed commits entered main; publication refuses.')
    parent = base
    for index, sha in enumerate(commits):
        parents = command(['git', 'rev-list', '--parents', '-n', '1', sha], 30).split()[1:]
        if parents != [parent]: raise RuntimeError('Main history differs from the exact reviewed lineage.')
        subject = command(['git', 'show', '-s', '--format=%s', sha], 30).strip()
        paths = set(command(['git', 'diff', '--name-only', parent, sha], 30).splitlines())
        if index == 0:
            if subject != 'chore: preserve reviewed enrollment operator action' or paths != set(pair):
                raise RuntimeError('Only the exact library-pair commit may follow the reviewed base.')
            for path in pair:
                if command(['git', 'show', f'{sha}:{path}'], 30) != (root / path).read_text():
                    raise RuntimeError('The committed library pair differs from the reviewed live pair.')
        else:
            if not receipt.get('applied') or subject != f'chore(arcadia): settle {proposal}':
                raise RuntimeError('Only the confirmed canonical settlement may follow the library-pair commit.')
            previews = []
            for prior in out.parent.glob('*/settlement-preview.json'):
                try:
                    candidate = json.loads(prior.read_text())['data']['receipt']
                    if candidate.get('previewFingerprint') == fingerprint and candidate.get('review', {}).get('documents'):
                        previews.append(candidate)
                except (ValueError, KeyError): continue
            documents = next((v['review']['documents'] for v in previews if not v.get('applied')), None)
            if documents is None: raise RuntimeError('The pinned original document preview is missing; preserve and refresh the action.')
            changes = {}
            for document in documents:
                path = document['path']
                if path in changes:
                    raise RuntimeError('The reviewed settlement preview names a path more than once.')
                changes[path] = (document['before'], document['after'])
            expected_paths = set()
            for path, (reviewed_before, after) in changes.items():
                present_before = path in command(['git', 'ls-tree', '--name-only', parent, '--', path], 30).splitlines()
                before = command(['git', 'show', f'{parent}:{path}'], 30) if present_before else None
                if before != reviewed_before:
                    raise RuntimeError('The settlement parent no longer matches its exact reviewed document preview.')
                if reviewed_before != after: expected_paths.add(path)
                if after is None:
                    if path in command(['git', 'ls-tree', '--name-only', sha, '--', path], 30).splitlines():
                        raise RuntimeError('A canonically removed path still exists in the settlement tree.')
                elif command(['git', 'show', f'{sha}:{path}'], 30) != after:
                    raise RuntimeError('The settlement tree differs from its exact reviewed document effects.')
            if paths != expected_paths: raise RuntimeError('Settlement history omits or adds reviewed document changes.')
        parent = sha
    if receipt.get('applied') and len(commits) != 2:
        raise RuntimeError('Applied receipt lacks the exact two-commit publication lineage; preserve and refresh.')
    return head

try:
    if command(['git', 'rev-parse', '--show-toplevel'], 30).strip() != str(root):
        raise RuntimeError('The reviewed main checkout is not available.')
    if command(['git', 'branch', '--show-current'], 30).strip() != 'main':
        raise RuntimeError('This action is pinned to main.')
    if command(['git', 'remote', 'get-url', 'origin'], 30).strip() != 'https://github.com/pmark/arcadia.git':
        raise RuntimeError('Origin differs from the reviewed repository.')
    command(['git', 'merge-base', '--is-ancestor', base, 'HEAD'], 30)
    dirty = command(['git', 'status', '--porcelain', '-z'], 30).split('\0')
    for entry in filter(None, dirty):
        state, path = entry[:2], entry[3:]
        if state == '??' and (path in pair or path.startswith('.arcadia/asks/')): continue
        raise RuntimeError('Unrelated local or staged changes must be preserved before acceptance.')
    staged = set(command(['git', 'diff', '--cached', '--name-only'], 30).splitlines())
    if staged: raise RuntimeError('Existing staged changes refuse acceptance, including changes to this library pair.')
    descriptor = json.loads((root / pair[1]).read_text())
    if (descriptor.get('reviewedBase') != base or descriptor.get('askSha256') != ask_sha or
        descriptor.get('settlementFingerprint') != fingerprint or descriptor.get('agentAsk') !=
        {'proposal': proposal, 'intent': 'action', 'targetRef': None} or
        descriptor.get('reviewedScriptSha256') != hashlib.sha256((root / pair[0]).read_bytes()).hexdigest()):
        raise RuntimeError('The library pair differs from its reviewed contract or script digest.')
    source = root / ask_path
    if not source.exists(): source = root / archive_path
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != ask_sha:
        raise RuntimeError('The exact reviewed Ask is missing or changed.')
    args = ['arcadia', 'agent-ask', 'settle', '--proposal', proposal, '--request-id', 'refresh-accept-enrollment-and-saved-config-2026-10-02-v2',
            '--disposition', 'accepted', '--responsibility', 'agent',
            '--before', 'arcadia/prove-literal-split-browser-and-ledger', '--revision', '180', '--json']
    receipt = canonical(args, 'settlement-preview.json')['data']['receipt']
    if receipt.get('previewFingerprint') != fingerprint or receipt.get('queueActionKeys') != keys or receipt.get('queuePosition') != 1:
        raise RuntimeError('The settlement differs from the exact reviewed two-Action insertion.')
    validate_history(receipt)
    if not receipt.get('applied'):
        # Publishing the reviewed library pair is explicit in this action's
        # descriptor. This is no Git reconciliation and stages nothing else.
        # The generated library is normally ignored. Only these two exact
        # reviewed files are explicitly preserved, never the whole directory.
        command(['git', 'add', '-f', '--', *pair], 30)
        if command(['git', 'diff', '--cached', '--name-only'], 30).strip():
            command(['git', 'commit', '-m', 'chore: preserve reviewed enrollment operator action'], 60)
        (out / 'preparation.json').write_text(json.dumps({'head': validate_history(receipt)}) + '\n')
        receipt = canonical(args + ['--preview', fingerprint, '--operator', '--apply'], 'settlement-receipt.json')['data']['receipt']
    else:
        (out / 'settlement-receipt.json').write_text(json.dumps({'receipt': receipt}, indent=2) + '\n')
    if not receipt.get('applied') or receipt.get('previewFingerprint') != fingerprint or receipt.get('queueActionKeys') != keys:
        raise RuntimeError('Arcadia did not confirm the exact accepted settlement.')
    if command(['git', 'diff', 'HEAD', '--', *pair], 30).strip():
        raise RuntimeError('The operator library pair changed after settlement; publication refuses.')
    for path in pair: command(['git', 'ls-files', '--error-unmatch', path], 30)
    published_sha = validate_history(receipt)
    command(['git', 'push', 'origin', f'{published_sha}:refs/heads/main'], 120)
    (out / 'publication.json').write_text(json.dumps({'publishedSha': published_sha}) + '\n')
    print('Two Actions accepted and published. Production remains Off; current proof pointer is unchanged.')
    print('Next: scheduled follow-up prepares the canonical execution handoff; activation stays separately gated.')
except Exception as error:
    message = ('Acceptance stopped: ' + str(error) + '\n'
               'Next: inspect this run log and retained receipts. Preserve any local commit or applied settlement. '
               'Retry unchanged failed publication with the same action; moved scope or queue requires a fresh review. '
               'Do not reset main, delete candidates, or manually change governance.\n')
    (out / 'failure-handoff.txt').write_text(message)
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)
PY
    then cat "$run_dir/run.log"; printf 'Receipt: %s/settlement-receipt.json\n' "$run_dir"
    else cat "$run_dir/run.log" >&2; printf 'Failure handoff: %s/failure-handoff.txt\n' "$run_dir" >&2; exit 1
    fi
    ;;
  *) printf 'Usage: %s run|--describe\n' "$0" >&2; exit 64 ;;
esac
