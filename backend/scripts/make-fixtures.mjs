// Generates test media in test/fixtures:
//  photo-plain.jpg        - ordinary JPEG, no provenance (should be inconclusive)
//  photo-camera-c2pa.jpg  - C2PA manifest saying "digital capture" (camera)
//  ai-c2pa.jpg            - C2PA manifest saying "trainedAlgorithmicMedia" (AI)
//  sd-params.png          - PNG with Stable Diffusion style "parameters" text chunk
//  clip-plain.mp4         - short video with no provenance
//  clip-ai-c2pa.mp4       - short video with an AI C2PA manifest
// Uses the public C2PA *test* certificate (untrusted by design).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { Builder, LocalSigner } from '@contentauth/c2pa-node';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const p = (f) => path.join(dir, f);
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

ff('-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', p('photo-plain.jpg'));
ff('-f', 'lavfi', '-i', 'mandelbrot=size=512x512', '-frames:v', '1', p('base.png'));
ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-pix_fmt', 'yuv420p', p('clip-plain.mp4'));

// PNG with a tEXt "parameters" chunk like AUTOMATIC1111 / Stable Diffusion WebUI writes.
function addPngText(src, dest, key, value) {
  const buf = fs.readFileSync(src);
  const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const type = Buffer.from('tEXt');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0);
  const chunk = Buffer.concat([len, type, data, crc]);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + IHDR chunk
  fs.writeFileSync(dest, Buffer.concat([buf.subarray(0, ihdrEnd), chunk, buf.subarray(ihdrEnd)]));
}
addPngText(p('base.png'), p('sd-params.png'), 'parameters',
  'a castle on a hill at sunset\nSteps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345, Model: sd_xl_base_1.0');

const cert = fs.readFileSync(p('certs/es256.pub'));
const key = fs.readFileSync(p('certs/es256.pem'));
const signer = LocalSigner.newSigner(cert, key, 'es256');

async function sign(src, dest, mimeType, sourceType, softwareAgent) {
  const builder = await Builder.withJsonAsync({
    claim_generator_info: [{ name: softwareAgent, version: '1.0' }],
    title: path.basename(dest),
    format: mimeType,
    assertions: [{
      label: 'c2pa.actions',
      data: { actions: [{ action: 'c2pa.created', digitalSourceType: sourceType, softwareAgent }] },
    }],
  });
  await builder.sign(signer, { path: src, mimeType }, { path: dest });
}
const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
await sign(p('photo-plain.jpg'), p('photo-camera-c2pa.jpg'), 'image/jpeg', IPTC + 'digitalCapture', 'Example Camera App');
await sign(p('photo-plain.jpg'), p('ai-c2pa.jpg'), 'image/jpeg', IPTC + 'trainedAlgorithmicMedia', 'Example Image Generator');
await sign(p('clip-plain.mp4'), p('clip-ai-c2pa.mp4'), 'video/mp4', IPTC + 'trainedAlgorithmicMedia', 'Example Video Generator');
fs.unlinkSync(p('base.png'));
console.log('fixtures written to', dir, fs.readdirSync(dir));
