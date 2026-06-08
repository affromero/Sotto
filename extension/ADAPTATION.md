# Optional Import Adapter — Selector Maintenance

This optional import adapter injects a "Send to Sotto" button into Google's NotebookLM UI. It is one source adapter for imported audio, not the core product surface. Because NotebookLM has no public API, we rely on DOM selectors that **will break** when Google updates their UI.

All fragile selectors are centralized in a single `SELECTORS` object at the top of `content.js`. When the extension stops working, this is the only place you need to update.

## Current SELECTORS object

```js
const SELECTORS = {
  audioPlayerContainer: '[data-testid="audio-overview-player"], ...',
  downloadButton: 'button[aria-label*="Download"], ...',
  audioElement: 'audio[src], audio source[src]',
  notebookTitle: '[data-testid="notebook-title"], .notebook-title, h1',
  actionBar: '[data-testid="audio-overview-actions"], ...',
};
```

## How to discover new selectors

1. Open [notebooklm.google.com](https://notebooklm.google.com) and create/open a notebook with an Audio Overview
2. Open Chrome DevTools (`Cmd+Opt+I` / `F12`)
3. Use the element inspector (`Cmd+Shift+C`) to click on the audio player area

### Finding the audio player container

- Click on the area around the audio playback controls
- Look for a container `<div>` with a distinctive `data-testid`, `class`, or `role` attribute
- The container typically wraps the play button, progress bar, and volume controls

### Finding the action bar

- Click on the area with download/share/settings buttons
- This is usually a `<div>` or `<toolbar>` adjacent to or inside the audio player container
- Look for `role="toolbar"` or classes containing "action", "toolbar", or "button-group"

### Finding the audio element

- In the Elements panel, search (`Cmd+F`) for `<audio`
- Note whether the URL is on the `<audio src="...">` tag or a child `<source src="...">`
- If the URL starts with `blob:`, that's expected — `injected.js` handles blob URLs from the MAIN world

### Finding the download button

- Click the download button in NotebookLM's UI
- Note its tag (`<button>` or `<a>`), `aria-label`, and any `data-testid` attributes
- If it's an `<a>` tag, check for `href` and `download` attributes

### Finding the notebook title

- Click on the notebook name at the top of the page
- Note its tag and any identifying attributes

## Updating selectors

1. Edit the `SELECTORS` object in `content.js`
2. Each selector field accepts a CSS selector string — multiple selectors can be comma-separated
3. Selectors are tried in order (first match wins for title/container; all matches checked for audio)
4. Test by reloading the extension: `chrome://extensions` → click the refresh icon on "Send to Sotto"
5. Navigate to a NotebookLM notebook with an Audio Overview
6. Verify the button appears and the send flow works

## Debugging tips

- **Button doesn't appear**: The `audioPlayerContainer` or `actionBar` selector is stale. Inspect the DOM for the new container class/attribute.
- **"No audio found" error**: The `audioElement` selector and download button selectors in `injected.js` don't match. Search the DOM for `<audio` tags or links with audio file extensions.
- **Audio fetch fails (403/401)**: Google may have changed their audio URL pattern. Check if the audio URL requires different credentials or headers.
- **Button disappears on navigation**: This is expected for SPA navigation. The MutationObserver should re-inject it. If not, the container selector may have changed.

## Architecture reminder

```
content.js (ISOLATED world)          injected.js (MAIN world)
├── Observes DOM                     ├── Fetches audio with page cookies
├── Injects button                   ├── Handles blob: URLs
├── Coordinates flow                 └── Returns base64 via postMessage
└── Sends to background.js
         │
         └── background.js (service worker)
             ├── Stores API key
             └── POSTs to the configured Sotto deployment API
```

The MAIN/ISOLATED world split exists because:

- Audio URLs require Google's cookies (only available in MAIN world)
- `blob:` URLs are origin-scoped (only accessible from the page's MAIN world)
- Chrome extension APIs (`chrome.runtime`, `chrome.storage`) only work in ISOLATED world
