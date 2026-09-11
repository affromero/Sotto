const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function launcher(overrides = {}) {
  const elements = {};
  const calls = [];
  const handlers = {
    docker_available: () => true,
    installed: () => true,
    web_port: () => 4321,
    is_healthy: () => true,
    ...overrides,
  };
  const context = vm.createContext({
    window: {
      __TAURI__: {
        window: {
          getCurrentWindow: () => ({
            setTitle: async (title) => {
              elements.title = title;
            },
          }),
        },
        core: {
          invoke: async (command, args) => {
            calls.push([command, args]);
            return handlers[command]?.(args);
          },
        },
      },
    },
    document: {
      getElementById: (id) =>
        (elements[id] ||= {
          hidden: false,
          addEventListener(event, handler) {
            this[event] = handler;
          },
        }),
    },
    setInterval() {},
    setTimeout: (callback) => callback(),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), context);
  await new Promise(setImmediate);
  return { elements, calls, refresh: () => vm.runInContext('refresh()', context) };
}

test('opens the configured installation port', async () => {
  const app = await launcher();
  await app.elements.open.click();
  assert.equal(app.calls.find(([command]) => command === 'open_app')[1].port, 4321);
  assert.equal(app.elements['status-text'].textContent, 'Running');
  assert.equal(app.elements.title, 'Sotto Host: Running');
});

test('start failures remain visible after periodic refresh', async () => {
  const app = await launcher({
    start_stack: () => {
      throw new Error('Docker daemon unavailable');
    },
  });
  await app.elements.start.click();
  await new Promise(setImmediate);
  await app.refresh();
  assert.match(
    app.elements['status-text'].textContent,
    /Could not start:.*Docker daemon unavailable/
  );
  assert.equal(app.elements.start.disabled, false);
});

test('stop failures remain visible and allow retry', async () => {
  const app = await launcher({
    stop_stack: () => {
      throw new Error('permission denied');
    },
  });
  await app.elements.stop.click();
  await new Promise(setImmediate);
  assert.match(app.elements['status-text'].textContent, /Could not stop:.*permission denied/);
  assert.equal(app.elements.stop.disabled, false);
});

test('startup timeout explains unhealthy containers', async () => {
  const app = await launcher({ is_healthy: () => false });
  await app.elements.start.click();
  await new Promise(setImmediate);
  assert.match(app.elements['status-text'].textContent, /still starting or unhealthy/);
});
