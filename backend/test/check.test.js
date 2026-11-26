// Run with: npm test   (regenerate fixtures with: npm run fixtures)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMedia, checkText } from '../src/check.js';
import { sniffMime } from '../src/media.js';
import { readPngText } from '../src/signals/metadata.js';

const fx = (f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', f));

test('plain photo with no provenance is not marked as confirmed either way', async () => {
  const r = await checkMedia({ buffer: fx('photo-plain.jpg') });
  assert.equal(r.kind, 'image');
  assert.equal(r.c2pa.present, false);
  assert.ok(!['ai_confirmed', 'verified_capture'].includes(r.verdict.level));
  assert.equal(r.verdict.demo, true);
});

test('image with AI Content Credentials is confirmed AI', async () => {
  const r = await checkMedia({ buffer: fx('ai-c2pa.jpg') });
  assert.equal(r.c2pa.present, true);
  assert.equal(r.c2pa.intact, true);
  assert.equal(r.c2pa.origin, 'ai');
  assert.equal(r.verdict.level, 'ai_confirmed');
});

test('video with AI Content Credentials is confirmed AI', async () => {
  const r = await checkMedia({ buffer: fx('clip-ai-c2pa.mp4') });
  assert.equal(r.kind, 'video');
  assert.equal(r.verdict.level, 'ai_confirmed');
});

test('camera claim from an untrusted signer is only a weak hint', async () => {
  const r = await checkMedia({ buffer: fx('photo-camera-c2pa.jpg') });
  assert.equal(r.c2pa.origin, 'capture');
  assert.equal(r.c2pa.trustedSigner, false);
  assert.notEqual(r.verdict.level, 'verified_capture');
});

test('tampered file: credentials fail validation and are not trusted', async () => {
  const buf = Buffer.from(fx('ai-c2pa.jpg'));
  buf[buf.length - 500] ^= 0xff; // flip bits in the image data after signing
  const r = await checkMedia({ buffer: buf });
  assert.equal(r.c2pa.present, true);
  assert.equal(r.c2pa.intact, false);
  assert.ok(r.c2pa.problems.length > 0);
  assert.notEqual(r.verdict.level, 'ai_confirmed');
});

test('Stable Diffusion settings in a PNG are flagged as likely AI', async () => {
  const r = await checkMedia({ buffer: fx('sd-params.png') });
  assert.equal(r.verdict.level, 'likely_ai');
  assert.ok(r.verdict.signals.some((s) => s.source === 'metadata' && s.direction === 'ai'));
  assert.match(readPngText(fx('sd-params.png')).parameters, /Steps: 30/);
});

test('text results are always capped at "possibly AI" or "inconclusive"', async () => {
  for (let i = 0; i < 25; i++) {
    const r = await checkText({ text: `Sample paragraph number ${i}. `.repeat(5) });
    assert.ok(['possibly_ai', 'inconclusive'].includes(r.verdict.level), r.verdict.level);
    assert.ok(r.verdict.caveats.some((c) => /Text detectors/.test(c)));
  }
});

test('very short text is rejected', async () => {
  await assert.rejects(() => checkText({ text: 'hello there' }), /at least a few sentences/);
});

test('file types are identified from their bytes', () => {
  assert.equal(sniffMime(fx('photo-plain.jpg')), 'image/jpeg');
  assert.equal(sniffMime(fx('sd-params.png')), 'image/png');
  assert.equal(sniffMime(fx('clip-plain.mp4')), 'video/mp4');
  assert.equal(sniffMime(Buffer.from('<!doctype html><html>')), null);
});
