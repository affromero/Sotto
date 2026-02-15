const API_BASE = 'https://sotto.fm';

function getApiKey() {
  return chrome.storage.sync.get('apiKey').then((data) => data.apiKey || null);
}

function setApiKey(key) {
  return chrome.storage.sync.set({ apiKey: key });
}

function clearApiKey() {
  return chrome.storage.sync.remove('apiKey');
}

async function checkAuth() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'No API key configured' };
  }

  try {
    const res = await fetch(`${API_BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      return { ok: false, error: 'Invalid API key' };
    }

    const user = await res.json();
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: `Connection failed: ${err.message}` };
  }
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function uploadAudio(base64Data, filename, notebookTitle) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'No API key configured' };
  }

  try {
    const arrayBuffer = base64ToArrayBuffer(base64Data);
    const ext = filename.split('.').pop()?.toLowerCase() || 'wav';
    const mimeMap = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/m4a',
      mp4: 'audio/mp4',
      ogg: 'audio/ogg',
      webm: 'audio/webm',
      aac: 'audio/aac',
      opus: 'audio/ogg',
    };
    const mimeType = mimeMap[ext] || 'audio/mpeg';

    const blob = new Blob([arrayBuffer], { type: mimeType });
    const formData = new FormData();
    formData.append('audio', blob, filename);
    formData.append('sourcePlatform', 'notebooklm');
    formData.append('isHumanContent', 'false');
    if (notebookTitle) {
      formData.append('title', notebookTitle);
    }

    const res = await fetch(`${API_BASE}/api/podcasts/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || `Upload failed (${res.status})` };
    }

    const result = await res.json();
    await chrome.storage.local.set({
      lastImport: {
        podcastId: result.id,
        title: notebookTitle || 'Untitled',
        timestamp: Date.now(),
      },
    });

    return { ok: true, podcastId: result.id };
  } catch (err) {
    return { ok: false, error: `Upload failed: ${err.message}` };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_AUTH') {
    checkAuth().then(sendResponse);
    return true;
  }

  if (message.type === 'SET_API_KEY') {
    setApiKey(message.apiKey)
      .then(() => checkAuth())
      .then(sendResponse);
    return true;
  }

  if (message.type === 'CLEAR_API_KEY') {
    clearApiKey()
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'UPLOAD_AUDIO') {
    uploadAudio(message.base64Data, message.filename, message.notebookTitle).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_LAST_IMPORT') {
    chrome.storage.local.get('lastImport').then((data) => {
      sendResponse(data.lastImport || null);
    });
    return true;
  }
});
