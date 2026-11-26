// Hive AI-Generated & Deepfake Content Detection (images and video).
// Docs: https://docs.thehive.ai/docs/ai-image-and-video-detection
// Not tested against the live API in this POC (needs a paid key).
import { config } from '../config.js';

const ENDPOINT = 'https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection';
const NON_ENGINE = new Set(['ai_generated', 'not_ai_generated', 'deepfake', 'none', 'inconclusive',
  'inconclusive_video', 'ai_generated_audio', 'not_ai_generated_audio']);

async function call({ buffer, mimeType, url }) {
  if (!config.hiveApiKey) throw new Error('HIVE_API_KEY is not set.');
  const headers = { authorization: `Bearer ${config.hiveApiKey}` };
  let body;
  if (buffer && buffer.length <= 20 * 1024 * 1024) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ input: [{ media_base64: `data:${mimeType};base64,${buffer.toString('base64')}` }] });
  } else if (buffer) {
    const form = new FormData();
    form.append('media', new Blob([buffer], { type: mimeType }), 'upload');
    body = form;
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ input: [{ media_url: url }] });
  }
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`Hive returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function parse(json) {
  const frames = (json.output || []).map((o) => {
    const cls = Object.fromEntries((o.classes || []).map((c) => [c.class, c.value]));
    const t = (o.extra || []).find((e) => e.name === 'timestamp')?.value ?? 0;
    const engines = Object.entries(cls).filter(([k]) => !NON_ENGINE.has(k)).sort((a, b) => b[1] - a[1]);
    return { t, score: cls.ai_generated ?? 0, deepfake: cls.deepfake ?? 0, engine: engines[0], audio: cls.ai_generated_audio ?? 0 };
  });
  if (!frames.length) throw new Error('Hive response had no output.');
  const top = frames.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    score: top.score,
    deepfake: Math.max(...frames.map((f) => f.deepfake)),
    aiAudio: Math.max(...frames.map((f) => f.audio)),
    generator: top.engine && top.engine[1] >= 0.5 ? top.engine[0] : null,
    frames: frames.length > 1 ? frames.map(({ t, score }) => ({ t, score })) : undefined,
  };
}

export const hiveProvider = {
  name: 'hive',
  isMock: false,
  supports: { image: true, video: true, text: false },
  async checkImage(input) { return parse(await call(input)); },
  async checkVideo(input) { return parse(await call(input)); },
};
