// Sotto Host launcher UI. Talks to the Rust commands in src-tauri/src/lib.rs via
// the global Tauri bridge (app.withGlobalTauri = true).
const invoke = window.__TAURI__.core.invoke;

const PORT = 3000;

const els = {
  dot: document.getElementById('dot'),
  statusText: document.getElementById('status-text'),
  actions: document.getElementById('actions'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  open: document.getElementById('open'),
  needsDocker: document.getElementById('needs-docker'),
  needsInstall: document.getElementById('needs-install'),
};

function setStatus(state, text) {
  els.dot.className = `dot dot-${state}`;
  els.statusText.textContent = text;
}

async function refresh() {
  const [hasDocker, isInstalled] = await Promise.all([
    invoke('docker_available'),
    invoke('installed'),
  ]);

  els.needsDocker.hidden = hasDocker;
  els.needsInstall.hidden = !hasDocker || isInstalled;
  els.actions.hidden = !hasDocker || !isInstalled;

  if (!hasDocker) return setStatus('idle', 'Docker not found');
  if (!isInstalled) return setStatus('idle', 'Not installed yet');

  const healthy = await invoke('is_healthy', { port: PORT });
  if (healthy) {
    setStatus('up', 'Running');
    els.start.hidden = true;
    els.stop.hidden = false;
    els.open.hidden = false;
  } else {
    setStatus('idle', 'Stopped');
    els.start.hidden = false;
    els.stop.hidden = true;
    els.open.hidden = true;
  }
}

els.start.addEventListener('click', async () => {
  setStatus('working', 'Starting…');
  els.start.disabled = true;
  try {
    await invoke('start_stack');
    // Poll until the web container answers.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (await invoke('is_healthy', { port: PORT })) break;
    }
  } catch (e) {
    setStatus('idle', `Could not start: ${e}`);
  } finally {
    els.start.disabled = false;
    refresh();
  }
});

els.stop.addEventListener('click', async () => {
  setStatus('working', 'Stopping…');
  try {
    await invoke('stop_stack');
  } finally {
    refresh();
  }
});

els.open.addEventListener('click', () => invoke('open_app', { port: PORT }));

refresh();
setInterval(refresh, 5000);
