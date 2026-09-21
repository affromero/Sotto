// @vitest-environment node
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { extractWaveformPeaks, generateSpectrogram } from '@/lib/waveform-extractor';

describe('waveform extraction with real FFmpeg', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-waveform-test-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  async function executable(command: 'ffmpeg' | 'ffprobe', script: string) {
    await writeFile(join(directory, command), `#!${process.execPath}\n${script}\n`, {
      mode: 0o700,
    });
    vi.stubEnv('PATH', directory);
  }

  it.each(['probe', 'decoder', 'spectrogram'] as const)(
    'waits for resistant %s termination when cancelled during output',
    async (stage) => {
      const marker = join(directory, 'started');
      if (stage === 'decoder') await executable('ffprobe', "process.stdout.write('1');");
      await executable(
        stage === 'probe' ? 'ffprobe' : 'ffmpeg',
        `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`
      );
      const controller = new AbortController();
      const reason = new Error('Stop waveform work');
      const running =
        stage === 'spectrogram'
          ? generateSpectrogram('input.wav', 'output.png', 100, 100, controller.signal)
          : extractWaveformPeaks('input.wav', 20, controller.signal);
      const outcome = running.then(
        (value) => ({ value }),
        (error) => ({ error: error as unknown })
      );
      try {
        await expect
          .poll(async () => readFile(marker, 'utf8').catch(() => ''), { timeout: 3000 })
          .not.toBe('');
        const pid = Number(await readFile(marker, 'utf8'));
        controller.abort(reason);
        expect(await outcome).toEqual({ error: reason });
        expect(() => process.kill(pid, 0)).toThrow();
      } finally {
        controller.abort(reason);
        await outcome;
      }
    }
  );

  it('keeps stereo bin energy independent of byte boundaries and flooded stderr', async () => {
    await executable('ffprobe', "process.stdout.write('0.00025');");
    await executable(
      'ffmpeg',
      'process.stderr.write(Buffer.alloc(1024*1024,120));const b=Buffer.alloc(16);for(let i=0;i<4;i++){b.writeInt16LE((i+1)*1000,i*4);b.writeInt16LE(-(i+1)*1000,i*4+2)}let i=0;const timer=setInterval(()=>{process.stdout.write(b.subarray(i,i+1));if(++i===b.length)clearInterval(timer)},2);'
    );
    expect(await extractWaveformPeaks('input.wav', 4)).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('rejects a partial stereo frame instead of returning plausible peaks', async () => {
    await executable('ffprobe', "process.stdout.write('1');");
    await executable('ffmpeg', 'process.stdout.write(Buffer.alloc(7));');
    await expect(extractWaveformPeaks('input.wav')).rejects.toThrow('incomplete audio');
  });

  it('retains only bounded diagnostics when the decoder fails', async () => {
    await executable('ffprobe', "process.stdout.write('1');");
    await executable(
      'ffmpeg',
      'process.stderr.write(Buffer.alloc(1024*1024,120),()=>{process.exitCode=7});'
    );
    const error: unknown = await extractWaveformPeaks('input.wav').catch((failure) => failure);
    expect(error).toBeInstanceOf(ProcessExecutionError);
    if (!(error instanceof ProcessExecutionError)) throw new Error('Expected process failure');
    expect(error.code).toBe('exit_failed');
    expect(error.exitCode).toBe(7);
    expect(error.diagnostics?.stderr).toBe('x'.repeat(65536));
  });

  async function fixture(seconds: number, sample: (frame: number, channel: number) => number) {
    const frames = Math.round(seconds * 16000);
    const audio = Buffer.alloc(44 + frames * 4);
    audio.write('RIFF');
    audio.writeUInt32LE(audio.length - 8, 4);
    audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(2, 22);
    audio.writeUInt32LE(16000, 24);
    audio.writeUInt32LE(64000, 28);
    audio.writeUInt16LE(4, 32);
    audio.writeUInt16LE(16, 34);
    audio.write('data', 36);
    audio.writeUInt32LE(frames * 4, 40);
    for (let frame = 0; frame < frames; frame++)
      for (let channel = 0; channel < 2; channel++)
        audio.writeInt16LE(Math.round(sample(frame, channel)), 44 + frame * 4 + channel * 2);
    const path = join(directory, 'audio.wav');
    await writeFile(path, audio);
    return path;
  }

  it('represents silence as zero energy', async () => {
    const path = await fixture(1, () => 0);
    expect(await extractWaveformPeaks(path, 20)).toEqual(Array(20).fill(0));
  });

  it('preserves temporal amplitude changes without cancelling opposite stereo phases', async () => {
    const path = await fixture(2, (frame, channel) => {
      const amplitude = frame < 16000 ? 2000 : 8000;
      return amplitude * Math.sin((2 * Math.PI * 400 * frame) / 16000) * (channel ? -1 : 1);
    });
    const peaks = await extractWaveformPeaks(path, 20);
    expect(peaks).toHaveLength(20);
    for (const value of peaks.slice(0, 10)) expect(value).toBeCloseTo(0.25, 2);
    for (const value of peaks.slice(10)) expect(value).toBeCloseTo(1, 2);
  });

  it('returns the requested number of finite bars for audio shorter than the bar count', async () => {
    const path = await fixture(0.001, () => 5000);
    const peaks = await extractWaveformPeaks(path, 200);
    expect(peaks).toHaveLength(200);
    expect(peaks.every((peak) => Number.isFinite(peak) && peak >= 0 && peak <= 1)).toBe(true);
    expect(Math.max(...peaks)).toBe(1);
  });

  it('rejects corrupt audio instead of fabricating a waveform', async () => {
    const path = join(directory, 'corrupt.wav');
    await writeFile(path, 'invalid audio');
    await expect(extractWaveformPeaks(path)).rejects.toThrow();
  });

  it('honors cancellation before starting a decoder', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Cancelled waveform request'));
    await expect(
      extractWaveformPeaks(join(directory, 'absent.wav'), 20, controller.signal)
    ).rejects.toThrow('Cancelled waveform request');
  });

  it.each([0, -1, 0.5, 10001, Infinity, NaN])('rejects invalid bar count %s', async (count) => {
    await expect(extractWaveformPeaks(join(directory, 'absent.wav'), count)).rejects.toThrow(
      'Waveform bar count'
    );
  });
});
