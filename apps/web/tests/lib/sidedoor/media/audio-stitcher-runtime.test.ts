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
      if (command === 'ffmpeg')
        await writeFile(
          join(directory, 'ffprobe'),
          `#!${process.execPath}\nconsole.log(JSON.stringify({streams:[{sample_rate:'16000'}],frames:[{nb_samples:16000}]}));\n`,
          { mode: 0o700 }
        );
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
  it.each([undefined, 0])(
    'anchors effects to decoded segment ends while preserving explicit delay %s',
    async (explicitDelay) => {
      const speech = await source('silence', 'anullsrc=r=44100:cl=mono');
      const effect = await source('effect', 'sine=frequency=990:sample_rate=44100');
      const output = join(directory, 'anchored.mp3');
      await stitchWithEffects({
        segmentPaths: [speech, speech, speech],
        outputPath: output,
        sfxInserts: [
          {
            path: effect,
            type: 'ambient',
            insertAfterSegment: 1,
            durationMs: 200,
            volume: 1,
            delayMs: explicitDelay,
          },
        ],
      });
      const samples = await decode(output);
      const energy = (start: number) =>
        samples
          .slice(Math.round(start * 44100), Math.round((start + 0.1) * 44100))
          .reduce((sum, value) => sum + value * value, 0);
      expect(energy(explicitDelay === 0 ? 0.05 : 1.75)).toBeGreaterThan(0.01);
      expect(energy(explicitDelay === 0 ? 1.75 : 0.05)).toBeLessThan(0.000001);
    }
  );
  it.each([false, true])(
    'returns decoded segment offsets with MP3 padding and effects=%s',
    async (effects) => {
      const paths: string[] = [];
      const lengths: number[] = [];
      for (const [index, frequency] of [330, 550, 990].entries()) {
        const path = join(directory, `padded-${index}.mp3`);
        await execute('ffmpeg', [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${frequency}:sample_rate=16000`,
          '-t',
          String(1.013 + index * 0.107),
          '-c:a',
          'libmp3lame',
          path,
        ]);
        paths.push(path);
        lengths.push((await decode(path)).length / 44100);
      }
      const output = join(directory, 'timeline.mp3');
      const result = await stitchWithEffects({
        segmentPaths: paths,
        outputPath: output,
        sfxInserts: effects
          ? [
              {
                path: paths[0],
                type: 'ambient',
                insertAfterSegment: 0,
                durationMs: 200,
                volume: 0.01,
              },
            ]
          : [],
      });
      expect(result.segmentStarts[0]).toBe(0);
      expect(result.segmentStarts[1]).toBeCloseTo(lengths[0] - 0.3, 4);
      expect(result.segmentStarts[2]).toBeCloseTo(lengths[0] + lengths[1] - 0.6, 4);
      expect(result.segmentStarts.every((start) => start >= 0 && start < result.duration)).toBe(
        true
      );
      const samples = await decode(output);
      const last = Math.round((result.segmentStarts[2] + 0.35) * 44100);
      const window = samples.slice(last, last + 4410);
      const crossings = window.filter(
        (sample, index) => index > 0 && sample > 0 && window[index - 1] <= 0
      ).length;
      expect(crossings).toBeGreaterThan(95);
      expect(crossings).toBeLessThan(103);
    }
  );
  it.each([0, -1, NaN, Infinity])(
    'rejects invalid crossfade %s before media work',
    async (crossfadeMs) => {
      await expect(
        stitchWithEffects({
          segmentPaths: ['unused'],
          sfxInserts: [],
          outputPath: 'unused',
          crossfadeMs,
        })
      ).rejects.toThrow('Crossfade');
    }
  );
  it('rejects a segment shorter than the overlap', async () => {
    const input = await source('short', 'sine=frequency=440');
    await expect(
      stitchWithEffects({
        segmentPaths: [input, input],
        sfxInserts: [],
        outputPath: join(directory, 'bad.mp3'),
        crossfadeMs: 1100,
      })
    ).rejects.toThrow('longer than');
  });
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
