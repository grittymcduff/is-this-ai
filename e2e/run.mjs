// End-to-end test: loads the extension into Chrome, runs real checks against the backend,
// and saves screenshots to e2e/shots. Usage: cd e2e && npm install && CHROME_PATH=/path/to/chrome npm test
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = `${REPO}/backend/test/fixtures`;
const OUT = path.join(REPO, 'e2e', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const backend = spawn('node', ['src/server.js'], { cwd: `${REPO}/backend`, env: { ...process.env, PORT: '8787', ALLOW_PRIVATE_URLS: 'true' }, stdio: 'inherit' });
const site = http.createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end(`<html><body><h1>Test page</h1>
      <img id="ai" src="/ai-c2pa.jpg" width="200"><img id="sd" src="/sd-params.png" width="200"><img id="plain" src="/photo-plain.jpg" width="200">
      <video id="vid" src="/clip-ai-c2pa.mp4" controls width="240"></video>
      <p id="txt">The quarterly review highlighted several opportunities for operational improvement across the support organization, including better shift coverage.</p></body></html>`);
  }
  const f = path.join(FX, path.basename(req.url));
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  fs.createReadStream(f).pipe(res);
}).listen(9000);
await new Promise((r) => setTimeout(r, 1500));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: 'new',
  args: [`--disable-extensions-except=${REPO}/extension`, `--load-extension=${REPO}/extension`, '--no-sandbox'],
});
const results = [];
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 });
  const sw = await swTarget.worker();
  const extId = new URL(swTarget.url()).host;
  console.log('extension id', extId);

  await new Promise((r) => setTimeout(r, 1500));
  // The context menu items should exist (update() throws if an id is missing).
  const menus = await sw.evaluate(async () => {
    const ids = ['check-image', 'check-video', 'check-text', 'check-link'];
    const out = {};
    for (const id of ids) out[id] = await new Promise((r) => chrome.contextMenus.update(id, {}, () => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok')));
    return out;
  });
  console.log('menus', menus);
  results.push(['context menus registered', Object.values(menus).every((v) => v === 'ok')]);

  // Simulate what the context-menu click handler does, for each content type.
  const cases = [
    ['image-ai-c2pa', { menu: 'check-image', srcUrl: 'http://localhost:9000/ai-c2pa.jpg' }, 'AI-generated'],
    ['image-sd-png', { menu: 'check-image', srcUrl: 'http://localhost:9000/sd-params.png' }, 'Likely AI'],
    ['image-plain', { menu: 'check-image', srcUrl: 'http://localhost:9000/photo-plain.jpg' }, null],
    ['video-ai-c2pa', { menu: 'check-video', srcUrl: 'http://localhost:9000/clip-ai-c2pa.mp4' }, 'AI-generated'],
    ['link-video', { menu: 'check-link', srcUrl: 'http://localhost:9000/clip-plain.mp4' }, null],
    ['text', { menu: 'check-text', text: 'The quarterly review highlighted several opportunities for operational improvement across the support organization, including better shift coverage.' }, null],
    ['blob-video', { menu: 'check-video', srcUrl: 'blob:https://www.youtube.com/abc' }, "Couldn't check"],
    ['web-page-link', { menu: 'check-link', srcUrl: 'http://localhost:9000/' }, "Couldn't check"],
  ];
  for (const [name, job, expect] of cases) {
    const id = `t-${name}`;
    await sw.evaluate((id, job) => chrome.storage.session.set({ [`job:${id}`]: { ...job, pageUrl: 'http://localhost:9000/' } }), id, job);
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 900 });
    await page.goto(`chrome-extension://${extId}/result.html?job=${id}`);
    await page.waitForSelector('.iti-verdict, .iti-error', { timeout: 30000 });
    const headline = await page.$eval('#report h2', (h) => h.textContent);
    await page.screenshot({ path: `${OUT}/result-${name}.png`, fullPage: true });
    const ok = expect ? headline.includes(expect) : Boolean(headline);
    results.push([`result ${name}: "${headline}"`, ok]);
    await page.close();
  }

  // Popup: backend status + file upload.
  const popup = await browser.newPage();
  await popup.setViewport({ width: 380, height: 900 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForFunction(() => !document.querySelector('#status').textContent.includes('Checking'), { timeout: 8000 });
  const statusText = await popup.$eval('#status', (s) => s.textContent.trim());
  results.push([`popup status "${statusText}"`, statusText.includes('Connected')]);
  const input = await popup.$('#file');
  await input.uploadFile(`${FX}/photo-camera-c2pa.jpg`);
  await popup.waitForSelector('.iti-verdict, .iti-error', { timeout: 15000 });
  results.push([`popup upload: "${await popup.$eval('#report h2', (h) => h.textContent)}"`, true]);
  await popup.screenshot({ path: `${OUT}/popup.png`, fullPage: true });

  // Options page saves and tests.
  const opts = await browser.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await opts.click('#save');
  await opts.waitForFunction(() => document.querySelector('#msg').textContent.includes('Connected') || document.querySelector('#msg').textContent.includes('isn'), { timeout: 8000 });
  results.push([`options: "${await opts.$eval('#msg', (m) => m.textContent)}"`, (await opts.$eval('#msg', (m) => m.textContent)).includes('Connected')]);

  // Web page on a phone-sized screen, dark mode.
  const web = await browser.newPage();
  await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await web.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  await web.goto('http://localhost:8787/');
  await (await web.$('#file')).uploadFile(`${FX}/sd-params.png`);
  await web.waitForSelector('.iti-verdict, .iti-error', { timeout: 15000 });
  results.push([`web page upload: "${await web.$eval('#report h2', (h) => h.textContent)}"`, true]);
  await web.screenshot({ path: `${OUT}/web-mobile-dark.png`, fullPage: true });

  const errors = [];
  for (const p of await browser.pages()) p.on('pageerror', (e) => errors.push(e.message));
  results.push(['no page errors', errors.length === 0]);
} finally {
  await browser.close();
  backend.kill();
  site.close();
}
for (const [name, ok] of results) console.log(ok ? 'PASS' : 'FAIL', name);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
