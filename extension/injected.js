/**
 * Injected script (MAIN world) — runs with page's origin privileges
 *
 * This script runs in the MAIN world so it can:
 * 1. Fetch audio URLs with Google's cookies attached automatically
 * 2. Access blob: URLs created by the page
 *
 * Communication: postMessage with the ISOLATED world content script
 */

(function () {
  'use strict';

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function inferFilename(url, fallback) {
    try {
      const pathname = new URL(url).pathname;
      const name = pathname.split('/').pop();
      if (name && name.includes('.')) return name;
    } catch {
      // ignore
    }
    return fallback;
  }

  async function captureAudio() {
    // Strategy 1: Find <audio src="..."> element
    const audioEl = document.querySelector('audio[src]');
    if (audioEl?.src) {
      const url = audioEl.src;
      const filename = inferFilename(url, 'audio-overview.wav');
      const buffer = await fetchAudioUrl(url);
      return { buffer, filename };
    }

    // Strategy 2: Find <audio><source src="..."> element
    const sourceEl = document.querySelector('audio source[src]');
    if (sourceEl?.src) {
      const url = sourceEl.src;
      const filename = inferFilename(url, 'audio-overview.wav');
      const buffer = await fetchAudioUrl(url);
      return { buffer, filename };
    }

    // Strategy 3: Find download button with href or data attribute
    const downloadSelectors = [
      'a[download][href]',
      'a[aria-label*="Download"][href]',
      'button[data-url]',
      '[data-testid="download-button"][data-url]',
    ];

    for (const selector of downloadSelectors) {
      const el = document.querySelector(selector);
      if (!el) continue;

      const url = el.href || el.getAttribute('data-url');
      if (url) {
        const filename = inferFilename(url, el.getAttribute('download') || 'audio-overview.wav');
        const buffer = await fetchAudioUrl(url);
        return { buffer, filename };
      }
    }

    throw new Error('No audio found on this page. Make sure an Audio Overview has been generated.');
  }

  async function fetchAudioUrl(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`Failed to fetch audio (${res.status})`);
    }
    return res.arrayBuffer();
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data.type !== 'SOTTO_CAPTURE_AUDIO') return;

    try {
      const { buffer, filename } = await captureAudio();
      const base64Data = arrayBufferToBase64(buffer);

      window.postMessage({
        type: 'SOTTO_AUDIO_READY',
        base64Data,
        filename,
      }, '*');
    } catch (err) {
      window.postMessage({
        type: 'SOTTO_CAPTURE_ERROR',
        error: err.message,
      }, '*');
    }
  });
})();
