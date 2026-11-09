import { isDeepStrictEqual } from 'node:util';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { durableEnvelopeSchema } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  runSottoExecutionOperation,
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { readAssessmentAudioSettlementLineage } from './assessment-audio-lineage';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import {
  claimAssessmentAudioObservation,
  releaseAssessmentAudioObservation,
  runAssessmentAudioObservationTransaction,
} from './assessment-audio-claim';
import {
  captureFailedAssessmentAudioEvidence,
  completeObservedAssessmentAudioPublication,
  hasRecordedAssessmentAudioFailure,
  recordObservedFailedAssessmentAudio,
} from './assessment-audio-failure';

const payloadSchema = z
  .object({ episodeId: z.string().min(1), audioGenerationKey: z.string().min(1) })
  .passthrough();

/** Classify using the durable job and the reserved episode, never queue-supplied data. */
async function inspect(
  database: Prisma.TransactionClient,
  reference: { operationId: string; fingerprint: string }
) {
  const child = await sottoJobOutbox(database).read(reference.operationId);
  if (
    !child ||
    child.complete ||
    child.fingerprint !== reference.fingerprint ||
    child.job.handler !== 'audio-generation' ||
    child.job.version !== 1
  )
    throw new AssessmentFenceConflict();
  const envelope = durableEnvelopeSchema.parse(child.job.payload);
  if (envelope.type !== 'generate_audio' || envelope.authority.kind !== 'episode')
    throw new AssessmentFenceConflict();
  const { episodeId } = z
    .object({ episodeId: z.string().min(1) })
    .passthrough()
    .parse(envelope.payload);
  if (envelope.authority.episodeId !== episodeId) throw new AssessmentFenceConflict();
  const episode = await database.episode.findUnique({
    where: { id: episodeId },
    select: { assessmentAudioAssessmentId: true },
  });
  if (!episode) throw new AssessmentFenceConflict();
  if (!episode.assessmentAudioAssessmentId) return null;
  const payload = payloadSchema.parse(envelope.payload);
  if (envelope.authority.preparationAudioGenerationKey !== payload.audioGenerationKey)
    throw new AssessmentFenceConflict();
  const { current } = await readAssessmentAudioSettlementLineage(
    database,
    payload.episodeId,
    payload.audioGenerationKey
  );
  if (current.assessmentId !== episode.assessmentAudioAssessmentId)
    throw new AssessmentFenceConflict();
  const classScope = current.ownership.scopes.find(
    (item) => item.subjectId === `class:${current.classId}`
  );
  const episodeScope = child.job.scopes.find(
    (item) => item.subjectId === `episode:${payload.episodeId}`
  );
  if (!classScope || !episodeScope) throw new AssessmentFenceConflict();
  const identity = {
    classId: current.classId,
    classGeneration: classScope.generation,
    assessmentId: current.assessmentId,
    ...reference,
  };
  return {
    identity,
    episodeScope,
    recorded: await hasRecordedAssessmentAudioFailure(database, identity),
  };
}

/** Observe one failed child without treating Redis failure as provider settlement. */
export async function reconcileFailedAssessmentAudio(input: {
  database: PrismaClient;
  queue: Queue;
  operationId: string;
  fingerprint: string;
  signal: AbortSignal;
}) {
  if (input.queue.name !== 'audio-generation') throw new AssessmentFenceConflict();
  const reference = { operationId: input.operationId, fingerprint: input.fingerprint };
  const initial = await sottoTransaction(input.database, (tx) => inspect(tx, reference), {
    signal: input.signal,
  });
  if (!initial) return null;
  if (initial.recorded) return 'UNRESOLVED' as const;
  const outcome = await withSottoJobExecution({
    database: input.database,
    parentId: input.operationId,
    fingerprint: input.fingerprint,
    signal: input.signal,
    capabilityScope: initial.episodeScope,
    isCleanupFailure: () => false,
    validate: async (tx) => {
      const current = await inspect(tx, reference);
      if (!current || current.recorded || !isDeepStrictEqual(current, initial)) return false;
      return !(await sottoJobExecutions(tx).blockingStatus(input.operationId, input.fingerprint));
    },
    run: async ({ capability }) => {
      if (!capability) throw new AssessmentFenceConflict();
      const expected = { parentId: input.operationId, fingerprint: input.fingerprint };
      return runSottoExecutionOperation(capability, expected, async (operation) => {
        const context = {
          database: input.database,
          identity: initial.identity,
          capability,
          operation,
        };
        const claim = await runAssessmentAudioObservationTransaction(context, (tx) =>
          claimAssessmentAudioObservation(tx, initial.identity, operation)
        );
        let released = false;
        try {
          const claimed = { ...initial.identity, nonce: claim.nonce };
          const evidence = await captureFailedAssessmentAudioEvidence({
            ...context,
            queue: input.queue,
            identity: claimed,
          });
          const recorded = await runAssessmentAudioObservationTransaction(context, (tx) =>
            recordObservedFailedAssessmentAudio(tx, evidence, operation)
          );
          if (recorded.status === 'PUBLISHED') {
            await runAssessmentAudioObservationTransaction(context, (tx) =>
              completeObservedAssessmentAudioPublication(tx, claimed, evidence, operation)
            );
            released = true;
            return 'PUBLISHED' as const;
          }
          return 'UNRESOLVED' as const;
        } finally {
          if (!released)
            await runAssessmentAudioObservationTransaction(context, (tx) =>
              releaseAssessmentAudioObservation(
                tx,
                { ...initial.identity, nonce: claim.nonce },
                operation
              )
            );
        }
      });
    },
  });
  if (outcome) return outcome;
  const current = await sottoTransaction(
    input.database,
    async (tx) => ({
      assessment: await inspect(tx, reference),
      blocking: await sottoJobExecutions(tx).blockingStatus(input.operationId, input.fingerprint),
    }),
    { signal: input.signal }
  );
  if (current.assessment?.recorded) return 'UNRESOLVED' as const;
  if (current.assessment && current.blocking) return 'WAITING' as const;
  throw new AssessmentFenceConflict();
}
