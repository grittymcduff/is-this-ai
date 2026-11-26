// Picks the classifier. To add another vendor, write an object with the same
// shape as mock.js (checkImage / checkVideo / checkText) and register it here.
import { config } from '../config.js';
import { mockProvider } from './mock.js';
import { hiveProvider } from './hive.js';
import { sightengineProvider } from './sightengine.js';

const providers = { mock: mockProvider, hive: hiveProvider, sightengine: sightengineProvider };

export function getProvider() {
  const p = providers[config.provider];
  if (!p) throw new Error(`Unknown PROVIDER "${config.provider}". Use one of: ${Object.keys(providers).join(', ')}`);
  return p;
}

// Runs the classifier, turning failures and unsupported types into a "skipped" result
// so one bad vendor call never breaks the whole report.
export async function runClassifier(kind, input) {
  const p = getProvider();
  const base = { provider: p.name, isMock: p.isMock };
  if (!p.supports[kind]) {
    return { ...base, skipped: true, reason: `${p.name} doesn't check ${kind}.` };
  }
  const fn = { image: p.checkImage, video: p.checkVideo, text: p.checkText }[kind];
  try {
    return { ...base, ...(await fn.call(p, input)) };
  } catch (err) {
    return { ...base, skipped: true, reason: String(err.message || err).slice(0, 300) };
  }
}
