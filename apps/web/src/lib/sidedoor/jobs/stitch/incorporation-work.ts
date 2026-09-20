import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import {
  incorporationInputFingerprint,
  incorporationPosition,
  IncorporationAdmissionError,
  readIncorporationInputs,
  requireIncorporationAttempt,
} from '@/lib/sidedoor/jobs/stitch/incorporation';

const id = z.string().min(1).max(200);
const scope = z
  .object({ subjectId: id, generation: z.number().int().nonnegative().safe() })
  .strict();
export const incorporationPayloadSchema = z
  .object({
    episodeId: id,
    interactionId: id,
    insertAfterOrder: z.number().int().safe(),
    speaker: id,
    newText: z.string().min(1),
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    storage: z
      .object({
        instanceId: z.uuid(),
        userId: id,
        scopes: z.array(scope).min(3).max(100),
        associations: z
          .object({
            classSection: z.object({ id, classId: id }).strict().nullable(),
            examSection: z.object({ id, examId: id }).strict().nullable(),
            practiceSession: id.nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type IncorporationQueueReference = { id?: string; name: string; data: unknown };

/** Run before provider work and again in the storage reference transaction. */
export async function readIncorporationWork(
  database: Prisma.TransactionClient,
  queued: IncorporationQueueReference
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'segment-regeneration',
    version: 1,
    payload: incorporationPayloadSchema,
  });
  if (work.complete) return work;
  const { payload } = work;
  await requireIncorporationAttempt(
    database,
    payload.interactionId,
    work.operationId,
    work.fingerprint
  );
  const inputs = await readIncorporationInputs(database, payload.episodeId, payload.interactionId);
  if (
    inputs.status !== 'INCORPORATING' ||
    inputs.episode.status !== 'UPDATING' ||
    incorporationInputFingerprint(inputs) !== payload.inputFingerprint ||
    !isDeepStrictEqual(incorporationPosition(inputs), {
      insertAfterOrder: payload.insertAfterOrder,
      speaker: payload.speaker,
    }) ||
    !isDeepStrictEqual(work.scopes, payload.storage.scopes)
  )
    throw new IncorporationAdmissionError(
      'Incorporation inputs changed before audio completion',
      409
    );
  await validateEpisodeStorage(database, payload.episodeId, payload.storage, [inputs.userId]);
  return { ...work, inputs };
}
