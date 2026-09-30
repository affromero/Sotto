// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateFingerprint } from '@/lib/audio-fingerprint';

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));

const execute = promisify(execFile);
describe('media analysis process ownership', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-analysis-test-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  async function executable(command: 'ffmpeg' | 'fpcalc', script: string) {
    await writeFile(join(directory, command), `#!${process.execPath}\n${script}\n`, {
      mode: 0o700,
    });
    vi.stubEnv('PATH', directory);
  }
  it('waits for fingerprint termination before returning cancellation', async () => {
    const marker = join(directory, 'started');
    await executable(
      'fpcalc',
      `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`
    );
    const controller = new AbortController();
    const reason = new Error('Analysis cancelled');
    const running = generateFingerprint('input.mp3', controller.signal);
    const outcome = running.then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    try {
      await expect
        .poll(async () => readFile(marker, 'utf8').catch(() => ''), { timeout: 10000 })
        .not.toBe('');
      const pid = Number(await readFile(marker, 'utf8'));
      controller.abort(reason);
      expect(await outcome).toEqual({ error: reason });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort(reason);
      await outcome;
    }
  });
  it('captures real fingerprints as PostgreSQL-compatible words', async () => {
    const audio = join(directory, 'tone.wav');
    await execute('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=16000',
      '-t',
      '6',
      audio,
    ]);
    const result = await generateFingerprint(audio);
    expect(result.duration).toBe(6);
    expect(result.fingerprint.length).toBeGreaterThan(0);
    expect(
      result.fingerprint.every(
        (word) => Number.isInteger(word) && word >= -2147483648 && word <= 2147483647
      )
    ).toBe(true);
  });
});
