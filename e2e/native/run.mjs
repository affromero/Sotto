import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { nativeControl } from './control.mjs';
import { execute, prepareIOS, startIOS, startAndroid } from './process.mjs';
import { webHost, playWithNativeGuest } from './web.mjs';

export async function runNativeMatrix(root, env) {
  const serial = process.env.SOTTO_NATIVE_ANDROID_SERIAL;
  const device = process.env.SOTTO_NATIVE_IOS_SIMULATOR;
  assert.match(serial || '', /^emulator-[0-9]+$/, 'Set the dedicated Android emulator serial.');
  assert.match(device || '', /^[A-F0-9-]{36}$/i, 'Set the dedicated iOS simulator ID.');
  const directory = resolve(
    process.env.SOTTO_NATIVE_MATRIX_OUTPUT || join(root, 'test-results/native', String(Date.now()))
  );
  await mkdir(directory, { recursive: true });
  const adb = process.env.ANDROID_HOME ? `${process.env.ANDROID_HOME}/platform-tools/adb` : 'adb';
  const children = [];
  const controls = [];
  const reversed = new Set();
  let browser;
  let failure;
  const results = [];
  function command(binary, args, name, environment = process.env, timeoutMs = 120_000) {
    const child = execute(binary, args, join(directory, `${name}.log`), environment, timeoutMs);
    children.push(child);
    return child.completion;
  }
  async function reverse(url) {
    const port = new URL(url).port;
    await command(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], `reverse-${port}`);
    reversed.add(port);
  }
  async function control(values) {
    const result = await nativeControl(values);
    controls.push(result);
    await reverse(result.url);
    return result;
  }
  function track(child) {
    children.push(child);
    child.completion.catch(() => {});
    return child;
  }
  async function checked(work, native) {
    return Promise.race([work, native.completion.then(() => work)]);
  }
  try {
    assert.equal(
      (
        await command(
          adb,
          ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu'],
          'emulator-identity'
        )
      ).trim(),
      '1'
    );
    await command(
      resolve(root, 'apps/android/gradlew'),
      ['-p', resolve(root, 'apps/android'), 'assembleDebug', 'assembleDebugAndroidTest'],
      'android-build',
      process.env,
      15 * 60_000
    );
    await command(
      adb,
      [
        '-s',
        serial,
        'install',
        '-r',
        resolve(root, 'apps/android/app/build/outputs/apk/debug/app-debug.apk'),
      ],
      'android-install'
    );
    await command(
      adb,
      [
        '-s',
        serial,
        'install',
        '-r',
        resolve(
          root,
          'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
        ),
      ],
      'android-test-install'
    );
    const prepared = await prepareIOS(root, directory, device);
    const server = track(
      execute(
        'npm',
        [
          'run',
          'start',
          '--workspace=@sotto/web',
          '--',
          '--hostname',
          '127.0.0.1',
          '--port',
          env.SOTTO_BROWSER_PORT,
        ],
        join(directory, 'server.log'),
        env,
        30 * 60_000
      )
    );
    const ready = Date.now() + 60_000;
    while (true) {
      if (Date.now() >= ready) throw new Error('The isolated application did not start.');
      try {
        if ((await fetch(`${env.NEXT_PUBLIC_APP_URL}/access`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    server.completion.catch(() => {});
    await reverse(env.NEXT_PUBLIC_APP_URL);
    browser = await chromium.launch();
    const host = await control({
      server: env.NEXT_PUBLIC_APP_URL,
      role: 'HOST',
      name: 'Browser learner',
      partnerName: 'Native iOS partner',
      partnerRound: -1,
    });
    const guest = await control({
      server: env.NEXT_PUBLIC_APP_URL,
      role: 'GUEST',
      name: 'Native iOS partner',
      partnerName: 'Browser learner',
    });
    host.link(guest);
    guest.link(host);
    const android = track(startAndroid(adb, serial, host.url, directory, 'android-ios-host'));
    const invitation = await checked(host.wait('invitation'), android);
    guest.configure({ invitation: invitation.invitation, roomId: invitation.roomId });
    const ios = track(await startIOS(prepared, guest.url, device, directory, 'android-ios-guest'));
    await Promise.race([
      Promise.all([host.wait('done'), guest.wait('done')]),
      android.completion.then(() => {
        assert.ok(host.events.some((event) => event.type === 'done'));
      }),
      ios.completion.then(() => {
        assert.ok(guest.events.some((event) => event.type === 'done'));
      }),
    ]);
    await Promise.all([android.completion, ios.completion]);
    const hostNext = host.events.find((event) => event.type === 'done')?.rematchId;
    assert.ok(hostNext);
    assert.equal(guest.events.find((event) => event.type === 'done')?.rematchId, hostNext);
    results.push({ pairing: 'android-ios', nativeCreatedHost: true, rematchId: hostNext });
    for (const platform of ['android', 'ios']) {
      const host = await webHost(browser, env.NEXT_PUBLIC_APP_URL);
      const newcomer = await control({
        server: env.NEXT_PUBLIC_APP_URL,
        role: 'GUEST',
        name: `Native ${platform} partner`,
        partnerName: 'Browser learner',
        invitation: host.invitation,
        roomId: host.roomID,
      });
      const native = track(
        platform === 'ios'
          ? await startIOS(prepared, newcomer.url, device, directory, 'web-ios')
          : startAndroid(adb, serial, newcomer.url, directory, 'web-android')
      );
      const result = await checked(
        playWithNativeGuest(host, newcomer, directory, `web-${platform}`),
        native
      );
      await native.completion;
      results.push({ pairing: `web-${platform}`, ...result });
      await host.context.close();
    }
  } catch (error) {
    failure = error;
    for (const [index, page] of (
      browser?.contexts().flatMap((context) => context.pages()) || []
    ).entries()) {
      try {
        await writeFile(
          join(directory, `failure-web-${index}.txt`),
          await page.locator('body').innerText()
        );
        await page.screenshot({
          path: join(directory, `failure-web-${index}.png`),
          fullPage: true,
        });
      } catch (captureError) {
        process.stderr.write(`Could not capture the failed browser: ${captureError}\n`);
      }
    }
  } finally {
    for (const child of children) child.stop();
    const cleanup = await Promise.allSettled([
      ...controls.map((control) => control.close()),
      ...(browser ? [browser.close()] : []),
      ...[...reversed].map((port) =>
        command(adb, ['-s', serial, 'reverse', '--remove', `tcp:${port}`], `remove-reverse-${port}`)
      ),
    ]);
    await Promise.allSettled(children.map((child) => child.completion));
    const errors = cleanup
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length)
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...errors],
        'Native matrix cleanup failed'
      );
  }
  if (failure) throw failure;
  await writeFile(join(directory, 'result.json'), `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`Real-server native matrix passed. Results: ${directory}\n`);
}
