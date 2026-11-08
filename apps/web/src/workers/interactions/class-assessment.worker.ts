import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { learningSkills } from '@sotto/shared';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  runSottoExecutionOperation,
  verifySottoExecutionOperation,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  assessmentWorkSchema,
  AssessmentFenceConflict,
} from '@/lib/learning/classes/lifecycle/assessment-fence';
import {
  startAssessmentWork,
  validateAssessmentExecutionState,
} from '@/lib/learning/classes/generation/assessment-work';
import { prepareOrGenerateAssessmentAuthorProof } from '@/lib/learning/classes/generation/assessment-generation';
import { prepareOrGenerateAssessmentReviewProof } from '@/lib/learning/classes/review/assessment-review-generation';
import { queueAssessmentAudio } from '@/lib/learning/classes/audio/assessment-audio-queue';
import { ensureAssessmentSpeakingReferences } from '@/lib/learning/classes/speaking/assessment-speaking-reference';

import { requireAssessmentReviewCapacity } from '@/lib/learning/classes/review/assessment-review-capacity';
import {
  recoverAssessmentOutcome,
  sealAssessmentOutcome,
} from '@/lib/learning/classes/lifecycle/assessment-outcome';
import {
  captureAssessmentSettlementAuthority,
  markFailedAssessmentYield,
  markExpiredAssessmentUnresolved,
  markAssessmentUnresolved,
} from '@/lib/learning/classes/lifecycle/assessment-unresolved';
import {
  assessmentYieldFailureIdentity,
  yieldAssessmentForAudio,
} from '@/lib/learning/classes/generation/assessment-yield';

async function assessmentStage<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Transaction API error'))
      error.message = `Assessment ${name}: ${error.message}`;
    throw error;
  }
}

/** Own one assessment execution, yielding only after its workspace has drained. */
export async function processClassAssessment(
  job: Job<unknown>,
  workerSignal?: AbortSignal,
  token?: string
) {
  const signal = AbortSignal.any([
    ...(workerSignal ? [workerSignal] : []),
    AbortSignal.timeout(40 * 60_000),
  ]);
  const contract = { handler: 'interactions', version: 6, payload: assessmentWorkSchema };
  const work = await sottoTransaction(prisma, (tx) => readSottoWorkerJob(tx, job, contract), {
    signal,
  });
  if (work.complete) return;
  const identity = { id: work.operationId, fingerprint: work.fingerprint };
  if (await sottoTransaction(prisma, (tx) => recoverAssessmentOutcome(tx, identity), { signal }))
    return;
  const { fence } = work.payload;
  const scope = fence.ownership.scopes.find((item) => item.subjectId === `class:${fence.classId}`);
  if (!scope) throw new AssessmentFenceConflict();
  const authorize: SottoProviderExecution['authorize'] = async (database) => {
    const ownership = await capturePrerequisiteOwnership(
      database,
      fence.classId,
      fence.courseId,
      fence.userId
    );
    if (!isDeepStrictEqual(ownership, fence.ownership)) throw new AssessmentFenceConflict();
    return { userId: fence.userId };
  };
  const base: SottoProviderExecution = {
    userId: fence.userId,
    authorize,
    signal,
    learningSelection: fence.selection,
  };
  let authority: Awaited<ReturnType<typeof captureAssessmentSettlementAuthority>> | undefined;
  let unknown = false;
  let outcome: 'WAITING' | 'READY' | undefined;
  try {
    outcome = await withSottoJobExecution({
      database: prisma,
      parentId: identity.id,
      fingerprint: identity.fingerprint,
      signal,
      capabilityScope: scope,
      isCleanupFailure: (error) => unknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        const current = await readSottoWorkerJob(database, job, contract);
        if (current.complete) return false;
        await validateAssessmentExecutionState(database, identity, base);
        return true;
      },
      run: async ({ capability, directory, markCleanupUnconfirmed }) => {
        if (!capability) throw new AssessmentFenceConflict();
        authority = await captureAssessmentSettlementAuthority({ identity, capability });
        return runSottoExecutionOperation(
          capability,
          { parentId: identity.id, fingerprint: identity.fingerprint },
          async (operation, operationSignal) => {
            const execution: SottoProviderExecution = {
              ...base,
              signal: operationSignal,
              isolatedWorkspace: { directory, markCleanupUnconfirmed },
              onCleanupError: markCleanupUnconfirmed,
            };
            const pending = await sottoTransaction(
              prisma,
              async (database) => {
                const current = await validateAssessmentExecutionState(
                  database,
                  identity,
                  execution
                );
                await verifySottoExecutionOperation(database, operation, {
                  parentId: identity.id,
                  fingerprint: identity.fingerprint,
                });
                return current;
              },
              { signal: operationSignal }
            );
            if (pending.current.status === 'QUEUED')
              await sottoTransaction(
                prisma,
                (database) => startAssessmentWork(database, identity, execution),
                {
                  signal: operationSignal,
                }
              );
            const unresolved = () => {
              unknown = true;
              markCleanupUnconfirmed();
            };
            const authors: Array<
              Awaited<ReturnType<typeof prepareOrGenerateAssessmentAuthorProof>>
            > = [];
            for (const skill of learningSkills) {
              if (fence.requirements.skills[skill].state !== 'REQUIRED') continue;
              authors.push(
                await prepareOrGenerateAssessmentAuthorProof({
                  identity,
                  execution,
                  capability,
                  skill,
                  unresolved,
                })
              );
            }
            await sottoTransaction(
              prisma,
              async (database) => {
                await verifySottoExecutionOperation(database, operation, {
                  parentId: identity.id,
                  fingerprint: identity.fingerprint,
                });
                await requireAssessmentReviewCapacity(database, identity, execution);
              },
              { signal: operationSignal }
            );
            const audio =
              fence.requirements.skills.LISTENING.state === 'REQUIRED'
                ? await queueAssessmentAudio({ identity, execution })
                : null;
            if (fence.requirements.referenceAudioRequired) {
              if (!audio) throw new AssessmentFenceConflict();
              await assessmentStage('speaking references', () =>
                ensureAssessmentSpeakingReferences({
                  identity,
                  execution,
                  operation,
                  audio,
                  unresolved,
                })
              );
            }
            const review = await assessmentStage('review', () =>
              prepareOrGenerateAssessmentReviewProof({
                identity,
                execution,
                capability,
                unresolved,
              })
            );
            if (review.status === 'PREPARING_AUDIO') return 'WAITING' as const;
            const sealed = await assessmentStage('seal', () =>
              sealAssessmentOutcome({
                database: prisma,
                identity,
                execution,
                capability,
                authors,
                review: review.proof,
              })
            );
            return sealed.status;
          }
        );
      },
    });
  } catch (error) {
    if (authority) {
      try {
        await markAssessmentUnresolved({ database: prisma, authority });
      } catch (settlementError) {
        throw new AggregateError(
          [error, settlementError],
          'Assessment failure could not be retained'
        );
      }
    } else {
      try {
        await sottoTransaction(
          prisma,
          (database) => markExpiredAssessmentUnresolved(database, identity),
          {
            signal: AbortSignal.timeout(30_000),
          }
        );
      } catch (settlementError) {
        throw new AggregateError(
          [error, settlementError],
          'Assessment admission failure could not be inspected'
        );
      }
    }
    throw error;
  }
  if (outcome === 'WAITING') {
    try {
      return await yieldAssessmentForAudio({
        database: prisma,
        job,
        execution: base,
        token,
        signal,
        authority,
      });
    } catch (error) {
      if (assessmentYieldFailureIdentity(error)) {
        if (!authority) throw new AssessmentFenceConflict();
        try {
          await markFailedAssessmentYield({ database: prisma, authority, error });
        } catch (settlementError) {
          throw new AggregateError(
            [error, settlementError],
            'Assessment delay failure could not be retained'
          );
        }
      }
      throw error;
    }
  }
  if (!(await sottoTransaction(prisma, (tx) => recoverAssessmentOutcome(tx, identity), { signal })))
    throw new AssessmentFenceConflict();
}
