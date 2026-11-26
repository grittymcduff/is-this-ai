// Runs every check for one piece of content and assembles the report.
import crypto from 'node:crypto';
import { readC2pa } from './signals/c2pa.js';
import { readMetadata } from './signals/metadata.js';
import { runClassifier } from './providers/index.js';
import { buildVerdict } from './verdict.js';
import { kindFromMime, sniffMime, UserError } from './media.js';
import { config } from './config.js';

export async function checkMedia({ buffer, mimeType, sourceUrl, pageUrl }) {
  const started = Date.now();
  const mime = sniffMime(buffer) || mimeType;
  const kind = kindFromMime(mime);
  if (!kind) throw new UserError(`Unsupported file type (${mime || 'unknown'}). Images and videos only.`, 415);

  const [c2pa, metadata, classifier] = await Promise.all([
    readC2pa(buffer, mime),
    readMetadata(buffer, mime),
    runClassifier(kind, { buffer, mimeType: mime, url: sourceUrl }),
  ]);
  return {
    kind,
    input: {
      sourceUrl: sourceUrl || null,
      pageUrl: pageUrl || null,
      mimeType: mime,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    },
    verdict: buildVerdict({ kind, c2pa, metadata, classifier }),
    c2pa,
    metadata: metadata.summary,
    classifier,
    ms: Date.now() - started,
  };
}

export async function checkText({ text, pageUrl }) {
  const started = Date.now();
  const clean = String(text || '').trim();
  if (clean.length < 40) throw new UserError('Select at least a few sentences. Very short text can\'t be judged at all.');
  if (clean.length > config.maxTextChars) throw new UserError(`Text is too long (limit ${config.maxTextChars} characters).`, 413);
  const classifier = await runClassifier('text', { text: clean });
  return {
    kind: 'text',
    input: { pageUrl: pageUrl || null, chars: clean.length, preview: clean.slice(0, 160) },
    verdict: buildVerdict({ kind: 'text', classifier }),
    classifier,
    ms: Date.now() - started,
  };
}
