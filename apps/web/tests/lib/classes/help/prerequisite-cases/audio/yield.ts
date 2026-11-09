import { expect, vi, type Mock } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  captureAssessmentSettlementAuthority,
  markFailedAssessmentYield,
} from '@/lib/learning/classes/lifecycle/assessment-unresolved';
import { stageAssessmentSection } from '@/lib/learning/classes/generation/assessment-draft';
import { prepareOrGenerateAssessmentReviewProof } from '@/lib/learning/classes/review/assessment-review-generation';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

interface AudioYieldContext {
  instance: SharedTestInstance;
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  truncated: unknown;
  speakingDraft: unknown;
  classScope: { subjectId: string; generation: number };
  provider: { generate: Mock };
  completionMode:
    'yield' | 'yield_failure' | 'yield_missing' | 'yield_lost' | 'yield_cancel' | 'yield_stale';
  record: { job: { delivery: { attempts: number } } };
  assessment: string;
}

export async function checkAssessmentAudioYield({
  instance,
  operation,
  execution,
  truncated,
  speakingDraft,
  classScope,
  provider,
  completionMode,
  record,
  assessment,
}: AudioYieldContext) {
  await sottoTransaction(instance.database, async (tx) => {
    await stageAssessmentSection(tx, operation, execution, truncated);
    await stageAssessmentSection(tx, operation, execution, speakingDraft);
    await stageAssessmentSection(tx, operation, execution, {
      skill: 'WRITING',
      items: Array.from({ length: 3 }, (_, index) => ({
        task: `Independent writing ${index}`,
        rubric: 'Criteria',
        guidance: 'Guidance',
      })),
    });
  });
  const { Queue, Worker } = await import('bullmq');
  const { assessmentYieldFailureIdentity, yieldAssessmentForAudio } =
    await import('@/lib/learning/classes/generation/assessment-yield');
  const redisUrl = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
  const connection = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port),
    maxRetriesPerRequest: null,
  };
  const prefix = `assessment-yield-${randomUUID()}`;
  const queue = new Queue('interactions', { connection, prefix });
  const signal = new AbortController().signal;
  let yieldAuthority: object | undefined;
  let releaseParent!: () => void;
  let parentReady!: () => void;
  const parentStop = new Promise<void>((resolve) => {
    releaseParent = resolve;
  });
  const parentStarted = new Promise<void>((resolve) => {
    parentReady = resolve;
  });
  const parentExecution = withSottoJobExecution({
    database: instance.database,
    parentId: operation.id,
    fingerprint: operation.fingerprint,
    signal,
    capabilityScope: classScope,
    isCleanupFailure: () => false,
    validate: async () => true,
    run: async ({ capability }) => {
      if (!capability) throw new Error('Assessment execution capability missing');
      const callsBeforeReview = provider.generate.mock.calls.length;
      expect(
        await prepareOrGenerateAssessmentReviewProof({
          identity: operation,
          execution,
          capability,
          unresolved: () => {
            throw new Error('Unexpected unresolved review');
          },
        })
      ).toEqual({ status: 'PREPARING_AUDIO' });
      expect(provider.generate.mock.calls.length).toBe(callsBeforeReview);
      yieldAuthority = await captureAssessmentSettlementAuthority({
        identity: operation,
        capability,
      });
      parentReady();
      await parentStop;
    },
  });
  await Promise.race([
    parentStarted,
    parentExecution.then(() => {
      throw new Error('Assessment parent ended before waiting');
    }),
  ]);
  const worker = new Worker(
    queue.name,
    async (job, token) => {
      await expect(
        yieldAssessmentForAudio({
          database: instance.database,
          job,
          execution,
          token: undefined,
          signal,
        })
      ).rejects.toThrow();
      await expect(
        yieldAssessmentForAudio({
          database: instance.database,
          job,
          execution,
          token,
          signal,
        })
      ).rejects.toThrow();
      releaseParent();
      await parentExecution;
      const cancelledBeforeMove = new AbortController();
      cancelledBeforeMove.abort();
      let cancellation: unknown;
      try {
        await yieldAssessmentForAudio({
          database: instance.database,
          job,
          execution,
          token,
          signal: cancelledBeforeMove.signal,
          authority: yieldAuthority,
        });
      } catch (error) {
        cancellation = error;
      }
      expect(cancellation).toBeDefined();
      expect(assessmentYieldFailureIdentity(cancellation)).toBeNull();
      const cancelledDuringMove = new AbortController();
      if (completionMode === 'yield_lost' || completionMode === 'yield_cancel') {
        const originalMove = job.moveToDelayed.bind(job);
        vi.spyOn(job, 'moveToDelayed').mockImplementation(async (timestamp, lockToken) => {
          await originalMove(timestamp, lockToken);
          if (completionMode === 'yield_cancel') cancelledDuringMove.abort();
          throw new Error('Lost queue transition acknowledgment');
        });
      }
      let delayError: unknown;
      try {
        await yieldAssessmentForAudio({
          database: instance.database,
          job,
          execution,
          token:
            completionMode === 'yield_missing'
              ? undefined
              : completionMode === 'yield_lost' || completionMode === 'yield_cancel'
                ? token
                : 'wrong-token',
          signal: completionMode === 'yield_cancel' ? cancelledDuringMove.signal : signal,
          authority: yieldAuthority,
        });
      } catch (error) {
        delayError = error;
      }
      expect(delayError).toBeInstanceOf(Error);
      if (completionMode === 'yield_stale') {
        if (!yieldAuthority) throw new Error('Assessment yield authority missing');
        await withSottoJobExecution({
          database: instance.database,
          parentId: operation.id,
          fingerprint: operation.fingerprint,
          signal,
          capabilityScope: classScope,
          isCleanupFailure: () => false,
          validate: async () => true,
          run: async () => {},
        });
        await expect(
          markFailedAssessmentYield({
            database: instance.database,
            authority: yieldAuthority,
            error: delayError,
          })
        ).rejects.toThrow();
        throw delayError;
      }
      if (
        ['yield_failure', 'yield_missing', 'yield_lost', 'yield_cancel'].includes(completionMode)
      ) {
        if (!yieldAuthority) throw new Error('Assessment yield authority missing');
        expect(() =>
          markFailedAssessmentYield({
            database: instance.database,
            authority: yieldAuthority!,
            error: new Error('forged'),
          })
        ).toThrow();
        expect(
          await markFailedAssessmentYield({
            database: instance.database,
            authority: yieldAuthority,
            error: delayError,
          })
        ).toEqual({ status: 'UNRESOLVED' });
        throw delayError;
      }
      await yieldAssessmentForAudio({
        database: instance.database,
        job,
        execution,
        token,
        signal,
      });
    },
    { connection, prefix, autorun: false }
  );
  worker.on('error', () => {});
  try {
    const queued = await queue.add(
      'interactions.v6',
      { operationId: operation.id, fingerprint: operation.fingerprint },
      {
        jobId: operation.id,
        attempts: completionMode === 'yield' ? record.job.delivery.attempts : 1,
      }
    );
    void worker.run();
    if (['yield_failure', 'yield_missing', 'yield_lost', 'yield_cancel'].includes(completionMode))
      await expect
        .poll(
          async () =>
            (
              await instance.database.classAssessment.findUniqueOrThrow({
                where: { id: assessment },
              })
            ).status
        )
        .toBe('UNRESOLVED');
    const moved = ['yield', 'yield_lost', 'yield_cancel'].includes(completionMode);
    await expect
      .poll(() => queued.getState(), { timeout: 10000 })
      .toBe(moved ? 'delayed' : 'failed');
    const delayed = await queue.getJob(operation.id);
    expect(delayed?.attemptsMade).toBe(moved ? 0 : 1);
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(operation.id)))
        ?.complete
    ).toBe(false);
    expect(
      await instance.database.classAssessment.findUniqueOrThrow({
        where: { id: assessment },
      })
    ).toMatchObject({
      status: ['yield_failure', 'yield_missing', 'yield_lost', 'yield_cancel'].includes(
        completionMode
      )
        ? 'UNRESOLVED'
        : 'GENERATING',
      sealedAt: null,
    });
  } finally {
    releaseParent();
    await parentExecution;
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
  return;
}
