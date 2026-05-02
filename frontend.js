const form = document.getElementById('uploadForm');
const filesInput = document.getElementById('files');
const messageEl = document.getElementById('message');
const sendBtn = document.getElementById('sendBtn');

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
    const res = await fetch('/upload', { method: 'POST', body: data });
    const text = await res.text();
    messageEl.textContent = res.ok ? text.trim() : `Upload failed: ${text.trim()}`;
  } catch (error) {
    messageEl.textContent = `Network error: ${error.message}`;
  } finally {
    sendBtn.disabled = false;
  }
});
