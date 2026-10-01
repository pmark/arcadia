// Fixture-only measurement of the installed named profile. No config overrides,
// model calls, real credentials, candidate edits or external service requests.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = 'Arcadia loopback browser fixture';
if (process.argv[2] === '--fixture') {
  const result = { schema: 'arcadia-local-browser-probe-v1', profile: 'arcadia-unattended', localHttp: false,
    browser: false, externalDenied: false, credentialsDenied: false, errors: {} };
  try { readFileSync(path.join(process.cwd(), '.env')); }
  catch (error) { result.credentialsDenied = ['EPERM', 'EACCES'].includes(error.code); result.errors.credentials = error.code; }
  result.externalDenied = await new Promise(resolve => {
    const socket = net.connect({ host: '198.51.100.1', port: 9 }); // RFC 5737 documentation-only destination.
    socket.setTimeout(1000, () => { result.errors.external = 'timeout is not proof of denial'; socket.destroy(); resolve(false); });
    socket.once('error', error => { result.errors.external = error.code; socket.destroy(); resolve(['EPERM', 'EACCES'].includes(error.code)); });
    socket.once('connect', () => { result.errors.external = 'unexpected connection'; socket.destroy(); resolve(false); });
  });
  const server = createServer((request, response) => {
    if (request.url !== '/') { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="en"><title>${marker}</title><h1>${marker}</h1><script>document.body.dataset.rendered='yes'</script></html>`);
  });
  let origin;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}/`;
    result.localHttp = (await fetch(origin)).status === 200;
  } catch (error) { result.errors.localHttp = { code: error.code, message: error.message }; }
  let browser;
  try {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true, timeout: 10000, args: ['--disable-background-networking', '--disable-component-update'] });
    const page = await browser.newPage();
    if (origin) await page.goto(origin, { timeout: 5000 });
    else await page.setContent(`<h1>${marker}</h1>`);
    result.browser = await page.locator('h1').textContent() === marker;
    result.renderedHttp = !!origin && await page.locator('body').getAttribute('data-rendered') === 'yes';
  } catch (error) { result.errors.browser = error.message.slice(-3000); }
  finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  result.ready = result.localHttp && result.renderedHttp && result.externalDenied && result.credentialsDenied;
  console.log(JSON.stringify(result));
  process.exitCode = result.ready ? 0 : 2;
} else {
  if (process.argv.length !== 2) throw Error('No arguments accepted; this probes only the installed arcadia-unattended profile.');
  const root = path.resolve('artifacts/tmp/local-browser-audit');
  mkdirSync(root, { recursive: true });
  const fixture = mkdtempSync(path.join(root, 'probe-'));
  writeFileSync(path.join(fixture, '.env'), 'ARCADIA_SYNTHETIC_SENTINEL=not-a-credential\n');
  const args = ['sandbox', '-P', 'arcadia-unattended', '--include-managed-config', '-C', fixture,
    process.execPath, fileURLToPath(import.meta.url), '--fixture'];
  const child = spawn('codex', args, { detached: true, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-16000); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16000); });
  const timer = setTimeout(() => { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }, 30000);
  child.once('error', error => { stderr += error.message; });
  child.once('close', (status, signal) => {
    clearTimeout(timer);
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    const receipt = { createdAt: new Date().toISOString(), command: ['codex', ...args], status, signal, stdout, stderr };
    const file = path.join(fixture, 'receipt.json');
    writeFileSync(file, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ receipt: file, ...receipt }, null, 2));
    process.exitCode = status === 0 ? 0 : 2;
  });
}
