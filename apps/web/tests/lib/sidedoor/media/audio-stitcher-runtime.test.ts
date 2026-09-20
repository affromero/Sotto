// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stitchWithEffects, getAudioDuration } from '@/lib/audio-stitcher';

const execute = promisify(execFile);
describe('stitching finite audio with FFmpeg', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-stitch-runtime-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  it('rejects empty stitching input before starting media work', async () => {
    await expect(
      stitchWithEffects({
        segmentPaths: [],
        sfxInserts: [],
        outputPath: join(directory, 'empty.mp3'),
      })
    ).rejects.toThrow('No segments');
  });
  it.each(['ffmpeg', 'ffprobe'] as const)(
    'cancellation waits for the resistant %s process to exit',
    async (command) => {
      const pidFile = join(directory, 'pid');
      await writeFile(
        join(directory, command),
        `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`,
        { mode: 0o700 }
      );
      vi.stubEnv('PATH', directory);
      const controller = new AbortController();
      const reason = new Error('Worker stopped');
      const running =
        command === 'ffprobe'
          ? getAudioDuration('input.mp3', controller.signal)
          : stitchWithEffects({
              segmentPaths: ['input.mp3'],
              sfxInserts: [],
              outputPath: join(directory, 'out.mp3'),
              signal: controller.signal,
            });
      const rejected = expect(running).rejects.toBe(reason);
      try {
        await expect
          .poll(async () => readFile(pidFile, 'utf8').catch(() => ''), { timeout: 3000 })
          .not.toBe('');
        const pid = Number(await readFile(pidFile, 'utf8'));
        controller.abort(reason);
        await rejected;
        expect(() => process.kill(pid, 0)).toThrow();
      } finally {
        controller.abort(reason);
        await running.catch(() => {});
      }
    }
  );
  it.each(['', 'N/A', '-1', 'Infinity', '1second'])(
    'rejects invalid probe duration %j',
    async (value) => {
      await writeFile(
        join(directory, 'ffprobe'),
        `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(value)});\n`,
        { mode: 0o700 }
      );
      vi.stubEnv('PATH', directory);
      await expect(getAudioDuration('input.mp3')).rejects.toThrow('invalid audio duration');
    }
  );
  it('preserves custom local media wrapper configuration', async () => {
    await writeFile(
      join(directory, 'ffprobe'),
      `#!${process.execPath}\nprocess.stdout.write(process.env.SOTTO_TEST_WRAPPER_DURATION);\n`,
      { mode: 0o700 }
    );
    vi.stubEnv('PATH', directory);
    vi.stubEnv('SOTTO_TEST_WRAPPER_DURATION', '12.5');
    expect(await getAudioDuration('input.mp3')).toBe(12.5);
  });
  async function source(name: string, expression: string) {
    const path = join(directory, `${name}.wav`);
    await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', expression, '-t', '1', path]);
    return path;
  }
  async function decode(path: string) {
    const { stdout } = await execute(
      'ffmpeg',
      ['-v', 'error', '-i', path, '-ar', '44100', '-ac', '1', '-f', 'f32le', 'pipe:1'],
      { encoding: 'buffer' }
    );
    const samples = Array.from({ length: stdout.length / 4 }, (...[, index]) =>
      stdout.readFloatLE(index * 4)
    );
    expect(samples.every(Number.isFinite)).toBe(true);
    return samples;
  }
  it.each(['mono', 'stereo'])(
    'preserves silent %s audio through single and multiple inputs',
    async (channels) => {
      const input = await source('silence', `anullsrc=r=16000:cl=${channels}`);
      for (const count of [1, 2]) {
        const outputPath = join(directory, `silent-${count}.mp3`);
        const { duration } = await stitchWithEffects({
          segmentPaths: Array.from({ length: count }, () => input),
          sfxInserts: [],
          outputPath,
        });
        const samples = await decode(outputPath);
        expect(samples.every((sample) => Math.abs(sample) < 1e-8)).toBe(true);
        expect(duration).toBeGreaterThan(count === 1 ? 0.95 : 1.65);
        expect(duration).toBeLessThan(count === 1 ? 1.1 : 1.8);
      }
    }
  );
  it('preserves non-silent output compared with unguarded normalization', async () => {
    const input = await source('tone', 'sine=frequency=440:sample_rate=16000');
    const baseline = join(directory, 'baseline.mp3');
    const outputPath = join(directory, 'guarded.mp3');
    await execute('ffmpeg', [
      '-v',
      'error',
      '-i',
      input,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '1',
      '-filter:a',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      baseline,
    ]);
    await stitchWithEffects({ segmentPaths: [input], sfxInserts: [], outputPath });
    const expected = await decode(baseline);
    const actual = await decode(outputPath);
    expect(actual.length).toBe(expected.length);
    expect(actual.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
    expect(actual.every((sample, index) => Math.abs(sample - expected[index]!) < 1e-5)).toBe(true);
  });
  it('preserves audible speech-like input adjacent to silence', async () => {
    const tone = await source('tone', 'sine=frequency=440:sample_rate=16000');
    const silence = await source('silence', 'anullsrc=r=16000:cl=mono');
    const outputPath = join(directory, 'mixed.mp3');
    await stitchWithEffects({ segmentPaths: [tone, silence], sfxInserts: [], outputPath });
    const samples = await decode(outputPath);
    expect(samples.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
  });
});
