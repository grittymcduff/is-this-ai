import { getBackend, health } from './api.js';

const input = document.getElementById('backend');
const msg = document.getElementById('msg');

input.value = await getBackend();
document.getElementById('save').addEventListener('click', async () => {
  let url;
  try { url = new URL(input.value.trim()).toString().replace(/\/+$/, ''); } catch {
    msg.textContent = 'That isn\'t a valid address.';
    return;
  }
  await chrome.storage.sync.set({ backendUrl: url });
  msg.textContent = 'Saved. Testing…';
  try {
    const h = await health();
    msg.textContent = `Saved. Connected (classifier: ${h.provider}${h.demo ? ', demo mode' : ''}).`;
  } catch {
    msg.textContent = 'Saved, but the backend isn\'t answering at that address.';
  }
});
