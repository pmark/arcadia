#!/usr/bin/env node
// One bounded invocation owns preview, semantic validation, apply and publication.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [descriptor, mode] = process.argv.slice(2);
if (process.argv.length !== 4 || !['run', '--describe'].includes(mode)) {
  console.error('Usage: run-plan-amendment.mjs <descriptor> run|--describe');
  process.exit(64);
}
if (mode === '--describe') { process.stdout.write(readFileSync(descriptor)); process.exit(0); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = path.dirname(path.resolve(descriptor));
const id = path.basename(descriptor, '.json');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) process.exit(64);
const latest = path.join(library, 'runs/receipts', `${id}.json`);
let timedOut = false;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/plan-amendment-worker.ts'), path.resolve(descriptor)], {
  cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], detached: true
});
child.stdout.on('data', bytes => { output += bytes.toString(); });
const timer = setTimeout(() => {
  timedOut = true;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* It may have exited at the deadline. */ }
}, 240_000);
let finished = false;
function finish(code, error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  let result;
  try { result = JSON.parse(output); } catch { /* Bootstrap or a crash may produce no JSON. */ }
  if (!result || timedOut) {
    let previous;
    try { previous = JSON.parse(readFileSync(latest, 'utf8')); } catch { /* No worker journal exists yet. */ }
    const owned = previous?.pid === child.pid ? previous : {};
    const runDirectory = owned.runDirectory ?? path.join(library, 'runs', `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`);
    result = { ...owned, schema: 'arcadia-plan-amendment-receipt-v1', id, pid: child.pid, status: 'failed',
      reason: timedOut ? 'RUNNER_TIMEOUT' : 'HOST_RUNTIME_UNAVAILABLE',
      message: timedOut ? 'The bounded amendment invocation exceeded four minutes.' : `The host runner stopped before returning a receipt${error ? ': ' + error.message : '.'}`,
      next: 'Preserve this receipt and retry this exact action after restoring the host runtime. Any existing canonical settlement is verified and recovered without applying twice.',
      runDirectory };
    mkdirSync(runDirectory, { recursive: true });
    writeFileSync(path.join(runDirectory, 'launcher-receipt.json'), JSON.stringify(result, null, 2) + '\n');
    writeFileSync(path.join(runDirectory, 'failure-handoff.txt'), `${result.reason}: ${result.message}\nNext: ${result.next}\n`);
    // Never overwrite another live invocation's journal.
    if (!previous || previous.pid === child.pid) {
      mkdirSync(path.dirname(latest), { recursive: true });
      writeFileSync(`${latest}.tmp-${process.pid}`, JSON.stringify(result, null, 2) + '\n');
      renameSync(`${latest}.tmp-${process.pid}`, latest);
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = timedOut ? 1 : code ?? 1;
}
child.once('error', error => finish(1, error));
child.once('close', code => finish(code));
