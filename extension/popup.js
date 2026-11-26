import { checkBlob, checkText, health } from './api.js';
import { renderReport, renderError, renderLoading } from './ui/render.js';

const root = document.getElementById('report');
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const text = document.getElementById('text');
const textBtn = document.getElementById('checkText');
const status = document.getElementById('status');

async function showStatus() {
  const [dot, label] = status.children;
  try {
    const h = await health();
    dot.className = 'iti-dot ok';
    label.textContent = h.demo ? 'Connected · demo mode' : `Connected · ${h.provider}`;
  } catch {
    dot.className = 'iti-dot bad';
    label.textContent = 'Backend offline';
  }
}

async function run(fn) {
  renderLoading(root);
  try { renderReport(root, await fn()); } catch (err) { renderError(root, err.message); }
}

function handleFile(file) {
  if (file) run(() => checkBlob(file, { name: file.name }));
}

fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); handleFile(e.dataTransfer.files[0]); });
text.addEventListener('input', () => { textBtn.disabled = text.value.trim().length < 40; });
textBtn.addEventListener('click', () => run(() => checkText(text.value)));
showStatus();
