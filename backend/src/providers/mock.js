// DEMO ONLY. Returns made-up but repeatable scores so the whole pipeline can be
// exercised without paying for an API. Never present these as real results.
import crypto from 'node:crypto';

function fakeScore(seed) {
  const h = crypto.createHash('sha256').update(seed).digest();
  return Math.round((h.readUInt16BE(0) / 65535) * 100) / 100;
}

export const mockProvider = {
  name: 'mock',
  isMock: true,
  supports: { image: true, video: true, text: true },
  async checkImage({ buffer }) {
    return { score: fakeScore(buffer), generator: null };
  },
  async checkVideo({ buffer }) {
    const frames = [0, 1, 2, 3].map((i) => ({ t: i, score: fakeScore(Buffer.concat([buffer.subarray(0, 4096), Buffer.from([i])])) }));
    return { score: Math.max(...frames.map((f) => f.score)), frames };
  },
  async checkText({ text }) {
    return { score: fakeScore(text) };
  },
};
