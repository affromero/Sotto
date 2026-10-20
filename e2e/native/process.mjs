import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export function execute(binary, args, output, env = process.env, timeoutMs = 120_000) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  let child;
  let stopped = false;
  let termination;
  let closed = false;
  let deadline;
  let timedOut = false;
  function stop() {
    stopped = true;
    if (child?.pid && !closed) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      termination ??= setTimeout(() => {
        if (closed) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }, 10_000).unref();
    }
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const completion = (async () => {
    const file = await open(output, 'w');
    let writing = Promise.resolve();
    try {
      if (stopped) throw new Error('Native validation was interrupted.');
      child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      deadline = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs).unref();
      let text = '';
      for (const source of [child.stdout, child.stderr])
        source.on('data', (chunk) => {
          text += chunk;
          writing = writing.then(() => file.write(chunk));
        });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => {
          closed = true;
          resolve(code);
        });
      });
      if (code !== 0 || timedOut)
        throw new Error(
          `${binary} ${timedOut ? 'timed out' : `failed (${code})`}. Full output: ${output}\n${text}`
        );
      return text;
    } finally {
      clearTimeout(termination);
      clearTimeout(deadline);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      await writing;
      await file.close();
    }
  })();
  // Register rejection immediately while other clients are starting.
  completion.catch(() => {});
  return {
    completion,
    stop,
  };
}

export async function prepareIOS(root, directory, device) {
  assert.match(device || '', /^[A-F0-9-]{36}$/i, 'Select the dedicated iOS simulator explicitly.');
  const build = process.env.SOTTO_NATIVE_IOS_BUILD || join(directory, 'ios-build');
  await execute(
    'xcodebuild',
    [
      'build-for-testing',
      '-project',
      resolve(root, 'apps/ios/Sotto.xcodeproj'),
      '-scheme',
      'Sotto',
      '-destination',
      `platform=iOS Simulator,id=${device}`,
      '-derivedDataPath',
      build,
      'CODE_SIGNING_ALLOWED=YES',
      'CODE_SIGN_IDENTITY=-',
    ],
    join(directory, 'ios-build.log'),
    process.env,
    15 * 60_000
  ).completion;
  const products = join(build, 'Build/Products');
  const candidates = await Promise.all(
    (await readdir(products))
      .filter((name) => name.endsWith('.xctestrun'))
      .map(async (name) => ({
        path: join(products, name),
        time: (await stat(join(products, name))).mtimeMs,
      }))
  );
  assert.ok(candidates.length);
  return { original: candidates.sort((a, b) => b.time - a.time)[0].path, products };
}

export async function startIOS(prepared, control, device, directory, name) {
  const destination = join(prepared.products, `${name}.xctestrun`);
  const script = `import plistlib,sys
source,destination,control=sys.argv[1:]
with open(source,'rb') as f: value=plistlib.load(f)
targets=[target for config in value.get('TestConfigurations',[]) for target in config.get('TestTargets',[])]
if not targets: targets=[target for key,target in value.items() if key!='__xctestrun_metadata__']
selected=[target for target in targets if target.get('BlueprintName')=='SottoUITests']
if not selected and 'SottoUITests' in value: selected=[value['SottoUITests']]
if len(selected)!=1: raise SystemExit('Expected one SottoUITests target')
target=selected[0]
target['SkipTestIdentifiers']=[name for name in target.get('SkipTestIdentifiers',[]) if not name.startswith('PlayMixedServerUITests')]
target['OnlyTestIdentifiers']=['PlayMixedServerUITests']
target.setdefault('EnvironmentVariables',{})['SOTTO_PLAY_TEST_CONTROL']=control
with open(destination,'wb') as f: plistlib.dump(value,f)
`;
  await execute(
    'python3',
    ['-c', script, prepared.original, destination, control],
    join(directory, `${name}-configuration.log`)
  ).completion;
  const result = execute(
    'xcodebuild',
    [
      'test-without-building',
      '-xctestrun',
      destination,
      '-destination',
      `platform=iOS Simulator,id=${device}`,
      '-parallel-testing-enabled',
      'NO',
      '-only-testing:SottoUITests/PlayMixedServerUITests',
      '-resultBundlePath',
      join(directory, `${name}.xcresult`),
    ],
    join(directory, `${name}.log`),
    process.env,
    10 * 60_000
  );
  return {
    ...result,
    completion: result.completion.then((text) => {
      assert.match(
        text,
        /Test Case '-\[SottoUITests\.PlayMixedServerUITests testNativeInvitationAndSixRoundsAgainstARealPartnerClient\]' passed/,
        'The actual external iOS test must execute and pass.'
      );
      return text;
    }),
  };
}

export function startAndroid(adb, serial, control, directory, name) {
  const args = [
    'am',
    'instrument',
    '-w',
    '-r',
    '-e',
    'class',
    'fm.sotto.app.process.PlayMixedServerTest',
    '-e',
    'control',
    control,
    'fm.sotto.app.test/androidx.test.runner.AndroidJUnitRunner',
  ];
  const quoted = args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
  const result = execute(
    adb,
    ['-s', serial, 'shell', quoted],
    join(directory, `${name}.log`),
    process.env,
    10 * 60_000
  );
  return {
    ...result,
    completion: result.completion.then((text) => {
      assert.match(text, /OK \(1 test\)/, `Native instrumentation did not pass:\n${text}`);
      return text;
    }),
  };
}
