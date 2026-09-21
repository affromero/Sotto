// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concatenateTtsAudio, measureTtsAudio } from '@/lib/audio/tts-media';

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));

describe('TTS media resource ownership', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "sotto-tts' media-"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('produces playable joined audio under a path containing spaces and quotes and removes temporary files', async () => {
    const { stdout } = await promisify(execFile)(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440',
        '-t',
        '0.3',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { encoding: 'buffer' }
    );
    const joined = await concatenateTtsAudio([stdout, stdout], { directory });
    const duration = await measureTtsAudio(joined, { directory });
    expect(duration).toBeGreaterThan(0.6);
    expect(duration).toBeLessThan(0.9);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['ffmpeg', 'ffprobe'] as const)(
    'confirms %s exit before returning cancellation and removing its files',
    async (command) => {
      const marker = join(directory, 'started');
      await writeFile(
        join(directory, command),
        `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);\n`,
        { mode: 0o700 }
      );
      vi.stubEnv('PATH', directory);
      const controller = new AbortController();
      const reason = new Error('Cancel TTS media');
      const execution = { directory, signal: controller.signal };
      const running = (
        command === 'ffmpeg'
          ? concatenateTtsAudio([Buffer.from('one'), Buffer.from('two')], execution)
          : measureTtsAudio(Buffer.from('audio'), execution)
      ).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      try {
        await expect
          .poll(async () => readFile(marker, 'utf8').catch(() => ''), { timeout: 15000 })
          .not.toBe('');
        const pid = Number(await readFile(marker, 'utf8'));
        controller.abort(reason);
        expect(await running).toEqual({ error: reason });
        expect(() => process.kill(pid, 0)).toThrow();
        expect((await readdir(directory)).filter((name) => name.startsWith('tts-media-'))).toEqual(
          []
        );
      } finally {
        controller.abort(reason);
        await running;
      }
    }
  );
});
