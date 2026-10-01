// Fixed host-owned fixture worker. No shell, external URL, browser flag, or
// command inputs. All descendants inherit the parent-applied Seatbelt policy.
import { readFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// Playwright normally detaches Chrome. Keep every launch in the supervised
// worker group so a host timeout kills Chrome and all of its descendants too.
const originalSpawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  const child = originalSpawn(command, args, { ...options, detached: false });
  if (child.pid) console.error(`ARCADIA_AUDIT_CHILD ${child.pid}`);
  return child;
};
syncBuiltinESMExports();
const result = { ready: false, stage: 'denial.probes', denials: {}, renders: [], error: null };
const stage = value => { result.stage = value; console.error(`ARCADIA_AUDIT_STAGE ${value}`); };
const denied = error => ['EPERM', 'EACCES'].includes(error.code);
function socketDenied(options) {
  return new Promise(resolve => {
    const socket = net.connect(options);
    socket.setTimeout(1500, () => { socket.destroy(); resolve({ denied: false, error: 'timeout is not denial proof' }); });
    socket.once('error', error => { socket.destroy(); resolve({ denied: denied(error), error: error.code }); });
    socket.once('connect', () => { socket.destroy(); resolve({ denied: false, error: 'unexpected connection' }); });
  });
}
let browser;
try {
  try { readFileSync(input.credentialSentinel); result.denials.credentials = { denied: false }; }
  catch (error) { result.denials.credentials = { denied: denied(error), error: error.code }; }
  result.denials.external = await socketDenied({ host: '198.51.100.1', port: 9 });
  result.denials.privateNetwork = await socketDenied({ host: '10.255.255.1', port: 9 });
  result.denials.otherLoopback = await socketDenied({ host: '127.0.0.1', port: 9 });
  result.denials.unrelatedUnix = await socketDenied({ path: input.socketSentinel });
  const escape = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(0)'], { detached: true, timeout: 2000, env: process.env });
  // Observe this separately: fixed-worker group cleanup is proven below, but
  // native detached child creation is not an OS-enforced containment boundary.
  result.processGroupEscape = { denied: !!escape.error && denied(escape.error), error: escape.error?.code ?? `exit ${escape.status}` };
  stage('browser.launch');
  const { chromium } = (await import(pathToFileURL(input.playwrightEntry).href)).default;
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: 15000,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-gpu'] });
  if (input.stallAfterLaunch) {
    stage('browser.fault.stall');
    await new Promise(() => setInterval(() => {}, 1000));
  }
  for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    stage(`browser.render.${name}`);
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const response = await page.goto(input.origin, { timeout: 10000, waitUntil: 'load' });
    const rendered = await page.locator('body').getAttribute('data-rendered') === 'yes';
    const title = await page.title();
    const screenshot = path.join(input.scratch, `${name}.png`);
    await page.screenshot({ path: screenshot, timeout: 5000 });
    result.renders.push({ name, viewport, status: response?.status(), rendered, title, screenshot });
    await context.close();
  }
  stage('browser.external-denial');
  const page = await browser.newPage();
  try { await page.goto('http://198.51.100.1:81/', { timeout: 2000 }); result.denials.browserExternal = { denied: false }; }
  catch (error) { result.denials.browserExternal = { denied: /ERR_(?:NETWORK_)?ACCESS_DENIED/.test(error.message), error: error.message.slice(-1000) }; }
  result.ready = Object.values(result.denials).every(item => item.denied) && result.renders.length === 2 && result.renders.every(render => render.status === 200 && render.rendered);
  stage(result.ready ? 'complete' : 'boundary.refused');
} catch (error) { result.error = error.message.slice(-8192); }
finally {
  if (browser) { try { await browser.close(); } catch (error) { result.error ??= error.message.slice(-1000); result.ready = false; } }
  console.log(JSON.stringify(result));
  process.exitCode = result.ready ? 0 : 2;
}
