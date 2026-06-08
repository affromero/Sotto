function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function isLocalHttpHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function normalizeAppBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('Sotto deployment URL is required');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Sotto deployment URL must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Sotto deployment URL must use http or https');
  }

  if (parsed.protocol === 'http:' && !isLocalHttpHost(parsed.hostname)) {
    throw new Error('Use HTTPS for non-local Sotto deployments');
  }

  parsed.hash = '';
  parsed.search = '';
  const pathname = trimTrailingSlashes(parsed.pathname);
  parsed.pathname = pathname.endsWith('/api') ? pathname.slice(0, -4) || '/' : pathname || '/';

  return trimTrailingSlashes(parsed.toString());
}

function apiUrl(appBaseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${appBaseUrl}/api${normalizedPath}`;
}

async function getConfig() {
  const data = await chrome.storage.sync.get(['apiKey', 'appBaseUrl']);
  return {
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    appBaseUrl: typeof data.appBaseUrl === 'string' ? data.appBaseUrl : '',
  };
}

async function setConfig({ apiKey, appBaseUrl }) {
  const normalizedAppBaseUrl = normalizeAppBaseUrl(appBaseUrl);
  const normalizedApiKey = String(apiKey || '').trim();

  if (!normalizedApiKey) {
    throw new Error('API key is required');
  }

  await chrome.storage.sync.set({
    apiKey: normalizedApiKey,
    appBaseUrl: normalizedAppBaseUrl,
  });
}

function clearAuth() {
  return chrome.storage.sync.remove('apiKey');
}

async function checkAuth() {
  const { apiKey, appBaseUrl } = await getConfig();
  if (!appBaseUrl) {
    return { ok: false, error: 'No Sotto deployment URL configured' };
  }
  if (!apiKey) {
    return { ok: false, error: 'No API key configured' };
  }

  let normalizedAppBaseUrl;
  try {
    normalizedAppBaseUrl = normalizeAppBaseUrl(appBaseUrl);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  try {
    const res = await fetch(apiUrl(normalizedAppBaseUrl, '/users/me'), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      return { ok: false, error: 'Invalid API key' };
    }

    const user = await res.json();
    return { ok: true, user, appBaseUrl: normalizedAppBaseUrl };
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
  const { apiKey, appBaseUrl } = await getConfig();
  if (!appBaseUrl) {
    return { ok: false, error: 'No Sotto deployment URL configured' };
  }
  if (!apiKey) {
    return { ok: false, error: 'No API key configured' };
  }

  let normalizedAppBaseUrl;
  try {
    normalizedAppBaseUrl = normalizeAppBaseUrl(appBaseUrl);
  } catch (err) {
    return { ok: false, error: err.message };
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

    const res = await fetch(apiUrl(normalizedAppBaseUrl, '/podcasts/import'), {
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
  if (message.type === 'GET_CONFIG') {
    getConfig()
      .then(({ appBaseUrl }) => {
        sendResponse({
          appBaseUrl: appBaseUrl ? normalizeAppBaseUrl(appBaseUrl) : '',
        });
      })
      .catch((err) => sendResponse({ appBaseUrl: '', error: err.message }));
    return true;
  }

  if (message.type === 'CHECK_AUTH') {
    checkAuth().then(sendResponse);
    return true;
  }

  if (message.type === 'SET_CONFIG') {
    setConfig({ apiKey: message.apiKey, appBaseUrl: message.appBaseUrl })
      .then(() => checkAuth())
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'CLEAR_AUTH') {
    clearAuth().then(() => sendResponse({ ok: true }));
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
