// Reads C2PA Content Credentials: a signed record of how a file was made.
// When present and intact, this is the strongest signal we have.
import fs from 'node:fs';
import { Reader, Context } from '@contentauth/c2pa-node';
import { config } from '../config.js';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
// IPTC "digital source type" values, grouped by what they mean for us.
const AI_TYPES = ['trainedAlgorithmicMedia'];
const AI_EDITED_TYPES = ['compositeWithTrainedAlgorithmicMedia'];
const SYNTHETIC_TYPES = ['algorithmicMedia', 'compositeSynthetic', 'virtualRecording'];
const CAPTURE_TYPES = ['digitalCapture', 'negativeFilm', 'positiveFilm', 'print', 'computationalCapture', 'screenCapture'];

function shortType(t) {
  return typeof t === 'string' ? t.replace(IPTC, '') : null;
}

let context = null;
function getContext() {
  if (context) return context;
  // The SDK wants PEM text (or an https URL), not a file path.
  const src = config.c2paTrustAnchors;
  let trustAnchors;
  if (/^https:\/\//.test(src)) trustAnchors = src;
  else if (src && fs.existsSync(src)) trustAnchors = fs.readFileSync(src, 'utf8');
  else if (src) console.warn(`C2PA_TRUST_ANCHORS file not found: ${src}`);
  context = new Context(trustAnchors
    ? { verify: { verifyTrust: true }, trust: { verifyTrustList: true, trustAnchors } }
    : { verify: { verifyTrust: true } });
  return context;
}

function actionsOf(manifest) {
  const out = [];
  for (const a of manifest?.assertions || []) {
    if (a.label?.startsWith('c2pa.actions')) out.push(...(a.data?.actions || []));
  }
  return out;
}

export async function readC2pa(buffer, mimeType) {
  let reader;
  try {
    reader = await Reader.fromAsset({ buffer, mimeType }, getContext());
  } catch (err) {
    const msg = String(err?.message || err);
    // "No manifest" is the normal case for most files, not an error.
    if (/ManifestNotFound|JumbfNotFound|no.*manifest|not found|UnsupportedType/i.test(msg)) return { present: false };
    return { present: false, error: msg.slice(0, 200) };
  }
  if (!reader) return { present: false };

  const store = reader.json();
  const active = reader.getActive();
  const manifests = Object.values(store.manifests || {});
  const failures = store.validation_results?.activeManifest?.failure || store.validation_status || [];
  const untrusted = failures.some((f) => f.code === 'signingCredential.untrusted');
  const tamperCodes = failures.map((f) => f.code).filter((c) => c !== 'signingCredential.untrusted');

  // Source types from the current manifest, and from any earlier manifests (ingredients).
  const activeTypes = actionsOf(active).map((a) => shortType(a.digitalSourceType)).filter(Boolean);
  const historyTypes = manifests.filter((m) => m !== active)
    .flatMap((m) => actionsOf(m).map((a) => shortType(a.digitalSourceType)).filter(Boolean));
  const allTypes = [...new Set([...activeTypes, ...historyTypes])];

  let origin = 'unknown';
  if (allTypes.some((t) => AI_TYPES.includes(t))) origin = 'ai';
  else if (allTypes.some((t) => AI_EDITED_TYPES.includes(t))) origin = 'ai_edited';
  else if (allTypes.some((t) => SYNTHETIC_TYPES.includes(t))) origin = 'synthetic';
  else if (allTypes.some((t) => CAPTURE_TYPES.includes(t))) origin = 'capture';

  const gen = active?.claim_generator_info?.[0];
  return {
    present: true,
    intact: tamperCodes.length === 0,
    trustedSigner: !untrusted && tamperCodes.length === 0,
    validationState: store.validation_state,
    problems: tamperCodes,
    signer: active?.signature_info?.common_name || active?.signature_info?.issuer || null,
    issuer: active?.signature_info?.issuer || null,
    signedAt: active?.signature_info?.time || null,
    tool: gen ? [gen.name, gen.version].filter(Boolean).join(' ') : (active?.claim_generator || null),
    sourceTypes: allTypes,
    actions: actionsOf(active).map((a) => a.action),
    origin,
    manifestCount: manifests.length,
  };
}
