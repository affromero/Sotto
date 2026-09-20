import { copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { SfxInsert, SfxType } from '../audio-stitcher';
import type { SfxParams } from '../providers/tts';
import { generatedScriptSchema } from '../validations';
import { extractAudienceReactions } from '../tts-text-cleaner';

type Script = { soundCues: unknown; turns: unknown } | null;
export type StitchSoundExecution =
  | { policy: 'none' }
  | { policy: 'stock'; script: Script }
  | { policy: 'elevenlabs'; script: Script; generate: (params: SfxParams) => Promise<Buffer> };

const stockFiles: Record<SfxType, string> = {
  intro: 'intro-warm.mp3',
  transition: 'transition-whoosh.mp3',
  outro: 'outro-gentle.mp3',
  ambient: 'ambient-soft.mp3',
  laugh_track: 'laugh-track.mp3',
  music_sting: 'music-sting.mp3',
  applause: 'applause.mp3',
  comedic_hit: 'comedic-hit.mp3',
  rim_shot: 'rim-shot.mp3',
};
const stockDirectory = resolve(__dirname, '../../assets/sfx');

export function validateStitchSoundScript(script: Script) {
  return {
    cues: generatedScriptSchema.shape.soundCues.removeCatch().parse(script?.soundCues ?? []),
    turns: z.array(generatedScriptSchema.shape.turns.element).parse(script?.turns ?? []),
  };
}

/** Validate before file creation or premium dispatch; failed providers never select stock. */
export async function buildStitchSoundEffects(options: {
  execution: StitchSoundExecution;
  directory: string;
  durations: readonly (number | null)[];
  signal: AbortSignal;
  progress: (value: number) => Promise<void>;
}): Promise<SfxInsert[]> {
  const { execution, directory, signal, progress } = options;
  signal.throwIfAborted();
  if (execution.policy === 'none') return [];
  const { cues, turns } = validateStitchSoundScript(execution.script);
  let cumulative = 0;
  const delays = options.durations.map((duration) => (cumulative += (duration ?? 0) * 1000));
  const inserts: SfxInsert[] = [];
  for (const [index, cue] of cues.entries()) {
    signal.throwIfAborted();
    const path = join(directory, `sfx-${index}.mp3`);
    if (execution.policy === 'elevenlabs') {
      const audio = await execution.generate({
        prompt: cue.prompt,
        durationSeconds: cue.durationSeconds,
        signal,
      });
      signal.throwIfAborted();
      await writeFile(path, audio, { signal });
    } else await copyFile(join(stockDirectory, stockFiles[cue.type]), path);
    signal.throwIfAborted();
    const after = Math.min(cue.insertAfterTurn, delays.length - 1);
    inserts.push({
      path,
      insertAfterSegment: cue.insertAfterTurn,
      durationMs: cue.durationSeconds * 1000,
      delayMs: after >= 0 ? Math.round(delays[after] ?? 0) : 0,
      type: cue.type,
      volume: cue.volume,
      fadeOutMs: cue.fadeOutMs,
    });
    await progress(50 + Math.round((index / cues.length) * 15));
  }
  for (let index = 0; index < turns.length && index < delays.length; index++) {
    for (const [reactionIndex, reaction] of extractAudienceReactions(
      turns[index]!.text
    ).entries()) {
      signal.throwIfAborted();
      const path = join(directory, `reaction-${index}-${reactionIndex}.mp3`);
      await copyFile(join(stockDirectory, stockFiles[reaction.type]), path);
      signal.throwIfAborted();
      inserts.push({
        path,
        insertAfterSegment: index,
        durationMs: 2000,
        delayMs: Math.round(delays[index] ?? 0),
        type: reaction.type,
        volume: 0.3,
      });
    }
  }
  signal.throwIfAborted();
  return inserts;
}
