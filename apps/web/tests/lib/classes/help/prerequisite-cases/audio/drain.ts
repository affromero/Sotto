import { expect, vi } from 'vitest';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sealAssessmentOutcome } from '@/lib/learning/classes/lifecycle/assessment-outcome';
import { verifyAssessmentAudioJobsDrained } from '@/lib/learning/classes/audio/assessment-audio-drain';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { runAssessmentAudioObservationTransaction } from '@/lib/learning/classes/audio/assessment-audio-claim';
import type { captureFailedAssessmentAudioEvidence } from '@/lib/learning/classes/audio/assessment-audio-failure';
import type {
  SottoJobExecutionCapability,
  SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';

type ObservationContext = {
  capability: SottoJobExecutionCapability;
  operation: SottoJobExecutionOperation;
};
type ObservationIdentity = Parameters<
  typeof runAssessmentAudioObservationTransaction
>[0]['identity'];
interface AudioDrainContext {
  instance: SharedTestInstance;
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  captured: {
    current: { ownership: { scopes: Array<{ subjectId: string; generation: number }> } };
  };
  classId: string;
  assessment: string;
  durableQueueOperationId: typeof import('@/lib/sidedoor/jobs/core/durable-queue').durableQueueOperationId;
  audioQueue: typeof import('@/lib/queue');
  heldOut: { episodeId: string | null };
  audioSegment: { id: string; version: number };
  generationKey: string;
  cls: { createdAt: Date };
  completionMode: string;
  failQueuedAudio: (operationId: string) => Promise<unknown>;
  startAudioExecution:
    (() => Promise<ObservationContext & { finish: () => Promise<void> }>) | undefined;
  observationTransaction: <Result>(
    context: ObservationContext,
    identity: ObservationIdentity,
    run: (tx: Prisma.TransactionClient) => Promise<Result>
  ) => Promise<Result>;
  captureFailedAudio: (
    context: ObservationContext,
    identity: ObservationIdentity & { nonce: string }
  ) => ReturnType<typeof captureFailedAssessmentAudioEvidence>;
  identity: { ownerId: string };
}

export async function checkAssessmentAudioDrain({
  instance,
  operation,
  execution,
  captured,
  classId,
  assessment,
  durableQueueOperationId,
  audioQueue,
  heldOut,
  audioSegment,
  generationKey,
  cls,
  completionMode,
  failQueuedAudio,
  startAudioExecution,
  observationTransaction,
  captureFailedAudio,
  identity,
}: AudioDrainContext) {
  const drain = () =>
    sottoTransaction(instance.database, (tx) =>
      verifyAssessmentAudioJobsDrained(tx, operation, execution)
    );
  expect(await drain()).toEqual({ status: 'WAITING' });
  const scope = captured.current.ownership.scopes.find(
    (item) => item.subjectId === `class:${classId}`
  );
  if (!scope) throw new Error('Assessment class scope missing');
  await withSottoJobExecution({
    database: instance.database,
    parentId: operation.id,
    fingerprint: operation.fingerprint,
    signal: new AbortController().signal,
    capabilityScope: scope,
    validate: async () => true,
    isCleanupFailure: () => false,
    run: async ({ capability }) => {
      if (!capability) throw new Error('Assessment execution capability missing');
      expect(
        await sealAssessmentOutcome({
          database: instance.database,
          identity: operation,
          execution,
          capability,
          authors: [],
          review: { materialDigest: '0'.repeat(64) },
        })
      ).toEqual({ status: 'WAITING' });
    },
  });
  expect(
    await instance.database.classAssessment.findUniqueOrThrow({ where: { id: assessment } })
  ).toMatchObject({ status: 'GENERATING', sealedAt: null });
  const childId = durableQueueOperationId(
    audioQueue.audioGenerationQueue.name,
    `audio-${heldOut.episodeId}-${audioSegment.id}-v${audioSegment.version}-${generationKey}`
  );
  const child = await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(childId));
  if (!child) throw new Error('Assessment audio child missing');
  const { verifyCompletedAssessmentAudioDelivery } =
    await import('@/lib/learning/classes/audio/assessment-audio-failure');
  const deliveryIdentity = {
    classId,
    classGeneration: cls.createdAt.getTime(),
    assessmentId: assessment,
    operationId: childId,
    fingerprint: child.fingerprint,
  };
  const verifyDelivery = () =>
    sottoTransaction(instance.database, (tx) =>
      verifyCompletedAssessmentAudioDelivery(tx, deliveryIdentity)
    );
  await expect(verifyDelivery()).rejects.toThrow();
  if (completionMode === 'worker') {
    let processingReady!: () => void;
    let releaseProcessing!: () => void;
    let lockReady!: () => void;
    let releaseLock!: () => void;
    const processed = new Promise<void>((resolve) => {
      processingReady = resolve;
    });
    const processGate = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      lockReady = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const { processAudioGeneration } = await import('@/workers/audio-generation.worker');
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const replayWorker = audioQueue.createWorker<import('@/lib/queue').GenerateAudioPayload>(
      'audio-generation',
      async (job, signal) => {
        await processAudioGeneration(job, signal);
        processingReady();
        await processGate;
      },
      { concurrency: 1 }
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completion = new Promise<Error | null>((resolve) => {
      replayWorker.on('completed', (job) => {
        if (job.id === childId) resolve(null);
      });
      replayWorker.on('failed', (job, error) => {
        if (job?.id === childId) resolve(error);
      });
      timer = setTimeout(() => resolve(new Error('Assessment audio replay timed out')), 15000);
    });
    let locker: Promise<void> | undefined;
    try {
      await replayWorker.waitUntilReady();
      await Promise.race([
        processed,
        completion.then((error) => {
          throw error ?? new Error('Replay completed before the gate');
        }),
      ]);
      const episodeScope = child.job.scopes.find(
        (scope) => scope.subjectId === `episode:${heldOut.episodeId}`
      );
      if (!episodeScope) throw new Error('Assessment audio episode scope missing');
      const executions = await sottoTransaction(instance.database, (tx) =>
        sottoJobExecutions(tx).listUnresolved(episodeScope)
      );
      const active = executions.executions.find((item) => item.parentId === childId);
      if (!active || active.status !== 'active') throw new Error('Audio replay execution missing');
      locker = instance.database.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM "SidedoorState"
              WHERE state->>'kind' = 'job_execution' AND state->>'id' = ${active.id} FOR UPDATE`;
          if (rows.length !== 1) throw new Error('Audio execution journal row missing');
          lockReady();
          await lockGate;
        },
        { isolationLevel: 'Serializable', timeout: 30000 }
      );
      await Promise.race([
        locked,
        locker.then(() => {
          throw new Error('Execution lock ended before replay');
        }),
      ]);
      releaseProcessing();
      await expect
        .poll(
          async () =>
            (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(childId)))
              ?.complete,
          { timeout: 10000 }
        )
        .toBe(true);
      expect(await drain()).toEqual({ status: 'WAITING' });
      expect(await verifyDelivery()).toEqual({ status: 'WAITING' });
      releaseLock();
      await locker;
      expect(await completion).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      releaseProcessing();
      releaseLock();
      if (timer) clearTimeout(timer);
      await locker?.catch(() => {});
      await replayWorker.close();
      fetcher.mockRestore();
    }
  } else if (completionMode === 'reconciler') {
    await failQueuedAudio(childId);
    const { reconcileSottoJobs } = await import('@/lib/sidedoor/jobs/core/job-reconciliation');
    let cursor: string | null = null;
    let result: { status: string } | undefined;
    let queueUses = 0;
    do {
      const page = await reconcileSottoJobs({
        database: instance.database,
        queues: new Map([[audioQueue.audioGenerationQueue.name, audioQueue.audioGenerationQueue]]),
        signal: new AbortController().signal,
        cursor,
        withQueue: async (name, queueSignal, execute) => {
          expect(name).toBe('audio-generation');
          queueSignal.throwIfAborted();
          queueUses += 1;
          return execute(audioQueue!.audioGenerationQueue);
        },
      });
      result = page.results.find((item) => item.id === childId);
      cursor = page.cursor;
    } while (!result && cursor);
    expect(result).toMatchObject({ status: 'complete' });
    expect(queueUses).toBeGreaterThan(0);
  } else {
    if (!startAudioExecution) throw new Error('Assessment audio execution missing');
    const observer = await startAudioExecution();
    const { claimAssessmentAudioObservation, inspectReleasedAssessmentAudioClaims } =
      await import('@/lib/learning/classes/audio/assessment-audio-claim');
    const { completeObservedAssessmentAudioPublication } =
      await import('@/lib/learning/classes/audio/assessment-audio-failure');
    try {
      const claim = await observationTransaction(observer, deliveryIdentity, (tx) =>
        claimAssessmentAudioObservation(tx, deliveryIdentity, observer.operation)
      );
      const evidence = await captureFailedAudio(observer, {
        ...deliveryIdentity,
        nonce: claim.nonce,
      });
      // Model a caller that loses the successful commit response.
      await observationTransaction(observer, deliveryIdentity, (tx) =>
        completeObservedAssessmentAudioPublication(
          tx,
          { ...deliveryIdentity, nonce: claim.nonce },
          evidence,
          observer.operation
        )
      );
      expect(await verifyDelivery()).toEqual({ status: 'WAITING' });
      expect(await drain()).toEqual({ status: 'WAITING' });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          inspectReleasedAssessmentAudioClaims(tx, {
            classId,
            classGeneration: cls.createdAt.getTime(),
            attempts: [
              {
                operationId: childId,
                fingerprint: child.fingerprint,
                assessmentId: assessment,
              },
            ],
          })
        )
      ).rejects.toThrow();
    } finally {
      await observer.finish();
    }
    expect(
      await sottoTransaction(instance.database, (tx) =>
        inspectReleasedAssessmentAudioClaims(tx, {
          classId,
          classGeneration: cls.createdAt.getTime(),
          attempts: [
            {
              operationId: childId,
              fingerprint: child.fingerprint,
              assessmentId: assessment,
            },
          ],
        })
      )
    ).toEqual([expect.objectContaining({ id: expect.stringContaining(childId) })]);
    const { deliverSottoJob } = await import('@/lib/sidedoor/jobs/core/job-delivery');
    expect(
      await deliverSottoJob({
        database: instance.database,
        queue: audioQueue.audioGenerationQueue,
        operationId: childId,
        fingerprint: child.fingerprint,
        version: 1,
      })
    ).toBe('complete');
  }
  expect(await drain()).toEqual({ status: 'DRAINED' });
  expect(await verifyDelivery()).toEqual({ status: 'DRAINED' });
  if (completionMode === 'observer') {
    const { DelayedError } = await import('bullmq');
    const { yieldAssessmentForAudio } =
      await import('@/lib/learning/classes/generation/assessment-yield');
    let scheduledAt = 0;
    const job = {
      id: operation.id,
      name: 'interactions.v6',
      data: { operationId: operation.id, fingerprint: operation.fingerprint },
      moveToDelayed: async (timestamp: number, token: string) => {
        expect(token).toBe('worker-token');
        scheduledAt = timestamp;
      },
    } as import('bullmq').Job<unknown>;
    await expect(
      yieldAssessmentForAudio({
        database: instance.database,
        job,
        execution,
        token: 'worker-token',
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(DelayedError);
    expect(scheduledAt).toBeGreaterThan(0);
    expect(scheduledAt).toBeLessThanOrEqual(Date.now());
  }
  await expect(
    sottoTransaction(instance.database, (tx) =>
      verifyCompletedAssessmentAudioDelivery(tx, {
        ...deliveryIdentity,
        fingerprint: '0'.repeat(64),
      })
    )
  ).rejects.toThrow();
  const receipt = await instance.database.sidedoorState.findFirstOrThrow({
    where: { id: { contains: ':assessment-audio-attempt:', endsWith: childId } },
  });
  await instance.database.sidedoorState.delete({ where: { id: receipt.id } });
  await expect(drain()).rejects.toThrow();
  await expect(verifyDelivery()).rejects.toThrow();
  await instance.database.sidedoorState.create({
    data: { ...receipt, state: receipt.state as Prisma.InputJsonValue },
  });
  expect(await drain()).toEqual({ status: 'DRAINED' });
  let releaseVersion!: () => void;
  let versionSnapshotReady!: () => void;
  const versionGate = new Promise<void>((resolve) => {
    releaseVersion = resolve;
  });
  const versionSnapshot = new Promise<void>((resolve) => {
    versionSnapshotReady = resolve;
  });
  const staleDrain = instance.database
    .$transaction(
      async (tx) => {
        await tx.user.findUniqueOrThrow({ where: { id: identity.ownerId } });
        versionSnapshotReady();
        await versionGate;
        await verifyAssessmentAudioJobsDrained(tx, operation, execution);
      },
      { isolationLevel: 'Serializable' }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await versionSnapshot;
  try {
    await instance.database.segment.update({
      where: { id: audioSegment.id },
      data: { version: 2 },
    });
  } finally {
    releaseVersion();
  }
  expect(isSerializationConflict(await staleDrain)).toBe(true);
  await instance.database.segment.update({
    where: { id: audioSegment.id },
    data: { version: 1 },
  });
  await instance.database.episode.update({
    where: { id: heldOut.episodeId! },
    data: { status: 'FAILED' },
  });
  await expect(drain()).rejects.toThrow();
  await instance.database.episode.update({
    where: { id: heldOut.episodeId! },
    data: { status: 'READY' },
  });
  await instance.database.segment.update({
    where: { id: audioSegment.id },
    data: { version: 2 },
  });
  await expect(drain()).rejects.toThrow();
  await instance.database.segment.update({
    where: { id: audioSegment.id },
    data: { version: 1 },
  });
}
