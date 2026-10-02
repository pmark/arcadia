import http from 'node:http';
import net from 'node:net';
import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';
import lighthouse from 'lighthouse';

// No caller-supplied commands, URLs, flags, ports, or host paths.
const input = JSON.parse(readFileSync('/input/authority.json', 'utf8'));
const origin = 'http://127.0.0.1:43123';
const results = { schema: 'arcadia-container-browser-result-v1', renders: [], reports: [], denials: {}, detachedChild: null };
const stage = value => process.stderr.write(`ARCADIA_CONTAINER_STAGE ${value}\n`);
const emit = () => process.stdout.write(`${JSON.stringify(results)}\n`);
mkdirSync('/tmp/home', { recursive: true });
function readSite(route) {
  const resolved = realpathSync(path.join('/site', route));
  if (!resolved.startsWith('/site/')) throw new Error('preview path escaped snapshot');
  return readFileSync(resolved);
}
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, origin);
    let route = decodeURIComponent(url.pathname);
    if (route.endsWith('/')) route += 'index.html';
    else if (!path.extname(route)) route += '/index.html';
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[path.extname(route)] ?? 'application/octet-stream');
    res.end(readSite(route));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43123, '127.0.0.1', resolve); });
stage('preview.ready');
if (input.proof) {
  for (const [name, host] of [['external', '192.0.2.1'], ['private', '10.0.0.1'], ['hostGateway', '192.168.65.254']]) {
    results.denials[name] = await new Promise(resolve => {
      const socket = net.connect({ host, port: 443 });
      socket.setTimeout(2000, () => { socket.destroy(); resolve('TIMEOUT'); });
      socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
      socket.once('error', error => resolve(error.code));
    });
  }
  try { readFileSync('/credential-sentinel'); results.denials.credentials = 'READ'; }
  catch (error) { results.denials.credentials = error.code; }
  try { readFileSync('/var/run/docker.sock'); results.denials.dockerSocket = 'READ'; }
  catch (error) { results.denials.dockerSocket = error.code; }
  // setsid intentionally leaves the worker's process group. Docker's lifecycle,
  // rather than a signal to that group, must kill it.
  const detached = spawn('/usr/bin/setsid', ['/bin/sleep', '300'], { detached: true, stdio: 'ignore' });
  results.detachedChild = detached.pid;
  detached.unref();
  stage('detached.started');
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=43124', '--remote-debugging-address=127.0.0.1'] });
stage('browser.ready');
if (input.proof && input.stall) { emit(); stage('browser.stall'); await new Promise(() => {}); }
try {
  if (input.proof) {
    const external = await browser.newPage();
    try { await external.goto('https://192.0.2.1', { timeout: 4000 }); results.denials.browserExternal = 'CONNECTED'; }
    catch (error) { results.denials.browserExternal = /ERR_(?:ADDRESS_UNREACHABLE|NETWORK_CHANGED|INTERNET_DISCONNECTED|NETWORK_ACCESS_DENIED)/.test(String(error)) ? 'NETWORK_DENIED' : String(error); }
    await external.close();
  }
  for (const route of input.routes) for (const viewport of input.viewports) {
    const page = await browser.newPage({ viewport });
    const response = await page.goto(origin + route, { waitUntil: 'networkidle', timeout: 15000 });
    results.renders.push({ route, viewport, status: response.status(), title: await page.title(), h1: await page.locator('h1').count() });
    await page.close();
    stage('lighthouse.acquire');
    const desktop = viewport.width >= 1000;
    const result = await lighthouse(origin + route, { port: 43124, logLevel: 'error', output: 'json', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], formFactor: desktop ? 'desktop' : 'mobile', screenEmulation: { mobile: !desktop, width: viewport.width, height: viewport.height, deviceScaleFactor: 1, disabled: false }, throttlingMethod: 'simulate', throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 4, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 }, maxWaitForLoad: 15000 });
    if (!result || result.lhr.runtimeError || result.lhr.finalDisplayedUrl !== origin + route) throw new Error('Lighthouse did not acquire the authorized route');
    results.reports.push({ route, viewport, lhr: result.lhr });
  }
  emit();
  stage('complete');
} finally { await browser.close(); server.close(); }
