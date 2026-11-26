// Looks for clues in ordinary file metadata: EXIF/XMP/IPTC tags and PNG text chunks.
// Generators often leave fingerprints here, but anyone can strip or fake them,
// so these are weaker than signed C2PA data.
import exifr from 'exifr';

const GENERATORS = [
  'midjourney', 'dall-e', 'dall·e', 'dalle', 'stable diffusion', 'stablediffusion', 'sdxl', 'comfyui',
  'automatic1111', 'invokeai', 'novelai', 'firefly', 'imagen', 'gemini', 'chatgpt', 'openai', 'gpt-4o',
  'flux', 'leonardo', 'ideogram', 'runway', 'sora', 'veo', 'kling', 'pika', 'made with google ai',
  'microsoft designer', 'bing image creator', 'grok', 'aurora', 'recraft', 'seedream',
];
// PNG text keys written by popular image-generation tools.
const GENERATOR_PNG_KEYS = {
  parameters: 'Stable Diffusion WebUI generation settings',
  prompt: 'ComfyUI prompt graph',
  workflow: 'ComfyUI workflow',
  dream: 'InvokeAI generation settings',
  'sd-metadata': 'InvokeAI generation settings',
  'invokeai_metadata': 'InvokeAI generation settings',
};

function findGenerator(text) {
  const t = String(text || '').toLowerCase();
  return GENERATORS.find((g) => t.includes(g)) || null;
}

// Minimal PNG chunk reader for tEXt and iTXt chunks.
export function readPngText(buf) {
  const out = {};
  if (!buf || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return out;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'tEXt' || type === 'iTXt') {
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = data.toString('latin1', 0, nul);
        let value;
        if (type === 'tEXt') value = data.toString('latin1', nul + 1);
        else {
          // iTXt: keyword\0 compFlag compMethod lang\0 transKeyword\0 text
          const compressed = data[nul + 1] === 1;
          let p = nul + 3;
          p = data.indexOf(0, p) + 1;
          p = data.indexOf(0, p) + 1;
          value = compressed ? '[compressed]' : data.toString('utf8', p);
        }
        out[key] = value.slice(0, 2000);
      }
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

export async function readMetadata(buffer, mimeType) {
  const signals = [];
  const summary = {};

  if (mimeType?.startsWith('image/')) {
    let tags = null;
    try {
      tags = await exifr.parse(buffer, { tiff: true, exif: true, xmp: true, iptc: true, mergeOutput: true });
    } catch { /* unreadable metadata is common and fine */ }
    if (tags) {
      for (const field of ['Software', 'CreatorTool', 'Credit', 'Artist', 'ImageDescription', 'Make', 'Model']) {
        if (tags[field]) summary[field] = String(tags[field]).slice(0, 200);
      }
      const sourceType = tags.DigitalSourceType || tags.digitalsourcetype;
      if (sourceType) summary.DigitalSourceType = String(sourceType);
      if (/trainedAlgorithmicMedia/i.test(String(sourceType || ''))) {
        signals.push({ direction: 'ai', strength: 'strong', finding: 'IPTC metadata labels this file as AI-generated (trainedAlgorithmicMedia).' });
      }
      for (const field of ['Software', 'CreatorTool', 'Credit', 'ImageDescription']) {
        const g = findGenerator(tags[field]);
        if (g) signals.push({ direction: 'ai', strength: 'strong', finding: `Metadata field "${field}" names an AI tool ("${g}").` });
      }
      if (tags.Make && tags.Model && !signals.some((s) => s.direction === 'ai')) {
        signals.push({ direction: 'human', strength: 'weak', finding: `Camera details present (${tags.Make} ${tags.Model}). Easy to fake, so this is only a weak hint.` });
      }
    }
  }

  if (mimeType === 'image/png') {
    const text = readPngText(buffer);
    if (Object.keys(text).length) summary.pngText = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.slice(0, 300)]));
    for (const [key, label] of Object.entries(GENERATOR_PNG_KEYS)) {
      const hit = Object.keys(text).find((k) => k.toLowerCase() === key);
      if (hit) signals.push({ direction: 'ai', strength: 'strong', finding: `PNG contains ${label} ("${hit}" field).` });
    }
    for (const [k, v] of Object.entries(text)) {
      const g = findGenerator(v);
      if (g && !GENERATOR_PNG_KEYS[k.toLowerCase()]) signals.push({ direction: 'ai', strength: 'medium', finding: `PNG text field "${k}" mentions an AI tool ("${g}").` });
    }
  }

  return { signals: dedupe(signals), summary };
}

function dedupe(signals) {
  const seen = new Set();
  return signals.filter((s) => (seen.has(s.finding) ? false : seen.add(s.finding)));
}
