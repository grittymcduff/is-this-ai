// Talks to the backend. The backend address is set on the extension's Options page.
export const DEFAULT_BACKEND = 'http://localhost:8787';
const MAX_UPLOAD = 50 * 1024 * 1024;

export async function getBackend() {
  const { backendUrl } = await chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND });
  return backendUrl.replace(/\/+$/, '');
}

async function call(body, isForm) {
  const base = await getBackend();
  let res;
  try {
    res = await fetch(`${base}/api/check`, {
      method: 'POST',
      body: isForm ? body : JSON.stringify(body),
      headers: isForm ? undefined : { 'content-type': 'application/json' },
    });
  } catch {
    throw new Error(`Can't reach the checker at ${base}. Is the backend running? (cd backend && npm start)`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Checker returned HTTP ${res.status}`);
  return json;
}

export function checkText(text, pageUrl) {
  return call({ text, pageUrl });
}

export function checkUrl(url, pageUrl) {
  return call({ url, pageUrl });
}

export function checkBlob(blob, { sourceUrl, pageUrl, name = 'upload' } = {}) {
  if (blob.size > MAX_UPLOAD) throw new Error('That file is larger than the 50 MB demo limit.');
  const form = new FormData();
  form.append('file', blob, name);
  if (sourceUrl && !sourceUrl.startsWith('data:')) form.append('sourceUrl', sourceUrl);
  if (pageUrl) form.append('pageUrl', pageUrl);
  return call(form, true);
}

// Prefer downloading the media in the browser: it works for images behind a
// sign-in and for data: URLs. Fall back to letting the server fetch it.
export async function checkMediaUrl(srcUrl, pageUrl) {
  if (srcUrl.startsWith('blob:')) {
    throw new Error("This media is streamed in pieces by the site (a blob: address), so there's no single file to check. Common on YouTube, TikTok and Instagram.");
  }
  let blob = null;
  try {
    const res = await fetch(srcUrl, { credentials: 'include' });
    if (res.ok) {
      const len = Number(res.headers.get('content-length') || 0);
      if (!len || len <= MAX_UPLOAD) blob = await res.blob();
    }
  } catch { /* fall through to server-side fetch */ }
  if (blob && blob.size <= MAX_UPLOAD) return checkBlob(blob, { sourceUrl: srcUrl, pageUrl });
  return checkUrl(srcUrl, pageUrl);
}

export async function health() {
  const base = await getBackend();
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
