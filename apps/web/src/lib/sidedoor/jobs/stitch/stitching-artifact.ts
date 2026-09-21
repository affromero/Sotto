import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { createStitchKey } from '@/lib/audio/stitch-identity';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { readStitchingParent } from '@/lib/sidedoor/jobs/stitch/stitching-parent';
import { createInitialStitchKey } from '@/lib/audio/stitch-identity';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';

const id = z.string().min(1).max(200);
const payloadSchema = z
  .object({
    episodeId: id,
    userId: id,
    episodeVersion: z.number().int().positive(),
    stitchKey: z.string().min(1).max(200),
    parentOperationId: z.uuid(),
    parentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    storage: incorporationPayloadSchema.shape.storage,
    contributorId: id,
  })
  .strict();

/** Validate immutable stitching ancestry before requiring any live artifact inputs. */
export async function readStitchingArtifact(
  database: Prisma.TransactionClient,
  queued: { id?: string; name: string; data: unknown },
  handler: 'pdf-generation' | 'waveform-generation'
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler,
    version: 1,
    payload: payloadSchema,
  });
  if (work.complete) return work;
  const { payload } = work;
  if (
    !isDeepStrictEqual(work.scopes, payload.storage.scopes) ||
    payload.userId !== payload.storage.userId
  )
    throw new Error('Artifact ownership does not match admission');
  const ancestry = await readStitchingParent(
    database,
    work,
    {
      id: payload.parentOperationId,
      fingerprint: payload.parentFingerprint,
    },
    handler === 'pdf-generation' ? 'pdf' : 'waveform'
  );
  if (!ancestry) return { complete: true as const };
  const { parent, initial } = ancestry;
  const parentPayload = initial
    ? {
        ...ancestry.source,
        interactionId: null,
        previousAudio: initial.inputs.previousAudio,
        segmentInputs: initial.inputs.segments,
        skipSfx: initial.soundPolicy === 'none',
      }
    : z
        .object({
          episodeId: id,
          interactionId: id,
          contributorId: id,
          storage: incorporationPayloadSchema.shape.storage,
          previousAudio: z.object({
            audioUrl: z.string().nullable(),
            currentVersion: z.number().int(),
          }),
          segmentInputs: z.array(
            z.object({ id, version: z.number().int().positive(), audioUrl: z.string() })
          ),
          skipSfx: z.literal(true),
        })
        .parse(parent.job.payload);
  const version =
    parentPayload.previousAudio.currentVersion + (parentPayload.previousAudio.audioUrl ? 1 : 0);
  if (
    (initial
      ? createInitialStitchKey(parent.fingerprint)
      : createStitchKey(payload.episodeId, parentPayload.segmentInputs, parentPayload.skipSfx)) !==
    payload.stitchKey
  )
    throw new Error('Artifact stitch identity does not match its parent');
  if (
    parentPayload.episodeId !== payload.episodeId ||
    parentPayload.contributorId !== payload.contributorId ||
    !isDeepStrictEqual(parentPayload.storage, payload.storage) ||
    version !== payload.episodeVersion
  )
    throw new Error('Artifact does not match its stitching parent');
  if (await completeErasedJob(database, work)) return { complete: true as const };
  await validateEpisodeStorage(database, payload.episodeId, payload.storage, [
    payload.contributorId,
  ]);
  if (initial) {
    const produced = await database.episodeVersion.findUnique({
      where: { id: initial.outputs.versionId },
      select: { episodeId: true, version: true, interactionId: true },
    });
    if (
      produced?.episodeId !== payload.episodeId ||
      produced.version !== payload.episodeVersion ||
      produced.interactionId !== null
    )
      throw new Error('Artifact version does not match its admitted output');
  }
  return { ...work, parentInteractionId: parentPayload.interactionId };
}
