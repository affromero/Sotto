const setupView = document.getElementById('setup-view');
const connectedView = document.getElementById('connected-view');
const loadingView = document.getElementById('loading-view');
const appUrlInput = document.getElementById('app-url-input');
const apiKeyInput = document.getElementById('api-key-input');
const apiKeyLink = document.getElementById('api-key-link');
const connectBtn = document.getElementById('connect-btn');
const setupError = document.getElementById('setup-error');
const userName = document.getElementById('user-name');
const disconnectBtn = document.getElementById('disconnect-btn');
const lastImportEl = document.getElementById('last-import');
const lastImportTitle = document.getElementById('last-import-title');
const lastImportTime = document.getElementById('last-import-time');
const lastImportLink = document.getElementById('last-import-link');

function showView(view) {
  setupView.hidden = true;
  connectedView.hidden = true;
  loadingView.hidden = true;
  view.hidden = false;
}

function showError(msg) {
  setupError.textContent = msg;
  setupError.hidden = false;
}

function hideError() {
  setupError.hidden = true;
}

function normalizeAppBaseUrl(value) {
  const url = new URL(value.trim());
  url.hash = '';
  url.search = '';
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/api') ? pathname.slice(0, -4) || '/' : pathname || '/';
  return url.toString().replace(/\/+$/, '');
}

function updateApiKeyLink() {
  try {
    const appBaseUrl = normalizeAppBaseUrl(appUrlInput.value);
    apiKeyLink.href = `${appBaseUrl}/settings/api`;
    apiKeyLink.hidden = false;
  } catch {
    apiKeyLink.hidden = true;
  }
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function loadLastImport() {
  const [lastImport, config] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_LAST_IMPORT' }),
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }),
  ]);
  if (lastImport) {
    lastImportTitle.textContent = lastImport.title;
    lastImportTime.textContent = formatTimeAgo(lastImport.timestamp);
    lastImportLink.href = `${config.appBaseUrl}/podcast/${lastImport.podcastId}`;
    lastImportEl.hidden = false;
  } else {
    lastImportEl.hidden = true;
  }
}

async function init() {
  showView(loadingView);

  const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (config.appBaseUrl) {
    appUrlInput.value = config.appBaseUrl;
    updateApiKeyLink();
  }

  const result = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });

  if (result.ok) {
    userName.textContent = result.user.name || result.user.email || 'Connected';
    await loadLastImport();
    showView(connectedView);
  } else {
    showView(setupView);
  }
}

connectBtn.addEventListener('click', async () => {
  hideError();
  const appBaseUrl = appUrlInput.value.trim();
  const key = apiKeyInput.value.trim();

  if (!appBaseUrl) {
    showError('Please enter your Sotto deployment URL');
    return;
  }

  try {
    normalizeAppBaseUrl(appBaseUrl);
  } catch {
    showError('Sotto URL must be a valid absolute URL');
    return;
  }

  if (!key) {
    showError('Please enter your API key');
    return;
  }

  if (!key.startsWith('sk_sotto_')) {
    showError('API key must start with sk_sotto_');
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  const result = await chrome.runtime.sendMessage({
    type: 'SET_CONFIG',
    appBaseUrl,
    apiKey: key,
  });

  if (result.ok) {
    userName.textContent = result.user.name || result.user.email || 'Connected';
    await loadLastImport();
    showView(connectedView);
  } else {
    showError(result.error || 'Failed to connect');
  }

  connectBtn.disabled = false;
  connectBtn.textContent = 'Connect';
});

apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    connectBtn.click();
  }
});

appUrlInput.addEventListener('input', updateApiKeyLink);
appUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    connectBtn.click();
  }
});

disconnectBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_AUTH' });
  apiKeyInput.value = '';
  updateApiKeyLink();
  showView(setupView);
});

init();
