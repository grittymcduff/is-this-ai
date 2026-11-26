import { checkMediaUrl, checkText } from './api.js';
import { renderReport, renderError, renderLoading } from './ui/render.js';

const root = document.getElementById('report');
const subject = document.getElementById('subject');

function showSubject(job) {
  if (job.menu === 'check-text') {
    const q = document.createElement('blockquote');
    q.className = 'iti-quote';
    q.textContent = job.text;
    subject.replaceChildren(q);
  } else if (job.menu === 'check-image' && job.srcUrl && !job.srcUrl.startsWith('blob:')) {
    const img = document.createElement('img');
    img.className = 'iti-preview';
    img.alt = 'The image being checked';
    img.src = job.srcUrl;
    img.onerror = () => img.remove();
    subject.replaceChildren(img);
  }
}

async function run() {
  const id = new URLSearchParams(location.search).get('job');
  const key = `job:${id}`;
  const job = (await chrome.storage.session.get(key))[key];
  if (!job) return renderError(root, 'This check has expired.', 'Right-click the item again to re-check it.');
  showSubject(job);
  renderLoading(root, job.menu === 'check-video' ? 'Checking video. This can take a while…' : 'Checking…');
  try {
    const report = job.menu === 'check-text'
      ? await checkText(job.text, job.pageUrl)
      : await checkMediaUrl(job.srcUrl, job.pageUrl);
    renderReport(root, report);
  } catch (err) {
    const hint = /streamed|blob/.test(err.message)
      ? 'If you can download the video, drop the file into the extension popup instead.'
      : null;
    renderError(root, err.message, hint);
  } finally {
    chrome.storage.session.remove(key);
  }
}
run();
