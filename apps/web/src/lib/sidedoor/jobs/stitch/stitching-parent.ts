import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeErasedJob, readJobParent } from '@/lib/sidedoor/access/deletion/job-erasure';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import {
  initialStitchPayloadSchema,
  type InitialStitchOutputs,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { readInitialStitchOutcome } from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';

const sourceSchema = z.object({
  episodeId: z.string().min(1).max(200),
  contributorId: z.string().min(1).max(200),
  storage: incorporationPayloadSchema.shape.storage,
});

/** Receipt metadata selects a version; the canonical parent reader still proves admission. */
export async function readStitchingParent(
  database: Prisma.TransactionClient,
  work: Parameters<typeof readJobParent>[1],
  identity: { id: string; fingerprint: string },
  effect: Exclude<keyof InitialStitchOutputs, 'versionId'>
) {
  const receipt = await sottoJobOutbox(database).receipt(identity.id);
  if (!receipt || receipt.handler !== 'audio-stitching' || ![1, 2].includes(receipt.version))
    throw new Error('Unsupported stitching parent');
  const parent = await readJobParent(database, work, {
    ...identity,
    handler: 'audio-stitching',
    version: receipt.version,
  });
  if (!parent) return null;
  if (parent.job.version === 1)
    return { parent, source: sourceSchema.parse(parent.job.payload), initial: null };
  const initial = initialStitchPayloadSchema.parse(parent.job.payload);
  if (initial.outputs[effect] !== work.operationId)
    throw new Error('Stitching child identity does not match its admitted output');
  if (await completeErasedJob(database, work)) return null;
  const outcome = await readInitialStitchOutcome(database, parent);
  const result = outcome.effects.find((item) => item.id === work.operationId);
  if (!result || result.fingerprint !== work.fingerprint)
    throw new Error('Stitching child does not match the committed outcome');
  return {
    parent,
    source: {
      episodeId: initial.inputs.episodeId,
      contributorId: initial.inputs.storage.userId,
      storage: initial.inputs.storage,
    },
    initial,
  };
}
