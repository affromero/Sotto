// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStitchSoundEffects } from '@/lib/audio/stitch-sound-effects';

describe('stitch sound policies', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-sound-policy-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const cue = {
    type: 'intro',
    prompt: 'Warm intro',
    durationSeconds: 2,
    insertAfterTurn: 0,
    volume: 0.2,
    fadeOutMs: 500,
  };
  const script = { soundCues: [cue], turns: [{ speaker: 'HOST', text: 'Hello [applause]' }] };
  function options(signal = new AbortController().signal) {
    return { directory, durations: [1.25, 2], signal, progress: async () => undefined };
  }

  it('creates no effects or files when sounds are off', async () => {
    expect(await buildStitchSoundEffects({ ...options(), execution: { policy: 'none' } })).toEqual(
      []
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it('preserves stock cue and audience timing, volume and fades', async () => {
    const inserts = await buildStitchSoundEffects({
      ...options(),
      execution: { policy: 'stock', script },
    });
    expect(inserts).toMatchObject([
      {
        insertAfterSegment: 0,
        durationMs: 2000,
        delayMs: 1250,
        type: 'intro',
        volume: 0.2,
        fadeOutMs: 500,
      },
      { insertAfterSegment: 0, durationMs: 2000, delayMs: 1250, type: 'applause', volume: 0.3 },
    ]);
    expect(await readFile(inserts[0]!.path)).toEqual(
      await readFile(join(process.cwd(), 'src/assets/sfx/intro-warm.mp3'))
    );
    expect(await readFile(inserts[1]!.path)).toEqual(
      await readFile(join(process.cwd(), 'src/assets/sfx/applause.mp3'))
    );
    expect(script.soundCues[0]).toEqual(cue);
  });

  it.each(['cues', 'turns'])(
    'rejects malformed %s before premium dispatch or file creation',
    async (field) => {
      const malformed = {
        ...script,
        ...(field === 'cues'
          ? { soundCues: [{ ...cue, durationSeconds: -1 }] }
          : { turns: [{ text: 12 }] }),
      };
      await expect(
        buildStitchSoundEffects({
          ...options(),
          execution: {
            policy: 'elevenlabs',
            script: malformed,
            generate: async () => {
              throw new Error('Malformed script reached the provider');
            },
          },
        })
      ).rejects.not.toThrow('reached the provider');
      expect(await readdir(directory)).toEqual([]);
    }
  );

  it('surfaces premium failures without substituting stock audio', async () => {
    const failure = new Error('Premium provider rejected the request');
    await expect(
      buildStitchSoundEffects({
        ...options(),
        execution: {
          policy: 'elevenlabs',
          script,
          generate: async () => {
            throw failure;
          },
        },
      })
    ).rejects.toBe(failure);
    expect(await readdir(directory)).toEqual([]);
  });

  it('does not write premium output after cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('Cancelled sound generation');
    await expect(
      buildStitchSoundEffects({
        ...options(controller.signal),
        execution: {
          policy: 'elevenlabs',
          script,
          generate: async (params) => {
            expect(params.signal).toBe(controller.signal);
            controller.abort(reason);
            return Buffer.from('generated audio');
          },
        },
      })
    ).rejects.toBe(reason);
    expect(await readdir(directory)).toEqual([]);
  });
});
