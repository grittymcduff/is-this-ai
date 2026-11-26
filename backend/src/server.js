// HTTP API for the "Is this AI?" proof of concept.
//   GET  /api/health          -> which classifier is active
//   POST /api/check           -> multipart upload (field "file"), or JSON {url} / {text}
//   GET  /                    -> simple web page for uploading a file by hand (works on phones too)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { getProvider } from './providers/index.js';
import { fetchMedia, UserError } from './media.js';
import { checkMedia, checkText } from './check.js';

export function createApp() {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxBytes, files: 1 } });

  // The browser extension calls from a chrome-extension:// origin.
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (/^(chrome|moz)-extension:\/\//.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'content-type');
      res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (req, res) => {
    const p = getProvider();
    res.json({ ok: true, provider: p.name, demo: p.isMock, version: '0.1.0' });
  });

  app.post('/api/check', upload.single('file'), express.json({ limit: '1mb' }), async (req, res, next) => {
    try {
      const body = req.body || {};
      let report;
      if (req.file) {
        report = await checkMedia({ buffer: req.file.buffer, mimeType: req.file.mimetype, sourceUrl: body.sourceUrl, pageUrl: body.pageUrl });
      } else if (body.text) {
        report = await checkText({ text: body.text, pageUrl: body.pageUrl });
      } else if (body.url) {
        const media = await fetchMedia(body.url);
        report = await checkMedia({ ...media, sourceUrl: media.finalUrl, pageUrl: body.pageUrl });
      } else {
        throw new UserError('Send a file, a url, or some text.');
      }
      res.json(report);
    } catch (err) { next(err); }
  });

  // The web page reuses the extension's report renderer and icons.
  const here = path.dirname(fileURLToPath(import.meta.url));
  app.use('/ui', express.static(path.join(here, '..', '..', 'extension', 'ui')));
  app.use('/icons', express.static(path.join(here, '..', '..', 'extension', 'icons')));
  app.use(express.static(path.join(here, '..', 'public')));

  app.use((err, req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too large for this demo.' });
    if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
    if (err?.cause?.code === 'ENOTFOUND' || err?.name === 'TimeoutError') return res.status(502).json({ error: "Couldn't download that file." });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong while checking that.' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = getProvider();
  createApp().listen(config.port, () => {
    console.log(`Is This AI? backend on http://localhost:${config.port}  (classifier: ${p.name}${p.isMock ? ' - DEMO, fake scores' : ''})`);
  });
}
