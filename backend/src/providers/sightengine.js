// Sightengine "genai" model (images and short videos). Has a free tier.
// Docs: https://sightengine.com/docs/ai-generated-image-detection
// Not tested against the live API in this POC (needs your own key).
import { config } from '../config.js';

function form(buffer, mimeType, extra = {}) {
  if (!config.sightengineUser || !config.sightengineSecret) {
    throw new Error('SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET are not set.');
  }
  const f = new FormData();
  f.append('media', new Blob([buffer], { type: mimeType }), 'upload');
  f.append('models', 'genai');
  f.append('api_user', config.sightengineUser);
  f.append('api_secret', config.sightengineSecret);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

async function post(path, body) {
  const res = await fetch(`https://api.sightengine.com/1.0/${path}`, { method: 'POST', body, signal: AbortSignal.timeout(90000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== 'success') throw new Error(`Sightengine error: ${json.error?.message || res.status}`);
  return json;
}

function topGenerator(gens) {
  const top = Object.entries(gens || {}).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 0.5 ? top[0] : null;
}

export const sightengineProvider = {
  name: 'sightengine',
  isMock: false,
  supports: { image: true, video: true, text: false },
  async checkImage({ buffer, mimeType }) {
    const json = await post('check.json', form(buffer, mimeType));
    return { score: json.type?.ai_generated ?? 0, generator: topGenerator(json.type?.ai_generators) };
  },
  async checkVideo({ buffer, mimeType }) {
    // The sync endpoint is meant for clips under a minute.
    const json = await post('video/check-sync.json', form(buffer, mimeType, { interval: '1' }));
    const frames = (json.data?.frames || []).map((f) => ({ t: f.info?.position ?? 0, score: f.type?.ai_generated ?? 0 }));
    return { score: frames.length ? Math.max(...frames.map((f) => f.score)) : 0, frames };
  },
};
