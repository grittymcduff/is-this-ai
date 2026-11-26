// Combines every signal into one plain-language result.
// Principle: report what the evidence says and how strong it is. Never overclaim.

export const VERDICTS = {
  ai_confirmed: 'AI-generated: the file carries a signed record saying so',
  ai_edited: 'Contains AI-generated parts, according to its signed record',
  likely_ai: 'Likely AI-generated',
  possibly_ai: 'Possibly AI-generated',
  inconclusive: 'Inconclusive',
  likely_human: 'No signs of AI found',
  verified_capture: 'Verified camera capture',
};

const POINTS = { strong: 3, medium: 2, weak: 1 };

function c2paSignals(c2pa) {
  if (!c2pa?.present) {
    return [{ source: 'c2pa', direction: 'none', strength: 'info',
      finding: "No Content Credentials found. That's normal: most files don't have them, and many sites strip them on upload." }];
  }
  if (!c2pa.intact) {
    return [{ source: 'c2pa', direction: 'none', strength: 'medium',
      finding: `Content Credentials are present but fail validation (${c2pa.problems.slice(0, 3).join(', ')}). The file may have been changed after signing, so its record can't be relied on.` }];
  }
  const who = c2pa.tool ? ` by ${c2pa.tool}` : '';
  const trustNote = c2pa.trustedSigner ? '' : ' The signer isn\'t on a configured trust list, but files rarely claim to be AI falsely.';
  switch (c2pa.origin) {
    case 'ai':
      return [{ source: 'c2pa', direction: 'ai', strength: 'strong', finding: `Signed Content Credentials say this was generated with AI${who}.${trustNote}` }];
    case 'ai_edited':
      return [{ source: 'c2pa', direction: 'ai', strength: 'strong', finding: `Signed Content Credentials say AI-generated material was combined into this file${who}.${trustNote}` }];
    case 'synthetic':
      return [{ source: 'c2pa', direction: 'ai', strength: 'medium', finding: `Signed Content Credentials say this is computer-generated (not a camera capture)${who}.` }];
    case 'capture':
      return c2pa.trustedSigner
        ? [{ source: 'c2pa', direction: 'human', strength: 'strong', finding: `Signed Content Credentials from a trusted signer (${c2pa.signer}) say this was captured by a camera.` }]
        : [{ source: 'c2pa', direction: 'human', strength: 'weak', finding: `Content Credentials claim a camera capture, but the signer (${c2pa.signer || 'unknown'}) isn't on a configured trust list.` }];
    default:
      return [{ source: 'c2pa', direction: 'none', strength: 'info', finding: `Content Credentials are present${who} but don't say whether AI was used.` }];
  }
}

function classifierSignals(cls, kind) {
  if (!cls) return [];
  const label = cls.isMock ? 'Demo classifier (fake score)' : `${cls.provider} classifier`;
  if (cls.skipped) return [{ source: 'classifier', direction: 'none', strength: 'info', finding: `${label} skipped: ${cls.reason}` }];
  const pct = Math.round(cls.score * 100);
  const gen = cls.generator ? ` Closest match: ${cls.generator}.` : '';
  const out = [];
  if (kind === 'text') {
    // Text detectors produce many false positives, so they can only ever nudge.
    if (cls.score >= 0.85) out.push({ source: 'classifier', direction: 'ai', strength: 'weak', finding: `${label}: ${pct}% likely AI-written. Text detectors are often wrong, so treat this as a hint.` });
    else if (cls.score <= 0.15) out.push({ source: 'classifier', direction: 'human', strength: 'weak', finding: `${label}: ${pct}% likely AI-written.` });
    else out.push({ source: 'classifier', direction: 'none', strength: 'info', finding: `${label}: ${pct}% likely AI-written (no clear lean).` });
    return out;
  }
  if (cls.score >= 0.9) out.push({ source: 'classifier', direction: 'ai', strength: 'medium', finding: `${label}: ${pct}% likely AI-generated.${gen}` });
  else if (cls.score >= 0.7) out.push({ source: 'classifier', direction: 'ai', strength: 'weak', finding: `${label}: ${pct}% likely AI-generated.${gen}` });
  else if (cls.score <= 0.1) out.push({ source: 'classifier', direction: 'human', strength: 'medium', finding: `${label}: ${pct}% likely AI-generated.` });
  else if (cls.score <= 0.3) out.push({ source: 'classifier', direction: 'human', strength: 'weak', finding: `${label}: ${pct}% likely AI-generated.` });
  else out.push({ source: 'classifier', direction: 'none', strength: 'info', finding: `${label}: ${pct}% likely AI-generated (no clear lean).` });
  if (cls.deepfake >= 0.9) out.push({ source: 'classifier', direction: 'ai', strength: 'medium', finding: `${label}: ${Math.round(cls.deepfake * 100)}% likely a face-swap deepfake.` });
  if (cls.aiAudio >= 0.9) out.push({ source: 'classifier', direction: 'ai', strength: 'weak', finding: `${label}: the audio track is likely AI-generated.` });
  return out;
}

export function buildVerdict({ kind, c2pa, metadata, classifier }) {
  const signals = [
    ...(kind === 'text' ? [] : c2paSignals(c2pa)),
    ...(metadata?.signals || []).map((s) => ({ source: 'metadata', ...s })),
    ...classifierSignals(classifier, kind),
  ];

  const strongAi = signals.find((s) => s.direction === 'ai' && s.strength === 'strong');
  const c2paAi = c2pa?.present && c2pa.intact && ['ai', 'ai_edited'].includes(c2pa.origin);
  const trustedCapture = c2pa?.present && c2pa.intact && c2pa.origin === 'capture' && c2pa.trustedSigner;
  let ai = 0; let human = 0;
  for (const s of signals) {
    if (s.direction === 'ai') ai += POINTS[s.strength] || 0;
    if (s.direction === 'human') human += POINTS[s.strength] || 0;
  }

  let level;
  if (c2paAi) level = c2pa.origin === 'ai' ? 'ai_confirmed' : 'ai_edited';
  else if (trustedCapture) level = 'verified_capture';
  else if (strongAi) level = 'likely_ai';
  else {
    const diff = ai - human;
    level = diff >= 2 ? 'likely_ai' : diff === 1 ? 'possibly_ai' : diff <= -2 ? 'likely_human' : 'inconclusive';
  }
  // Text detection is too unreliable for confident answers either way.
  if (kind === 'text' && !['possibly_ai', 'inconclusive'].includes(level)) level = level.includes('ai') ? 'possibly_ai' : 'inconclusive';

  const conflict = (level === 'verified_capture' && ai > 0) || (['ai_confirmed', 'ai_edited'].includes(level) && human > 0);
  const caveats = [
    'AI detection gives evidence, not proof. Weigh this alongside where the content came from.',
  ];
  if (conflict) caveats.unshift('Some signals disagree with this result. See the details.');
  if (level === 'likely_human') caveats.unshift("\"No signs of AI\" isn't the same as \"made by a person\". Newer generators can slip past detectors.");
  if (kind === 'text') caveats.unshift('Text detectors are frequently wrong, especially for short, edited or non-native-English writing. Never use this alone to accuse someone.');
  if (classifier?.isMock) caveats.unshift('DEMO MODE: the classifier score is fake. Set PROVIDER=hive or PROVIDER=sightengine for real scores.');

  return { level, headline: VERDICTS[level], signals, caveats, demo: Boolean(classifier?.isMock) };
}
