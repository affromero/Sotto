// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectSegmentBoundaries } from '@/lib/audio/segment-boundaries';
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
  async function runningAnalysis(command: 'ffmpeg' | 'fpcalc') {
    const marker = join(directory, 'started');
    await executable(
      command,
      `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,output:process.argv.at(-1)}));setInterval(()=>{},1000);`
    );
    const controller = new AbortController();
    const reason = new Error('Analysis cancelled');
    const running =
      command === 'ffmpeg'
        ? detectSegmentBoundaries(
            'stitched.mp3',
            ['one.mp3', 'two.mp3'],
            directory,
            controller.signal
          )
        : generateFingerprint('input.mp3', controller.signal);
    const outcome = running.then(
      (value) => ({ value }),
      (error) => ({ error: error as unknown })
    );
    try {
      await expect
        .poll(async () => readFile(marker, 'utf8').catch(() => ''), { timeout: 10_000 })
        .not.toBe('');
      const started = JSON.parse(await readFile(marker, 'utf8')) as { pid: number; output: string };
      controller.abort(reason);
      const result = await outcome;
      expect(() => process.kill(started.pid, 0)).toThrow();
      expect(result).toEqual({ error: reason });
      if (command === 'ffmpeg') {
        expect(dirname(started.output).startsWith(join(directory, 'boundaries-'))).toBe(true);
        await expect(access(dirname(started.output))).resolves.toBeUndefined();
      }
    } finally {
      controller.abort(reason);
      await outcome;
    }
  }
  it.each(['ffmpeg', 'fpcalc'] as const)(
    'waits for %s termination before returning cancellation',
    async (command) => {
      await runningAnalysis(command);
    }
  );
  it('allows cancellation during CPU correlation after decoder processes have exited', async () => {
    const marker = join(directory, 'decoded');
    await executable(
      'ffmpeg',
      `const fs=require('node:fs');const output=process.argv.at(-1);fs.writeFileSync(output,Buffer.alloc(16000*2*120));if(output.includes('segment-1'))fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));`
    );
    const controller = new AbortController();
    const reason = new Error('Stop correlation');
    const running = detectSegmentBoundaries(
      'stitched.mp3',
      ['one.mp3', 'two.mp3'],
      directory,
      controller.signal
    );
    const outcome = running.then(
      (value) => ({ value }),
      (error) => ({ error: error as unknown })
    );
    try {
      await expect
        .poll(
          async () => {
            const value = await readFile(marker, 'utf8').catch(() => '');
            if (!value) return false;
            try {
              process.kill(Number(value), 0);
              return false;
            } catch {
              return true;
            }
          },
          { interval: 1, timeout: 10_000 }
        )
        .toBe(true);
      controller.abort(reason);
      const result = await outcome;
      expect(result).toMatchObject({ error: expect.any(Error) });
      if ('error' in result) {
        const error = result.error;
        expect(error === reason || (error instanceof Error && error.cause === reason)).toBe(true);
      }
    } finally {
      controller.abort(reason);
      await outcome;
    }
  });
  it('retains optional correlation failure behavior after process cleanup', async () => {
    await executable('ffmpeg', 'process.exit(2);');
    expect(await detectSegmentBoundaries('bad.mp3', ['one.mp3', 'two.mp3'], directory)).toEqual([]);
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
  it('locates distinct segment audio through real decoding without treating container metadata as samples', async () => {
    let state = 123456;
    const segment = Buffer.alloc(16000 * 2 * 2);
    for (let offset = 0; offset < segment.length; offset += 2) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      segment.writeInt16LE((state % 16001) - 8000, offset);
    }
    const segmentRaw = join(directory, 'segment.pcm');
    const stitchedRaw = join(directory, 'stitched.pcm');
    const segmentWave = join(directory, 'segment.wav');
    const stitchedWave = join(directory, 'stitched.wav');
    await writeFile(segmentRaw, segment);
    await writeFile(
      stitchedRaw,
      Buffer.concat([Buffer.alloc(16000 * 2 * 3), segment, Buffer.alloc(16000 * 2)])
    );
    for (const [input, output] of [
      [segmentRaw, segmentWave],
      [stitchedRaw, stitchedWave],
    ]) {
      await execute('ffmpeg', [
        '-v',
        'error',
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-i',
        input,
        '-metadata',
        'comment=Container metadata must not become audio samples',
        output,
      ]);
    }
    const starts = await detectSegmentBoundaries(
      stitchedWave,
      [stitchedWave, segmentWave],
      directory
    );
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(0);
    expect(Math.abs(starts[1] - 3)).toBeLessThanOrEqual(0.01);
  });
  it('rejects incomplete decoded PCM instead of interpreting a partial sample', async () => {
    await executable(
      'ffmpeg',
      "require('node:fs').writeFileSync(process.argv.at(-1),Buffer.alloc(3));"
    );
    expect(await detectSegmentBoundaries('bad.mp3', ['one.mp3', 'two.mp3'], directory)).toEqual([]);
  });
});
