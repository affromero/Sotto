import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const driver = new URL('../android/process.mjs', import.meta.url).pathname;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sotto-android-artifacts-'));
  const parent = join(root, 'artifacts');
  const sdk = join(root, 'sdk');
  await mkdir(parent);
  await mkdir(join(sdk, 'platform-tools'), { recursive: true });
  const victim = join(root, 'retained.txt');
  await writeFile(victim, 'Retained private data', { mode: 0o600 });
  await writeFile(
    join(sdk, 'platform-tools/adb'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('getprop')) { console.log('1'); process.exit(0); }
const parent = process.env.SOTTO_TEST_ARTIFACT_PARENT;
const directory = fs.readdirSync(parent).find(name => name.startsWith('sotto-android-process-'));
const log = path.join(parent, directory, 'install-app.log');
if (process.env.SOTTO_TEST_COLLISION === 'file') fs.writeFileSync(log, 'Retained log');
if (process.env.SOTTO_TEST_COLLISION === 'symlink') fs.symlinkSync(process.env.SOTTO_TEST_VICTIM, log);
console.error('Fixture install denied');
process.exit(17);
`,
    { mode: 0o700 }
  );
  const run = (collision = '', configured = true) =>
    spawnSync(process.execPath, [driver, 'emulator-5580'], {
      env: {
        ...process.env,
        ANDROID_HOME: sdk,
        TMPDIR: parent,
        SOTTO_NATIVE_TEST_OUTPUT: configured ? parent : '',
        SOTTO_TEST_ARTIFACT_PARENT: parent,
        SOTTO_TEST_COLLISION: collision,
        SOTTO_TEST_VICTIM: victim,
      },
      encoding: 'utf8',
      timeout: 10000,
    });
  return { root, parent, victim, run };
}

test('failed native runs retain unique private diagnostics under configured and default parents', async () => {
  const value = await fixture();
  try {
    for (const configured of [true, false]) {
      const result = value.run('', configured);
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Fixture install denied/);
    }
    const directories = await readdir(value.parent);
    assert.equal(directories.length, 2);
    for (const directory of directories) {
      const path = join(value.parent, directory);
      assert.equal((await stat(path)).mode & 0o777, 0o700);
      const log = join(path, 'install-app.log');
      const handle = await open(log, 'r');
      try {
        assert.equal((await handle.stat()).mode & 0o777, 0o600);
        assert.match(await handle.readFile('utf8'), /Fixture install denied/);
      } finally {
        await handle.close();
      }
    }
  } finally {
    await rm(value.root, { recursive: true });
  }
});

for (const collision of ['file', 'symlink'])
  test(`native diagnostics refuse an existing ${collision} without overwriting data`, async () => {
    const value = await fixture();
    try {
      const result = value.run(collision);
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EEXIST/);
      assert.equal(await readFile(value.victim, 'utf8'), 'Retained private data');
      if (collision === 'file') {
        const [directory] = await readdir(value.parent);
        assert.equal(
          await readFile(join(value.parent, directory, 'install-app.log'), 'utf8'),
          'Retained log'
        );
      }
    } finally {
      await rm(value.root, { recursive: true });
    }
  });
