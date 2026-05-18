/**
 * Content script (ISOLATED world) for the optional NotebookLM import adapter.
 *
 * Responsibilities:
 * 1. Inject injected.js into the page (MAIN world) for audio capture
 * 2. Observe DOM for audio player elements via MutationObserver
 * 3. Inject "Send to Sotto" button when audio player is detected
 * 4. Coordinate capture flow between MAIN world and background worker
 */

// ─── Centralized DOM selectors ───────────────────────────────────────────────
// These are the fragile adaptation points. When the source UI changes,
// update these selectors. See ADAPTATION.md for instructions.
const SELECTORS = {
  // Source audio player container
  audioPlayerContainer: [
    '[data-testid="audio-overview-player"]',
    '[data-testid="audio-player"]',
    '.audio-overview-container',
    'audio-overview',
    '[class*="audio-overview"]',
    '[class*="AudioOverview"]',
  ].join(', '),

  // Download button within the audio player
  downloadButton: [
    'button[aria-label*="Download"]',
    'button[aria-label*="download"]',
    'a[aria-label*="Download"]',
    'a[download]',
    '[data-testid="download-button"]',
  ].join(', '),

  // Audio elements (standard HTML5)
  audioElement: 'audio[src], audio source[src]',

  // Notebook title
  notebookTitle: ['[data-testid="notebook-title"]', '.notebook-title', 'h1'].join(', '),

  // Action bar where we inject our button (near download/share buttons)
  actionBar: [
    '[data-testid="audio-overview-actions"]',
    '.audio-overview-actions',
    '[class*="audio-actions"]',
    '[class*="AudioActions"]',
  ].join(', '),
};

// ─── State ───────────────────────────────────────────────────────────────────
let buttonInjected = false;
let currentState = 'idle'; // idle | capturing | uploading | success | error

// ─── Inject MAIN world script ────────────────────────────────────────────────
function injectMainWorldScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// ─── Button creation ─────────────────────────────────────────────────────────
function createSottoButton() {
  const btn = document.createElement('button');
  btn.id = 'sotto-send-btn';
  btn.setAttribute('data-state', 'idle');
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="sotto-icon">
      <path d="M8 1L3 6h3v5h4V6h3L8 1z" fill="currentColor"/>
      <path d="M2 12v2h12v-2H2z" fill="currentColor"/>
    </svg>
    <span class="sotto-btn-text">Send to Sotto</span>
  `;

  btn.addEventListener('click', handleSendClick);
  return btn;
}

function updateButtonState(state, message) {
  currentState = state;
  const btn = document.getElementById('sotto-send-btn');
  if (!btn) return;

  btn.setAttribute('data-state', state);
  const textEl = btn.querySelector('.sotto-btn-text');

  switch (state) {
    case 'idle':
      textEl.textContent = 'Send to Sotto';
      btn.disabled = false;
      break;
    case 'capturing':
      textEl.textContent = 'Capturing...';
      btn.disabled = true;
      break;
    case 'uploading':
      textEl.textContent = 'Uploading...';
      btn.disabled = true;
      break;
    case 'success':
      textEl.textContent = 'Sent!';
      btn.disabled = true;
      setTimeout(() => updateButtonState('idle'), 3000);
      break;
    case 'error':
      textEl.textContent = message || 'Failed';
      btn.disabled = false;
      setTimeout(() => updateButtonState('idle'), 5000);
      break;
  }
}

// ─── Send click handler ──────────────────────────────────────────────────────
async function handleSendClick() {
  if (currentState !== 'idle') return;

  // Check auth first
  const authResult = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
  if (!authResult.ok) {
    updateButtonState('error', 'Not connected');
    return;
  }

  updateButtonState('capturing');

  // Request audio capture from MAIN world
  window.postMessage({ type: 'SOTTO_CAPTURE_AUDIO' }, '*');

  // Timeout after 30 seconds
  setTimeout(() => {
    if (currentState === 'capturing') {
      updateButtonState('error', 'Capture timeout');
    }
  }, 30000);
}

// ─── Listen for messages from MAIN world ─────────────────────────────────────
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  if (event.data.type === 'SOTTO_AUDIO_READY') {
    updateButtonState('uploading');

    const { base64Data, filename } = event.data;
    const notebookTitle = getNotebookTitle();

    const result = await chrome.runtime.sendMessage({
      type: 'UPLOAD_AUDIO',
      base64Data,
      filename,
      notebookTitle,
    });

    if (result.ok) {
      updateButtonState('success');
    } else {
      updateButtonState('error', result.error);
    }
  }

  if (event.data.type === 'SOTTO_CAPTURE_ERROR') {
    updateButtonState('error', event.data.error || 'Capture failed');
  }
});

// ─── Title extraction ────────────────────────────────────────────────────────
function getNotebookTitle() {
  for (const selector of SELECTORS.notebookTitle.split(', ')) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return '';
}

// ─── Button injection logic ──────────────────────────────────────────────────
function tryInjectButton() {
  if (buttonInjected && document.getElementById('sotto-send-btn')) return;

  // Strategy 1: Find action bar and append button
  const actionBar = document.querySelector(SELECTORS.actionBar);
  if (actionBar) {
    const btn = createSottoButton();
    actionBar.appendChild(btn);
    buttonInjected = true;
    return;
  }

  // Strategy 2: Find audio player container and append button after it
  const audioContainer = document.querySelector(SELECTORS.audioPlayerContainer);
  if (audioContainer) {
    // Look for any toolbar/button area within the container
    const toolbars = audioContainer.querySelectorAll(
      '[role="toolbar"], [class*="action"], [class*="button-group"]'
    );
    if (toolbars.length > 0) {
      const btn = createSottoButton();
      toolbars[toolbars.length - 1].appendChild(btn);
      buttonInjected = true;
      return;
    }

    // Fallback: append directly to the container
    const btn = createSottoButton();
    audioContainer.appendChild(btn);
    buttonInjected = true;
    return;
  }

  // Strategy 3: Find audio element and inject button near its closest container
  const audioEl = document.querySelector(SELECTORS.audioElement);
  if (audioEl) {
    const container =
      audioEl.closest('[class*="player"], [class*="audio"], [role="region"]') ||
      audioEl.parentElement;
    if (container && !container.querySelector('#sotto-send-btn')) {
      const btn = createSottoButton();
      container.appendChild(btn);
      buttonInjected = true;
    }
  }
}

// ─── MutationObserver ────────────────────────────────────────────────────────
function startObserving() {
  // Initial attempt
  tryInjectButton();

  const observer = new MutationObserver((mutations) => {
    // Check if our button was removed (SPA navigation)
    if (buttonInjected && !document.getElementById('sotto-send-btn')) {
      buttonInjected = false;
      currentState = 'idle';
    }

    // Only check for injection-worthy mutations
    let shouldCheck = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldCheck = true;
        break;
      }
    }

    if (shouldCheck) {
      tryInjectButton();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// ─── Initialize ──────────────────────────────────────────────────────────────
injectMainWorldScript();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving);
} else {
  startObserving();
}
