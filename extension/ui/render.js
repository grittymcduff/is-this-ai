// Renders a report from the backend. Shared by the extension and the web page
// (the backend serves this folder at /ui/).

const LEVELS = {
  ai_confirmed: { tone: 'ai', icon: '●' },
  ai_edited: { tone: 'ai', icon: '◐' },
  likely_ai: { tone: 'ai', icon: '▲' },
  possibly_ai: { tone: 'maybe', icon: '△' },
  inconclusive: { tone: 'neutral', icon: '?' },
  likely_human: { tone: 'human', icon: '○' },
  verified_capture: { tone: 'human', icon: '✓' },
};
const SOURCE_LABEL = { c2pa: 'Content Credentials', metadata: 'File metadata', classifier: 'AI classifier' };
const DIRECTION_LABEL = { ai: 'Points to AI', human: 'Points to human', none: 'Neutral' };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

export function renderLoading(root, message = 'Checking…') {
  root.replaceChildren(el('div', { class: 'iti-loading', role: 'status' }, el('span', { class: 'iti-spinner' }), message));
}

export function renderError(root, message, hint) {
  root.replaceChildren(el('div', { class: 'iti-card iti-error', role: 'alert' },
    el('h2', {}, "Couldn't check this"), el('p', {}, message), hint ? el('p', { class: 'iti-hint' }, hint) : null));
}

function describeInput(r) {
  if (r.kind === 'text') return `Selected text · ${r.input.chars.toLocaleString()} characters`;
  const mb = (r.input.bytes / 1048576).toFixed(r.input.bytes > 1048576 ? 1 : 2);
  return `${r.kind === 'video' ? 'Video' : 'Image'} · ${r.input.mimeType} · ${mb} MB`;
}

export function renderReport(root, r) {
  const meta = LEVELS[r.verdict.level] || LEVELS.inconclusive;
  const signals = r.verdict.signals.map((s) => el('li', { class: `iti-signal iti-dir-${s.direction}` },
    el('div', { class: 'iti-signal-head' },
      el('span', { class: 'iti-source' }, SOURCE_LABEL[s.source] || s.source),
      s.strength !== 'info' ? el('span', { class: 'iti-tag' }, `${DIRECTION_LABEL[s.direction]} · ${s.strength}`) : null),
    el('p', {}, s.finding)));

  const frames = r.classifier?.frames?.length > 1 ? el('div', { class: 'iti-frames', 'aria-label': 'AI score per sampled frame' },
    ...r.classifier.frames.map((f) => el('span', { title: `${f.t}s: ${Math.round(f.score * 100)}%`, style: `--h:${Math.max(4, f.score * 100)}%` }))) : null;

  const c2paRows = r.c2pa?.present ? el('dl', { class: 'iti-dl' },
    ...[['Made with', r.c2pa.tool], ['Signed by', r.c2pa.signer], ['Issuer', r.c2pa.issuer], ['Signed at', r.c2pa.signedAt],
      ['Source type', r.c2pa.sourceTypes?.join(', ')], ['Actions', r.c2pa.actions?.join(', ')], ['Validation', r.c2pa.validationState]]
      .filter(([, v]) => v).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])) : null;

  root.replaceChildren(...[
    r.verdict.demo ? el('div', { class: 'iti-demo' }, 'DEMO MODE · classifier scores are fake') : null,
    el('section', { class: `iti-card iti-verdict iti-tone-${meta.tone}` },
      el('div', { class: 'iti-icon', 'aria-hidden': 'true' }, meta.icon),
      el('div', {}, el('h2', {}, r.verdict.headline), el('p', { class: 'iti-sub' }, describeInput(r)))),
    el('section', { class: 'iti-card' }, el('h3', {}, 'What we found'), el('ul', { class: 'iti-signals' }, signals), frames),
    c2paRows ? el('section', { class: 'iti-card' }, el('h3', {}, 'Content Credentials'), c2paRows) : null,
    el('section', { class: 'iti-card iti-caveats' }, el('h3', {}, 'Keep in mind'), el('ul', {}, r.verdict.caveats.map((c) => el('li', {}, c)))),
    el('details', { class: 'iti-raw' }, el('summary', {}, 'Raw report (JSON)'), el('pre', {}, JSON.stringify(r, null, 2))),
  ].filter(Boolean));
}
