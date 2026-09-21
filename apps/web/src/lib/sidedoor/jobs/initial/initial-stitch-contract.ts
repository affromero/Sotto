import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { EpisodeSource } from '@/generated/prisma/enums';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { storageInputSchema } from '@/lib/sidedoor/storage/core/storage-inputs';

const id = z.string().min(1).max(200);
export const initialStitchSoundPolicySchema = z.enum(['none', 'stock', 'elevenlabs']);
export const initialStitchOutputsSchema = z
  .object({
    versionId: z.uuid(),
    readyNotification: z.uuid(),
    failedNotification: z.uuid(),
    readyStatus: z.uuid(),
    failedStatus: z.uuid(),
    pdf: z.uuid(),
    waveform: z.uuid(),
  })
  .strict()
  .refine(
    (value) => new Set(Object.values(value)).size === Object.keys(value).length,
    'Stitch output identities must be unique'
  );

export const initialStitchPayloadSchema = z
  .object({
    inputs: z
      .object({
        episodeId: id,
        generationKey: id,
        storage: incorporationPayloadSchema.shape.storage,
        title: z.string(),
        source: z.enum(EpisodeSource),
        previousAudio: z
          .object({
            audioUrl: z.string().nullable(),
            currentVersion: z.number().int(),
            lastCompletedStitchKey: z.string().nullable(),
          })
          .strict(),
        durationTarget: z.number().nullable(),
        script: z.object({ soundCues: z.json(), turns: z.json() }).strict().nullable(),
        segments: z
          .array(
            z
              .object({
                id,
                version: z.number().int().positive(),
                order: z.number().int(),
                text: z.string(),
                speaker: z.string(),
                audioUrl: z.string().min(1),
                duration: z.number().nonnegative().nullable(),
                ttsVoiceId: z.string().nullable(),
                wordTimings: z.json(),
              })
              .strict()
          )
          .min(1),
        storageInputs: z.array(storageInputSchema).min(1),
      })
      .strict(),
    soundPolicy: initialStitchSoundPolicySchema,
    outputs: initialStitchOutputsSchema,
  })
  .strict();

export type InitialStitchOutputs = z.infer<typeof initialStitchOutputsSchema>;

export function prepareStitchOutputs(): InitialStitchOutputs {
  return {
    versionId: randomUUID(),
    readyNotification: randomUUID(),
    failedNotification: randomUUID(),
    readyStatus: randomUUID(),
    failedStatus: randomUUID(),
    pdf: randomUUID(),
    waveform: randomUUID(),
  };
}
