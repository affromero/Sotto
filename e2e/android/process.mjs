import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startAndroidFixture } from './fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const serial = process.argv[2];
assert.match(serial || '', /^emulator-[0-9]+$/, 'Pass the dedicated emulator serial explicitly');
const adb = process.env.ANDROID_HOME ? `${process.env.ANDROID_HOME}/platform-tools/adb` : 'adb';
const output = resolve(
  process.env.SOTTO_NATIVE_TEST_OUTPUT || '/tmp/sotto-android-process',
  serial
);
await mkdir(output, { recursive: true });

async function command(args, name) {
  const child = spawn(adb, ['-s', serial, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (chunk) => {
    text += chunk;
  });
  child.stderr.on('data', (chunk) => {
    text += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (name) await writeFile(`${output}/${name}.log`, text);
  if (code !== 0) throw new Error(`adb ${args.slice(0, 3).join(' ')} failed (${code})\n${text}`);
  return text;
}

assert.equal(
  (await command(['shell', 'getprop', 'ro.kernel.qemu'])).trim(),
  '1',
  'Only a dedicated emulator may run this fixture'
);
await command(
  ['install', '-r', `${root}/apps/android/app/build/outputs/apk/debug/app-debug.apk`],
  'install-app'
);
await command(
  [
    'install',
    '-r',
    `${root}/apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`,
  ],
  'install-tests'
);
const sdk = Number((await command(['shell', 'getprop', 'ro.build.version.sdk'])).trim());
const fixture = await startAndroidFixture(root);
const invitation = `sotto://play/join?v=1&server=${encodeURIComponent(fixture.origin)}&code=ABCDEFGH2345`;

async function stage(method, name) {
  // adb shell performs a second parse. Quote each argument as shell code.
  const values = [
    'am',
    'instrument',
    '-w',
    '-r',
    '-e',
    'class',
    `fm.sotto.app.process.PlayProcessDeathTest#${method}`,
    '-e',
    'invitation',
    invitation,
    'fm.sotto.app.test/androidx.test.runner.AndroidJUnitRunner',
  ];
  const quoted = values.map((value) => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
  const result = await command(['shell', quoted], name);
  assert.match(result, /OK \(1 test\)/, `${name} instrumentation failed:\n${result}`);
  const pid = result.match(/INSTRUMENTATION_STATUS: processPid=(\d+)/)?.[1];
  assert.ok(pid, 'The actual process ID must be reported');
  return pid;
}

try {
  const beforeStagePID = await stage(
    'saveDeliveredCredentialAndUncertainActionBeforeTheProcessIsKilled',
    'before-kill'
  );
  const beforePosts = fixture.received.filter((entry) => entry.method === 'POST').length;
  await command(
    ['shell', 'am', 'start', '-W', '-n', 'fm.sotto.app/.MainActivity'],
    'normal-reopen'
  );
  const beforeKillPID = (await command(['shell', 'pidof', 'fm.sotto.app'])).trim();
  assert.ok(beforeKillPID, 'The app must be running before force-stop');
  assert.equal(
    fixture.received.filter((entry) => entry.method === 'POST').length,
    beforePosts,
    'Normal reopening must not submit saved mutations'
  );
  if (sdk >= 37)
    await command(
      ['shell', 'pm', 'revoke', 'fm.sotto.app', 'android.permission.ACCESS_LOCAL_NETWORK'],
      'revoke-local-network'
    );
  await command(['shell', 'am', 'force-stop', 'fm.sotto.app'], 'force-stop');
  fixture.advance();
  const afterPID = await stage(
    'recoverTheOriginalActionAndCredentialAfterARealProcessRestart',
    'after-kill'
  );
  assert.notEqual(afterPID, beforeKillPID);
  assert.notEqual(afterPID, beforeStagePID);
  assert.deepEqual(fixture.failures, []);
  const creates = fixture.received.filter(
    (entry) => entry.path === '/api/v1/play/rooms' && entry.method === 'POST'
  );
  assert.equal(creates.length, 2);
  assert.equal(
    creates[0].body,
    creates[1].body,
    'Process recovery must replay identical action bytes'
  );
  const acks = fixture.received.filter((entry) => entry.path.endsWith('/ack'));
  assert.equal(acks.length, 2);
  assert.equal(acks[0].body, acks[1].body);
  assert.equal(acks[0].headers['x-sotto-play-proof'], acks[1].headers['x-sotto-play-proof']);
  assert.equal(fixture.received.filter((entry) => entry.path.endsWith('/claim')).length, 1);
  const result = {
    serial,
    sdk,
    beforeStagePID,
    beforeKillPID,
    afterPID,
    exactActionReplay: true,
    originalDeliveryRecovery: true,
    localPermissionRevoked: sdk >= 37,
  };
  await writeFile(`${output}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `Android process recovery passed on ${serial} (API ${sdk}). Results: ${output}\n`
  );
} finally {
  await fixture.close();
}
