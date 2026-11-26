// Separate file (separate process) because the trust list is read from env at startup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
process.env.C2PA_TRUST_ANCHORS = path.join(dir, 'certs', 'test-trust-anchor.pem');
const { checkMedia } = await import('../src/check.js');

test('camera capture signed by a trusted signer is a verified capture', async () => {
  const r = await checkMedia({ buffer: fs.readFileSync(path.join(dir, 'photo-camera-c2pa.jpg')) });
  assert.equal(r.c2pa.trustedSigner, true);
  assert.equal(r.verdict.level, 'verified_capture');
});
