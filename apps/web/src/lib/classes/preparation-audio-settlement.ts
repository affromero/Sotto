import { JobErasedError } from 'thesidedoor-core/runtime/outbox';
import { durableEnvelopeSchema } from '@/lib/sidedoor/jobs/core/durable-queue';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { classPreparationGrant } from './preparation-grant';
import { readPreparationAudioBinding } from './preparation-audio';
import { PreparationConflictError, type ClassPreparation } from './preparation-state';

/** Caller owns the Serializable cancellation transaction. Revocation fences new admissions. */
export async function settlePreparationAudio(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
): Promise<{ settled: boolean; blockingJobs: string[] }> {
  const grant = await classPreparationGrant(database, operation).read(operation.grant);
  if (grant.status !== 'revoked')
    throw new PreparationConflictError('Revoke preparation before settling audio.');
  const outbox = sottoJobOutbox(database);
  const executions = sottoJobExecutions(database);
  const blockingJobs: string[] = [];
  for (const episodeId of operation.audioEpisodeIds) {
    const lineage = await readPreparationAudioBinding(database, episodeId);
    if (
      !lineage ||
      lineage.operationId !== operation.id ||
      lineage.grant.fingerprint !== operation.grant.fingerprint
    )
      throw new PreparationConflictError('The audio cancellation lineage changed.');
    let cursor: string | null = null;
    let scanned = 0;
    do {
      const page = await outbox.listForScope(
        `episode:${episodeId}`,
        lineage.episodeCreatedAt,
        cursor
      );
      for (const reference of page.jobs) {
        if (++scanned > 2000)
          throw new PreparationConflictError(
            'Audio cancellation requires bounded operator recovery.'
          );
        let record;
        try {
          record = await outbox.read(reference.id);
        } catch (error) {
          if (!(error instanceof JobErasedError)) throw error;
          if (['audio-generation', 'audio-stitching'].includes(error.receipt.handler)) {
            await executions.requireParentDrained(reference.id, reference.fingerprint);
          }
          continue;
        }
        if (!record || record.fingerprint !== reference.fingerprint)
          throw new PreparationConflictError('The audio job identity changed.');
        if (!['audio-generation', 'audio-stitching'].includes(record.job.handler)) continue;
        const audio = durableEnvelopeSchema.safeParse(record.job.payload);
        const stitch = initialStitchPayloadSchema.safeParse(record.job.payload);
        const generationKey =
          audio.success && audio.data.authority.kind === 'episode'
            ? audio.data.authority.preparationAudioGenerationKey
            : stitch.success
              ? stitch.data.inputs.generationKey
              : null;
        if (generationKey !== lineage.audioGenerationKey) continue;
        const blocking = await executions.blockingStatus(reference.id, reference.fingerprint);
        if (blocking) {
          blockingJobs.push(reference.id);
          continue;
        }
        await executions.requireParentDrained(reference.id, reference.fingerprint);
        if (!record.complete) await outbox.complete(reference.id, reference.fingerprint);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return { settled: blockingJobs.length === 0, blockingJobs };
}
