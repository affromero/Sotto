import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execute } from './process.mjs';

test('native command logs retain the final pipe output before completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sotto-native-process-'));
  try {
    const log = join(root, 'output.log');
    const text = 'a'.repeat(200_000) + 'the final native test result\n';
    await execute(
      process.execPath,
      ['-e', "process.stdout.write('a'.repeat(200000)+'the final native test result\\n')"],
      log
    ).completion;
    assert.equal(await readFile(log, 'utf8'), text);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('native cleanup kills a task-owned process that ignores graceful termination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sotto-native-stop-'));
  let child;
  try {
    const log = join(root, 'output.log');
    child = execute(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM',()=>{}); process.stdout.write('ready'); setInterval(()=>{},1000)",
      ],
      log
    );
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      try {
        if ((await readFile(log, 'utf8')).includes('ready')) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(await readFile(log, 'utf8'), /ready/);
    child.stop();
    await assert.rejects(child.completion, /failed/);
  } finally {
    child?.stop();
    await child?.completion.catch(() => {});
    await rm(root, { recursive: true });
  }
});

test('a stalled native command fails at its deadline and retains its output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sotto-native-deadline-'));
  const log = join(root, 'output.log');
  const child = execute(
    process.execPath,
    ['-e', "process.stdout.write('stalled native runner'); setInterval(()=>{},1000)"],
    log,
    process.env,
    500
  );
  try {
    await assert.rejects(child.completion, /timed out/);
    assert.match(await readFile(log, 'utf8'), /stalled native runner/);
  } finally {
    child.stop();
    await child.completion.catch(() => {});
    await rm(root, { recursive: true });
  }
});
