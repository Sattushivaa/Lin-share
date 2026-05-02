const form = document.getElementById('uploadForm');
const filesInput = document.getElementById('files');
const messageEl = document.getElementById('message');
const sendBtn = document.getElementById('sendBtn');
const refreshBtn = document.getElementById('refreshBtn');
const filesList = document.getElementById('filesList');
const pairToken = new URLSearchParams(window.location.search).get('token') || '';
const deviceId = localStorage.getItem('landropDeviceId') || crypto.randomUUID();
let deviceToken = localStorage.getItem('landropDeviceToken') || '';
localStorage.setItem('landropDeviceId', deviceId);

async function registerDevice() {
  if (deviceToken) return;
  const res = await fetch(`/register-device?token=${encodeURIComponent(pairToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, deviceName: navigator.userAgent })
  });
  const payload = await res.json();
  deviceToken = payload.deviceToken;
  localStorage.setItem('landropDeviceToken', deviceToken);
}

async function refreshFiles() {
  try {
    const res = await fetch('/files', {
      headers: { 'X-LanDrop-Token': deviceToken }
    });
    if (!res.ok) throw new Error(await res.text());
    const payload = await res.json();
    filesList.innerHTML = '';
    for (const f of payload.files) {
      const li = document.createElement('li');
      li.textContent = `${f.name} (${Math.ceil(f.size / 1024)} KB)`;
      filesList.appendChild(li);
    }
    if (!payload.files.length) {
      filesList.innerHTML = '<li>No files in drop folder yet.</li>';
    }
  } catch (error) {
    messageEl.textContent = `Could not load files: ${error.message}`;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!filesInput.files.length) {
    messageEl.textContent = 'Please pick at least one file.';
    return;
  }

  const data = new FormData();
  for (const file of filesInput.files) {
    data.append('files', file, file.name);
  }

  sendBtn.disabled = true;
  messageEl.textContent = 'Uploading...';

  try {
    const res = await fetch('/upload', { method: 'POST', body: data, headers: { 'X-LanDrop-Token': deviceToken } });
    const text = await res.text();
    messageEl.textContent = res.ok ? text.trim() : `Upload failed: ${text.trim()}`;
    if (res.ok) await refreshFiles();
  } catch (error) {
    messageEl.textContent = `Network error: ${error.message}`;
  } finally {
    sendBtn.disabled = false;
  }
});

refreshBtn.addEventListener('click', refreshFiles);
(async () => {
  try {
    await registerDevice();
    await refreshFiles();
  } catch (error) {
    messageEl.textContent = `Registration failed: ${error.message}`;
  }
})();
