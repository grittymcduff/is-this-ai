// Exercises the HTTP API end to end: upload, URL fetch, text, errors and CORS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALLOW_PRIVATE_URLS = 'true'; // so the API can fetch from the local file server below
const { createApp } = await import('../src/server.js');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let api; let files; let base; let filesBase;

before(async () => {
  api = createApp().listen(0);
  files = http.createServer((req, res) => {
    if (req.url === '/page') { res.setHeader('content-type', 'text/html'); return res.end('<html>hi</html>'); }
    if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('location', '/ai-c2pa.jpg'); return res.end(); }
    const f = path.join(dir, path.basename(req.url));
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'application/octet-stream'); // deliberately wrong, sniffing should fix it
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  base = `http://127.0.0.1:${api.address().port}`;
  filesBase = `http://127.0.0.1:${files.address().port}`;
});
after(() => { api.close(); files.close(); });

const postJson = (body) => fetch(`${base}/api/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('health reports demo classifier', async () => {
  const j = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual([j.ok, j.provider, j.demo], [true, 'mock', true]);
});

test('multipart upload', async () => {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(path.join(dir, 'ai-c2pa.jpg'))]), 'x.jpg');
  form.append('pageUrl', 'https://example.com/article');
  const res = await fetch(`${base}/api/check`, { method: 'POST', body: form });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.verdict.level, 'ai_confirmed');
  assert.equal(j.input.pageUrl, 'https://example.com/article');
});

test('URL fetch follows redirects and sniffs type', async () => {
  const j = await (await postJson({ url: `${filesBase}/redirect` })).json();
  assert.equal(j.input.mimeType, 'image/jpeg');
  assert.equal(j.verdict.level, 'ai_confirmed');
});

test('URL pointing to a web page gets a helpful error', async () => {
  const res = await postJson({ url: `${filesBase}/page` });
  assert.equal(res.status, 415);
  assert.match((await res.json()).error, /web page/);
});

test('text check', async () => {
  const j = await (await postJson({ text: 'This is a reasonably long passage of text. '.repeat(4) })).json();
  assert.equal(j.kind, 'text');
});

test('empty request is a 400', async () => {
  assert.equal((await postJson({})).status, 400);
});

test('CORS allows the extension origin only', async () => {
  const ok = await fetch(`${base}/api/health`, { headers: { origin: 'chrome-extension://abcdef' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'chrome-extension://abcdef');
  const no = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});
