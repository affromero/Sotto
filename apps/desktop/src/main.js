// Sotto Host launcher UI. Talks to the Rust commands in src-tauri/src/lib.rs via
// the global Tauri bridge (app.withGlobalTauri = true).
const invoke = window.__TAURI__.core.invoke;

let port = 3000;
let busy = false;
let error = null;
let refreshing = false;

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
  window.__TAURI__.window
    .getCurrentWindow()
    .setTitle(`Sotto Host: ${text}`)
    .catch((cause) => {
      els.statusText.textContent = `${text} (Could not update window title: ${cause})`;
    });
}

async function refresh() {
  if (busy || refreshing) return;
  refreshing = true;
  try {
    const [hasDocker, isInstalled] = await Promise.all([
      invoke('docker_available'),
      invoke('installed'),
    ]);
    if (busy) return;

    els.needsDocker.hidden = hasDocker;
    els.needsInstall.hidden = !hasDocker || isInstalled;
    els.actions.hidden = !hasDocker || !isInstalled;

    if (!hasDocker) return setStatus('idle', 'Docker or Compose is unavailable');
    if (!isInstalled) return setStatus('idle', 'Not installed yet');

    port = await invoke('web_port');
    const healthy = await invoke('is_healthy', { port });
    if (busy) return;
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
    if (error) setStatus('idle', error);
  } catch (cause) {
    setStatus('idle', `Could not check Sotto: ${cause}`);
  } finally {
    refreshing = false;
  }
}

els.start.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  error = null;
  setStatus('working', 'Starting…');
  els.start.disabled = true;
  try {
    port = await invoke('web_port');
    await invoke('start_stack');
    // Poll until the web container answers.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (await invoke('is_healthy', { port })) return;
    }
    throw new Error(
      'Sotto is still starting or unhealthy. Check the container logs and try again.'
    );
  } catch (e) {
    error = `Could not start: ${e}`;
    setStatus('idle', error);
  } finally {
    busy = false;
    els.start.disabled = false;
    refresh();
  }
});

els.stop.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  error = null;
  els.stop.disabled = true;
  setStatus('working', 'Stopping…');
  try {
    await invoke('stop_stack');
  } catch (e) {
    error = `Could not stop: ${e}`;
    setStatus('idle', error);
  } finally {
    busy = false;
    els.stop.disabled = false;
    refresh();
  }
});

els.open.addEventListener('click', async () => {
  try {
    await invoke('open_app', { port });
  } catch (e) {
    error = `Could not open Sotto: ${e}`;
    setStatus('idle', error);
  }
});

refresh();
setInterval(refresh, 5000);
