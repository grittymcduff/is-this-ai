// Fetching remote media safely, and working out what kind of file we have.
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from './config.js';

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Identify a file from its first bytes. Content-Type headers are often wrong.
export function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 12).toString('latin1');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12);
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'avif') return 'image/avif';
    if (brand.startsWith('qt')) return 'video/quicktime';
    return 'video/mp4';
  }
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  return null;
}

export function kindFromMime(mime) {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

// Blocks the server from being used to reach internal network addresses (SSRF).
async function assertPublicUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UserError(`Can't fetch ${url.protocol} URLs. Send the file itself instead.`);
  }
  if (config.allowPrivateUrls) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(isPrivateAddress)) throw new UserError('That URL points to a private network address.');
}

// Download a URL (following up to 5 redirects) with a size cap.
export async function fetchMedia(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new UserError('Invalid URL.'); }
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'IsThisAI-POC/0.1 (+media check)' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    if (!res.ok) throw new UserError(`The site returned HTTP ${res.status} for that file.`, 502);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > config.maxBytes) throw new UserError('That file is too large for this demo.', 413);
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > config.maxBytes) throw new UserError('That file is too large for this demo.', 413);
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const headerMime = (res.headers.get('content-type') || '').split(';')[0].trim();
    const mimeType = sniffMime(buffer) || headerMime || 'application/octet-stream';
    if (mimeType.startsWith('text/html')) {
      throw new UserError("That link is a web page, not a media file. Sites like YouTube and TikTok don't expose the video file directly.", 415);
    }
    return { buffer, mimeType, finalUrl: url.toString() };
  }
  throw new UserError('Too many redirects.');
}
