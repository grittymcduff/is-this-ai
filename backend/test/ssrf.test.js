// With default settings the server must refuse to fetch private-network URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ALLOW_PRIVATE_URLS;
const { fetchMedia } = await import('../src/media.js');

test('private and non-http URLs are refused', async () => {
  for (const u of ['http://127.0.0.1/x.jpg', 'http://localhost/x.jpg', 'http://192.168.1.5/a.png',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/a.jpg', 'file:///etc/passwd']) {
    await assert.rejects(() => fetchMedia(u), /private network|Can't fetch/, u);
  }
});
