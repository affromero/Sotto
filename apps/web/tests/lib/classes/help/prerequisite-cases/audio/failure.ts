import { expect, vi } from 'vitest';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { markExpiredAssessmentUnresolved } from '@/lib/learning/classes/lifecycle/assessment-unresolved';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import type {
  SottoJobExecutionCapability,
  SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { validateAssessmentAudioLineage } from '@/lib/learning/classes/audio/assessment-audio-lineage';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { invalidateServerInfra } from '@/lib/server-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  runSottoExecutionOperation,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { removeExecutionWorkspace } from 'thesidedoor-core/storage';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';

interface AudioFailureContext {
  instance: SharedTestInstance;
  audioQueue: typeof import('@/lib/queue');
  audioRecord: NonNullable<Awaited<ReturnType<ReturnType<typeof sottoJobOutbox>['read']>>>;
  speechAttempt: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
  };
  attemptStatus: (fingerprint?: string) => Promise<unknown>;
  durableQueueExecution: typeof import('@/lib/sidedoor/jobs/core/durable-queue').durableQueueExecution;
  durableQueueJobIdentity: typeof import('@/lib/sidedoor/jobs/core/durable-queue').durableQueueJobIdentity;
  durableJobProviderExecution: typeof import('@/lib/sidedoor/jobs/core/durable-queue').durableJobProviderExecution;
  identity: { ownerId: string };
  queuedAudio: string[];
  audioScope: { subjectId: string; generation: number };
  processAudioGeneration: typeof import('@/workers/audio-generation.worker').processAudioGeneration;
  unbound: import('bullmq').Job<import('@/lib/queue').GenerateAudioPayload>;
  getAudioWorkspace: () => string | undefined;
  runBoundAudio: (signal?: AbortSignal, onCleanup?: () => void) => Promise<void>;
  recoverStoppedTestExecution: (parentId: string) => Promise<void>;
}

export async function checkAssessmentAudioFailure({
  instance,
  audioQueue,
  audioRecord,
  speechAttempt,
  attemptStatus,
  durableQueueExecution,
  durableQueueJobIdentity,
  durableJobProviderExecution,
  identity,
  queuedAudio,
  audioScope,
  processAudioGeneration,
  unbound,
  getAudioWorkspace,
  runBoundAudio,
  recoverStoppedTestExecution,
}: AudioFailureContext) {
  const originalDelivery = await audioQueue.audioGenerationQueue.getJob(audioRecord.job.id);
  if (!originalDelivery) throw new Error('Original assessment audio delivery missing');
  await sottoTransaction(instance.database, (tx) =>
    validateAssessmentAudioLineage(tx, speechAttempt!.episodeId, speechAttempt!.generationKey)
  );
  expect(await attemptStatus()).toBe('ABSENT');
  const noReceiptWorker = audioQueue.createWorker<import('@/lib/queue').GenerateAudioPayload>(
    'audio-generation',
    async (job) => {
      durableQueueExecution(job);
      await noReceiptWorker.pause(true);
    },
    { concurrency: 1 }
  );
  let noReceiptTimer: ReturnType<typeof setTimeout> | undefined;
  const noReceiptFailure = new Promise<Error>((resolve, reject) => {
    noReceiptWorker.on('failed', (job, error) => {
      if (job?.id === audioRecord.job.id) resolve(error);
    });
    noReceiptTimer = setTimeout(() => reject(new Error('Missing receipt was not rejected')), 15000);
  });
  try {
    await noReceiptWorker.waitUntilReady();
    expect(await noReceiptFailure).toBeInstanceOf(AssessmentFenceConflict);
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(audioRecord.job.id)
        )
      )?.complete
    ).toBe(false);
    expect(await attemptStatus()).toBe('ABSENT');
  } finally {
    if (noReceiptTimer) clearTimeout(noReceiptTimer);
    await noReceiptWorker.close();
  }
  await originalDelivery.remove();
  const duplicate = prepareJob({
    ...audioRecord.job,
    id: randomUUID(),
    delivery: { ...audioRecord.job.delivery, attempts: 1 },
  });
  const duplicateRecord = await sottoTransaction(instance.database, (tx) =>
    sottoJobOutbox(tx).enqueue(duplicate)
  );
  queuedAudio.push(duplicate.id);
  const { deliverSottoJob } = await import('@/lib/sidedoor/jobs/core/job-delivery');
  const identityOwner = identity.ownerId;
  const worker = audioQueue.createWorker<import('@/lib/queue').GenerateAudioPayload>(
    'audio-generation',
    async (job) => {
      const identity = durableQueueJobIdentity(job);
      await runSottoExecutionOperation(
        durableQueueExecution(job),
        { parentId: identity.operationId, fingerprint: identity.fingerprint },
        async () => {
          const execution = durableJobProviderExecution(
            job,
            identityOwner,
            new AbortController().signal
          );
          if (!execution.onCleanupError) throw new Error('Provider cleanup callback missing');
          execution.onCleanupError(new Error('Simulated provider cleanup failure'));
        }
      );
    },
    { concurrency: 1 }
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<Error>((resolve, reject) => {
    worker.on('failed', (job, error) => {
      if (job?.id === duplicate.id) resolve(error);
    });
    timer = setTimeout(() => reject(new Error('Assessment audio worker did not fail')), 15000);
  });
  try {
    await worker.waitUntilReady();
    await deliverSottoJob({
      database: instance.database,
      queue: audioQueue.audioGenerationQueue,
      operationId: duplicate.id,
      fingerprint: duplicateRecord.fingerprint,
      version: 1,
    });
    expect((await failed).message).toContain('Execution cleanup is unconfirmed');
    await worker.close();
    const pending = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(duplicate.id)
    );
    expect(pending?.complete).toBe(false);
    const inventory = await sottoTransaction(instance.database, (tx) =>
      sottoJobExecutions(tx).listUnresolved(audioScope)
    );
    const retained = inventory.executions.find((item) => item.parentId === duplicate.id);
    if (!retained?.workspace || !('directory' in retained.workspace))
      throw new Error('Uncertain audio execution workspace missing');
    expect(retained.status).toBe('cleanup-unconfirmed');
    const binding = {
      id: retained.id,
      parentId: retained.parentId,
      fingerprint: retained.fingerprint,
      executorId: retained.executorId,
    };
    await removeExecutionWorkspace(retained.workspace, retained.workspace.locationId);
    await sottoTransaction(instance.database, async (tx) => {
      await sottoJobExecutions(tx).releaseWorkspace(binding, retained.workspace!);
      await sottoJobExecutions(tx).settle(binding);
      await sottoJobOutbox(tx).complete(duplicate.id, duplicateRecord.fingerprint);
    });
    // Remove only the synthetic job created by this isolated queue scenario.
    await instance.database.sidedoorState.deleteMany({
      where: { id: { endsWith: `:${duplicate.id}` } },
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.close();
    await deliverSottoJob({
      database: instance.database,
      queue: audioQueue.audioGenerationQueue,
      operationId: audioRecord.job.id,
      fingerprint: audioRecord.fingerprint,
      version: 1,
    });
  }
  await expect(processAudioGeneration(unbound)).rejects.toThrow('binding is missing');
  expect(await attemptStatus()).toBe('ABSENT');
  const failureRoot = await mkdtemp(join(tmpdir(), 'sotto-assessment-failed-speech-'));
  try {
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      sttProvider: 'local',
      ttsBaseUrl: 'http://127.0.0.1:34991',
      sttBaseUrl: 'http://127.0.0.1:34992',
      ttsVoices: 'fixture-voice',
      storageProvider: 'local',
      localStorageRoot: failureRoot,
    });
    invalidateServerInfra();
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    const failingSpeech = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Provider unavailable', { status: 503 }));
    const tts = await import('@/lib/tts-generation');
    const generate = tts.generateTtsAudio;
    const generation = vi.spyOn(tts, 'generateTtsAudio').mockImplementation(async (params) => {
      if (!params.executionDirectory) throw new Error('Execution workspace missing');
      expect(params.executionDirectory).toBe(getAudioWorkspace());
      expect((await stat(params.executionDirectory)).isDirectory()).toBe(true);
      return generate(params);
    });
    try {
      const firstFailure = await runBoundAudio().then(
        () => null,
        (error: unknown) => error
      );
      if (!failingSpeech.mock.calls.length) throw firstFailure;
      expect(firstFailure).toBeInstanceOf(Error);
      expect(failingSpeech).toHaveBeenCalled();
      expect(generation).toHaveBeenCalled();
      const dispatches = failingSpeech.mock.calls.length;
      expect(await attemptStatus()).toBe('ACTIVE');
      await recoverStoppedTestExecution(audioRecord.job.id);
      await expect(runBoundAudio()).rejects.toThrow();
      expect(failingSpeech).toHaveBeenCalledTimes(dispatches);
    } finally {
      generation.mockRestore();
      failingSpeech.mockRestore();
    }
  } finally {
    // Reset this isolated fixture before the separate publication scenarios below.
    await instance.database.sidedoorState.deleteMany({
      where: {
        id: { contains: ':assessment-audio-attempt:', endsWith: speechAttempt.operationId },
      },
    });
    await rm(failureRoot, { recursive: true, force: true });
  }
  const abortRoot = await mkdtemp(join(tmpdir(), 'sotto-assessment-aborted-speech-'));
  const controller = new AbortController();
  let respond!: (response: Response) => void;
  let notifyDispatch!: () => void;
  let notifyCancel!: () => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  const dispatched = new Promise<void>((resolve) => {
    notifyDispatch = resolve;
  });
  const cancelled = new Promise<void>((resolve) => {
    notifyCancel = resolve;
  });
  const lateResponse = new Response(
    new ReadableStream({
      cancel: async () => {
        notifyCancel();
        throw new Error('Late provider response cleanup failed');
      },
    })
  );
  try {
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      sttProvider: 'local',
      ttsBaseUrl: 'http://127.0.0.1:34991',
      sttBaseUrl: 'http://127.0.0.1:34992',
      ttsVoices: 'fixture-voice',
      storageProvider: 'local',
      localStorageRoot: abortRoot,
    });
    invalidateServerInfra();
    const pendingFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      notifyDispatch();
      return response;
    });
    try {
      let cleanupReports = 0;
      const running = runBoundAudio(controller.signal, () => {
        cleanupReports += 1;
      }).then(
        () => null,
        (error: unknown) => error
      );
      await Promise.race([
        dispatched,
        running.then((error) => {
          throw error ?? new Error('Audio execution ended before provider dispatch');
        }),
      ]);
      controller.abort();
      expect(await running).toBeInstanceOf(Error);
      expect(await attemptStatus()).toBe('ACTIVE');
      expect(
        (
          await sottoTransaction(instance.database, (tx) =>
            sottoJobOutbox(tx).read(audioRecord.job.id)
          )
        )?.complete
      ).toBe(false);
      const unresolved = await sottoTransaction(instance.database, (tx) =>
        sottoJobExecutions(tx).listUnresolved(audioScope)
      );
      expect(unresolved.executions).toMatchObject([
        {
          parentId: audioRecord.job.id,
          status: 'cleanup-unconfirmed',
          workspace: expect.any(Object),
        },
      ]);
      const beforeLateResponse = cleanupReports;
      expect(beforeLateResponse).toBeGreaterThan(0);
      respond(lateResponse);
      await cancelled;
      await expect.poll(() => cleanupReports).toBeGreaterThan(beforeLateResponse);
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobExecutions(tx).blockingStatus(audioRecord.job.id, audioRecord.fingerprint)
        )
      ).toBe('cleanup-unconfirmed');
      await recoverStoppedTestExecution(audioRecord.job.id);
    } finally {
      controller.abort();
      respond(lateResponse);
      pendingFetch.mockRestore();
    }
  } finally {
    await instance.database.sidedoorState.deleteMany({
      where: {
        id: { contains: ':assessment-audio-attempt:', endsWith: speechAttempt.operationId },
      },
    });
    await rm(abortRoot, { recursive: true, force: true });
  }
  expect(await attemptStatus()).toBe('ABSENT');
}

interface AudioUnresolvedContext {
  instance: SharedTestInstance;
  audioQueue: typeof import('@/lib/queue');
  audioRecord: NonNullable<Awaited<ReturnType<ReturnType<typeof sottoJobOutbox>['read']>>>;
  operation: { id: string; fingerprint: string };
  record: { job: { payload: unknown } };
  completionMode: 'unresolved' | 'expired_child';
  assessment: string;
  startAudioExecution: () => Promise<{
    capability: SottoJobExecutionCapability;
    operation: SottoJobExecutionOperation;
    finish: () => Promise<void>;
  }>;
  failQueuedAudio: (operationId: string) => Promise<unknown>;
  runBoundAudio: (signal?: AbortSignal, onCleanup?: () => void) => Promise<void>;
}

export async function checkAssessmentAudioUnresolved({
  instance,
  audioQueue,
  audioRecord,
  operation,
  record,
  completionMode,
  assessment,
  startAudioExecution,
  failQueuedAudio,
  runBoundAudio,
}: AudioUnresolvedContext) {
  const activeWorker = await startAudioExecution();
  await failQueuedAudio(audioRecord.job.id);
  const { reconcileFailedAssessmentAudio } =
    await import('@/lib/learning/classes/audio/assessment-audio-reconciliation');
  const reconcile = () =>
    reconcileFailedAssessmentAudio({
      database: instance.database,
      queue: audioQueue!.audioGenerationQueue,
      operationId: audioRecord.job.id,
      fingerprint: audioRecord.fingerprint,
      signal: new AbortController().signal,
    });
  try {
    if (completionMode === 'expired_child') {
      const { fence } = assessmentWorkSchema.parse(record.job.payload);
      const authority = await sottoTransaction(instance.database, (tx) =>
        learningPreparationGrant(tx, fence, 'assessment').read(fence.grant)
      );
      const clock = vi.spyOn(Date, 'now').mockReturnValue(authority.grant.expiresAt);
      try {
        expect(
          await sottoTransaction(instance.database, (tx) =>
            markExpiredAssessmentUnresolved(tx, operation)
          )
        ).toBe(true);
      } finally {
        clock.mockRestore();
      }
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobExecutions(tx).blockingStatus(audioRecord.job.id, audioRecord.fingerprint)
        )
      ).toBe('active');
    }
    expect(await reconcile()).toBe('WAITING');
    expect(
      await instance.database.classAssessment.findUniqueOrThrow({
        where: { id: assessment },
      })
    ).toMatchObject({
      status: completionMode === 'expired_child' ? 'UNRESOLVED' : 'GENERATING',
      sealedAt: null,
    });
  } finally {
    await activeWorker.finish();
  }
  expect(await reconcile()).toBe('UNRESOLVED');
  const executions = () =>
    instance.database.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM "SidedoorState"
              WHERE state->>'kind' = 'job_execution'
                AND state->>'parentId' = ${audioRecord.job.id}`;
  const beforeReplay = await executions();
  expect(await reconcile()).toBe('UNRESOLVED');
  expect(await executions()).toEqual(beforeReplay);
  expect(
    await instance.database.classAssessment.findUniqueOrThrow({ where: { id: assessment } })
  ).toMatchObject({ status: 'UNRESOLVED', sealedAt: null });
  expect(
    (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(audioRecord.job.id)))
      ?.complete
  ).toBe(false);
  const fetcher = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(runBoundAudio()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
  return;
}
