import { expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateRequest } from '@/lib/api-keys';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { classSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { processSpeakingGrading } from '@/workers/speaking-grading.worker';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { inspectSpeakingGradingDeletion } from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureStorageBackend } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { deleteClassForUser } from '@/lib/class-service';
import { Queue, Worker, type Job } from 'bullmq';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import {
  openExecutionLocation,
  planExecutionWorkspace,
  createExecutionWorkspace,
  removeExecutionWorkspace,
} from 'thesidedoor-core/storage';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { reconcileSottoJobs } from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { settleFailedClassSpeaking } from '@/lib/sidedoor/jobs/stitch/speaking-grading-failure';
import { acknowledgeUnresolvedSpeaking } from '@/lib/learning/speaking/recovery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  recoverSpeakingExecution,
  speakingCleanupReceiptId,
} from '@/lib/learning/speaking/execution-recovery';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import type { createSpeakingRecording } from '@/lib/sidedoor/storage/publication/speaking-recording-upload';

interface SpeakingRecoveryContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  promptId: string;
  request: Request;
  gate: (acknowledged: boolean) => Promise<Prisma.InputJsonObject>;
  upload: () => ReturnType<typeof createSpeakingRecording>;
  boundary: {
    resolve: (() => Promise<void>) | null;
    afterTranscription: (() => Promise<void>) | null;
  };
}

export function registerSpeakingRecoveryCases(getContext: () => SpeakingRecoveryContext) {
  it('requires drained execution before acknowledging a possible prior charge and preserves its evidence', async () => {
    const { instance, identity, classId, promptId, request, gate, upload } = getContext();
    await gate(true);
    const recording = await upload();
    const record = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(recording.operationId)
    );
    const payload = classSpeakingGradingPayloadSchema.parse(record?.job.payload);
    const parent = payload.ownership.associations.parents.find(
      (candidate) => candidate.kind === 'class'
    );
    if (!parent) throw new Error('Missing class ownership');
    const binding = {
      id: randomUUID(),
      parentId: recording.operationId,
      fingerprint: recording.fingerprint,
      executorId: randomUUID(),
    };
    await sottoTransaction(instance.database, async (database) => {
      await sottoJobExecutions(database).begin(binding);
      await learningPreparationGrant(
        database,
        { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
        'speaking'
      ).admit(payload.grant, { id: randomUUID(), fingerprint: 'c'.repeat(64) });
    });
    await sottoTransaction(instance.database, (database) =>
      settleFailedClassSpeaking(database, {
        operationId: recording.operationId,
        fingerprint: recording.fingerprint,
        handler: 'speaking-grading',
        version: 2,
        state: 'failed',
      })
    );
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    const acknowledge = () =>
      acknowledgeUnresolvedSpeaking({
        classId,
        promptId,
        recordingId: recording.id,
        execution: sottoRequestExecution(request, admission),
      });
    await expect(acknowledge()).rejects.toThrow('Execution cleanup is not confirmed');
    expect(
      (await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } }))
        .gradingAcknowledgedAt
    ).toBeNull();
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(binding)
    );
    expect(await Promise.all([acknowledge(), acknowledge()])).toEqual([
      { acknowledged: true },
      { acknowledged: true },
    ]);
    const old = await instance.database.speakingRecording.findUniqueOrThrow({
      where: { id: recording.id },
    });
    expect(old).toMatchObject({
      status: 'UNRESOLVED',
      gradingAcknowledgedAt: expect.any(Date),
      audioUrl: expect.any(String),
    });
    const course = await instance.database.course.findUniqueOrThrow({
      where: { id: parent.courseId },
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        inspectSpeakingGradingDeletion(database, [
          { subjectId: `course:${parent.courseId}`, generation: course.createdAt.getTime() },
        ])
      )
    ).rejects.toThrow('active or requires recovery');
    const next = await upload();
    expect(next.id).not.toBe(recording.id);
    expect(await instance.database.speakingRecording.count({ where: { promptId } })).toBe(2);
  });

  it('preserves and acknowledges an interrupted legacy class recording without replaying it', async () => {
    const { instance, identity, classId, promptId, request, gate, upload, boundary } = getContext();
    await gate(true);
    const recording = await upload();
    const original = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(recording.operationId)
    );
    if (!original) throw new Error('Missing recording job');
    const payload = classSpeakingGradingPayloadSchema.parse(original.job.payload);
    const legacy = await sottoTransaction(instance.database, async (database) => {
      await sottoJobOutbox(database).complete(recording.operationId, recording.fingerprint);
      await database.speakingRecording.update({
        where: { id: recording.id },
        data: { gradingOperationId: null, status: 'GRADING' },
      });
      return sottoJobOutbox(database).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'speaking-grading',
          version: 1,
          payload: {
            recordingId: payload.recordingId,
            recordingCreatedAt: payload.recordingCreatedAt,
            storage: payload.storage,
            ownership: payload.ownership,
          },
          scopes: original.job.scopes.filter((scope) => !scope.subjectId.startsWith('class:')),
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
    });
    let providerCalled = false;
    boundary.resolve = async () => {
      providerCalled = true;
    };
    await processSpeakingGrading({
      id: legacy.job.id,
      name: 'speaking-grading.v1',
      data: { operationId: legacy.job.id, fingerprint: legacy.fingerprint },
      attemptsMade: 1,
      updateProgress: vi.fn(),
    } as unknown as Job<unknown>);
    expect(providerCalled).toBe(false);
    expect(
      await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
    ).toMatchObject({ status: 'UNRESOLVED', gradingOperationId: legacy.job.id });
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    expect(
      await acknowledgeUnresolvedSpeaking({
        classId,
        promptId,
        recordingId: recording.id,
        execution: sottoRequestExecution(request, admission),
      })
    ).toEqual({ acknowledged: true });
    await expect(
      deleteClassForUser(classId, identity.ownerId, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('active or requires recovery');
    expect(await upload()).toMatchObject({ status: 'PENDING' });
  });

  it('erases completed legacy speaking payloads when their course is deleted', async () => {
    const { instance, identity, classId, gate, upload } = getContext();
    await gate(true);
    const recording = await upload();
    const original = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(recording.operationId)
    );
    if (!original) throw new Error('Missing recording job');
    const payload = classSpeakingGradingPayloadSchema.parse(original.job.payload);
    const parent = payload.ownership.associations.parents.find(
      (candidate) => candidate.kind === 'class'
    );
    if (!parent) throw new Error('Missing class ownership');
    const legacy = await sottoTransaction(instance.database, async (database) => {
      await learningPreparationGrant(
        database,
        { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
        'speaking'
      ).complete(payload.grant);
      await sottoJobOutbox(database).complete(recording.operationId, recording.fingerprint);
      await database.speakingRecording.update({
        where: { id: recording.id },
        data: { gradingOperationId: null, status: 'SCORED', overallScore: 1 },
      });
      const result = await sottoJobOutbox(database).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'speaking-grading',
          version: 1,
          payload: {
            recordingId: payload.recordingId,
            recordingCreatedAt: payload.recordingCreatedAt,
            storage: payload.storage,
            ownership: payload.ownership,
          },
          scopes: original.job.scopes.filter((scope) => !scope.subjectId.startsWith('class:')),
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
      await sottoJobOutbox(database).complete(result.job.id, result.fingerprint);
      return result;
    });
    const course = await instance.database.course.findUniqueOrThrow({
      where: { id: parent.courseId },
    });
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    await expect(deleteClassForUser(classId, identity.ownerId, execution)).rejects.toThrow(
      'older speaking history'
    );
    const originalClass = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
    });
    expect(
      await instance.database.speakingRecording.findUnique({ where: { id: recording.id } })
    ).not.toBeNull();
    expect(
      await instance.database.$transaction((database) =>
        sottoJobOutbox(database).receipt(legacy.job.id)
      )
    ).toMatchObject({ status: 'complete', fingerprint: legacy.fingerprint });
    const other = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: originalClass.lessonId,
        order: 2,
        status: 'AVAILABLE',
        adaptiveSeed: { teaching: sampleTeaching },
      },
    });
    expect(await deleteClassForUser(other.id, identity.ownerId, execution)).toBe(true);
    const backend = await captureStorageBackend();
    await sottoTransaction(instance.database, async (database) => {
      await admitLearningStorageDeletion({
        database,
        scope: { kind: 'course', id: course.id, episodeIds: [] },
        subjects: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
        currentBackend: backend,
      });
      await database.course.delete({ where: { id: course.id } });
    });
    expect(
      await instance.database.$transaction((database) =>
        sottoJobOutbox(database).receipt(legacy.job.id)
      )
    ).toMatchObject({ status: 'erased', fingerprint: legacy.fingerprint });
    expect(
      await instance.database.$transaction((database) =>
        sottoJobOutbox(database).receipt(recording.operationId)
      )
    ).toMatchObject({ status: 'erased', fingerprint: recording.fingerprint });
  });

  it.each(['normal', 'interrupted', 'concurrent'] as const)(
    'requires exact operator cleanup before acknowledging an uncertain workspace (%s)',
    async (mode) => {
      const { instance, identity, classId, promptId, request, gate, upload } = getContext();
      const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-operator-'));
      const root = join(directory, 'executions');
      vi.stubEnv('SIDEDOOR_EXECUTION_DIR', root);
      try {
        await gate(true);
        const recording = await upload();
        const record = await instance.database.$transaction((database) =>
          sottoJobOutbox(database).read(recording.operationId)
        );
        const payload = classSpeakingGradingPayloadSchema.parse(record?.job.payload);
        const parent = payload.ownership.associations.parents.find(
          (candidate) => candidate.kind === 'class'
        );
        if (!parent) throw new Error('Missing class ownership');
        const binding = {
          id: randomUUID(),
          parentId: recording.operationId,
          fingerprint: recording.fingerprint,
          executorId: randomUUID(),
        };
        const location = await openExecutionLocation(root, { create: true });
        const plan = await planExecutionWorkspace(
          location.root.root,
          location.locationId,
          binding.id
        );
        await sottoTransaction(instance.database, (database) =>
          sottoJobExecutions(database).begin(binding, plan)
        );
        const workspace = await createExecutionWorkspace(plan);
        await sottoTransaction(instance.database, async (database) => {
          await sottoJobExecutions(database).attachWorkspace(binding, workspace);
          await sottoJobExecutions(database).markCleanupUnconfirmed(binding);
          await learningPreparationGrant(
            database,
            { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
            'speaking'
          ).admit(payload.grant, { id: randomUUID(), fingerprint: 'e'.repeat(64) });
        });
        await sottoTransaction(instance.database, (database) =>
          settleFailedClassSpeaking(database, {
            operationId: recording.operationId,
            fingerprint: recording.fingerprint,
            handler: 'speaking-grading',
            version: 2,
            state: 'failed',
          })
        );
        await expect(
          recoverSpeakingExecution({
            binding: { ...binding, executorId: randomUUID() },
            supervisorStopped: true,
          })
        ).rejects.toThrow();
        if (mode === 'interrupted') {
          await instance.database.sidedoorState.create({
            data: {
              id: speakingCleanupReceiptId(binding.id),
              revision: randomUUID(),
              state: { binding, workspace, directory: workspace.directory },
            },
          });
          await removeExecutionWorkspace(workspace, location.locationId);
        }
        if (mode === 'concurrent') {
          const outcomes = await Promise.allSettled([
            recoverSpeakingExecution({ binding, supervisorStopped: true }),
            recoverSpeakingExecution({ binding, supervisorStopped: true }),
          ]);
          expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
        } else {
          expect(await recoverSpeakingExecution({ binding, supervisorStopped: true })).toEqual({
            executionId: binding.id,
            containers: 0,
          });
        }
        expect(
          await instance.database.sidedoorState.findUnique({
            where: { id: speakingCleanupReceiptId(binding.id) },
          })
        ).toBeNull();
        const admission = await authenticateRequest(request);
        if (!admission) throw new Error('Missing test session');
        expect(
          await acknowledgeUnresolvedSpeaking({
            classId,
            promptId,
            recordingId: recording.id,
            execution: sottoRequestExecution(request, admission),
          })
        ).toEqual({ acknowledged: true });
        const grant = await instance.database.$transaction((database) =>
          learningPreparationGrant(
            database,
            { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
            'speaking'
          ).read(payload.grant)
        );
        expect(grant).toMatchObject({ status: 'revoked', attempts: [{ outcome: 'admitted' }] });
        expect(
          await instance.database.speakingRecording.findUniqueOrThrow({
            where: { id: recording.id },
          })
        ).toMatchObject({ status: 'UNRESOLVED', gradingAcknowledgedAt: expect.any(Date) });
      } finally {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('retains the execution fence when its attached workspace is missing', async () => {
    const { instance, identity, classId, promptId, request, gate, upload } = getContext();
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-missing-workspace-'));
    const root = join(directory, 'executions');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', root);
    try {
      await gate(true);
      const recording = await upload();
      const record = await instance.database.$transaction((database) =>
        sottoJobOutbox(database).read(recording.operationId)
      );
      const payload = classSpeakingGradingPayloadSchema.parse(record?.job.payload);
      const parent = payload.ownership.associations.parents.find(
        (candidate) => candidate.kind === 'class'
      );
      if (!parent) throw new Error('Missing class ownership');
      const binding = {
        id: randomUUID(),
        parentId: recording.operationId,
        fingerprint: recording.fingerprint,
        executorId: randomUUID(),
      };
      const location = await openExecutionLocation(root, { create: true });
      const plan = await planExecutionWorkspace(
        location.root.root,
        location.locationId,
        binding.id
      );
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).begin(binding, plan)
      );
      const workspace = await createExecutionWorkspace(plan);
      await sottoTransaction(instance.database, async (database) => {
        await sottoJobExecutions(database).attachWorkspace(binding, workspace);
        await sottoJobExecutions(database).markCleanupUnconfirmed(binding);
        await learningPreparationGrant(
          database,
          { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
          'speaking'
        ).admit(payload.grant, { id: randomUUID(), fingerprint: 'f'.repeat(64) });
      });
      await sottoTransaction(instance.database, (database) =>
        settleFailedClassSpeaking(database, {
          operationId: recording.operationId,
          fingerprint: recording.fingerprint,
          handler: 'speaking-grading',
          version: 2,
          state: 'failed',
        })
      );
      await rm(workspace.directory.root, { recursive: true, force: true });
      await expect(
        recoverSpeakingExecution({ binding, supervisorStopped: true })
      ).rejects.toThrow();
      const admission = await authenticateRequest(request);
      if (!admission) throw new Error('Missing test session');
      await expect(
        acknowledgeUnresolvedSpeaking({
          classId,
          promptId,
          recordingId: recording.id,
          execution: sottoRequestExecution(request, admission),
        })
      ).rejects.toThrow('Execution cleanup is not confirmed');
      expect(
        await instance.database.$transaction((database) =>
          sottoJobExecutions(database).blockingStatus(binding.parentId, binding.fingerprint)
        )
      ).toBe('cleanup-unconfirmed');
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(Boolean(process.env.SOTTO_TEST_PRIVATE_REDIS_URL))(
    'reconciles an exhausted queue after an admitted provider request',
    async () => {
      const { instance, identity, gate, upload } = getContext();
      const redis = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
      if (!['localhost', '127.0.0.1'].includes(redis.hostname))
        throw new Error('Use private local Redis');
      const connection = {
        host: redis.hostname,
        port: Number(redis.port),
        db: Number(redis.pathname.slice(1) || '0'),
        maxRetriesPerRequest: null,
      };
      const prefix = `speaking-failure-${randomUUID()}`;
      const queue = new Queue('speaking-grading', { connection, prefix });
      const worker = new Worker(
        queue.name,
        async () => {
          throw new Error('fixture worker stopped');
        },
        { connection, prefix, autorun: false }
      );
      try {
        await gate(true);
        const recording = await upload();
        const record = await instance.database.$transaction((database) =>
          sottoJobOutbox(database).read(recording.operationId)
        );
        const payload = classSpeakingGradingPayloadSchema.parse(record?.job.payload);
        const parent = payload.ownership.associations.parents.find(
          (candidate) => candidate.kind === 'class'
        );
        if (!parent) throw new Error('Missing class ownership');
        await sottoTransaction(instance.database, (database) =>
          learningPreparationGrant(
            database,
            { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
            'speaking'
          ).admit(payload.grant, { id: randomUUID(), fingerprint: 'b'.repeat(64) })
        );
        await deliverSottoJob({
          database: instance.database,
          queue,
          operationId: recording.operationId,
          fingerprint: recording.fingerprint,
          version: 2,
        });
        const exhausted = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Speaking job did not exhaust')), 10_000);
          worker.on('failed', async (job) => {
            if (job?.id !== recording.operationId || (await job.getState()) !== 'failed') return;
            clearTimeout(timer);
            resolve();
          });
        });
        void worker.run();
        await worker.waitUntilReady();
        await exhausted;
        const page = await reconcileSottoJobs({
          database: instance.database,
          queues: new Map([[queue.name, queue]]),
          signal: new AbortController().signal,
          cursor: null,
        });
        expect(page.results).toContainEqual(
          expect.objectContaining({ id: recording.operationId, status: 'complete' })
        );
        expect(
          await instance.database.speakingRecording.findUniqueOrThrow({
            where: { id: recording.id },
          })
        ).toMatchObject({ status: 'UNRESOLVED', audioUrl: expect.any(String), transcript: null });
        await expect(upload()).rejects.toThrow(
          'previous recording is still grading or needs recovery'
        );
      } finally {
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    }
  );

  it('fails safely when teaching changes just before the first provider request', async () => {
    const { instance, identity, gate, upload, boundary } = getContext();
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-before-dispatch-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    try {
      await gate(true);
      const recording = await upload();
      boundary.resolve = async () => {
        await gate(true);
      };
      const jobRecord = await instance.database.$transaction((database) =>
        sottoJobOutbox(database).read(recording.operationId)
      );
      const payload = classSpeakingGradingPayloadSchema.parse(jobRecord?.job.payload);
      const parent = payload.ownership.associations.parents.find(
        (candidate) => candidate.kind === 'class'
      );
      if (!parent) throw new Error('Missing class ownership');
      const job = {
        id: recording.operationId,
        name: 'speaking-grading.v2',
        data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
        updateProgress: vi.fn(),
      } as unknown as Job<unknown>;
      await processSpeakingGrading(job);
      const grant = await instance.database.$transaction((database) =>
        learningPreparationGrant(
          database,
          { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
          'speaking'
        ).read(payload.grant)
      );
      expect(grant).toMatchObject({ status: 'revoked', attempts: [] });
      expect(
        await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
      ).toMatchObject({ status: 'FAILED', transcript: null, overallScore: null });
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fences a paid transcription when teaching changes before scoring', async () => {
    const { instance, identity, classId, gate, upload, boundary } = getContext();
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-changed-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    try {
      const receipt = await gate(true);
      const recording = await upload();
      boundary.afterTranscription = async () => {
        await gate(true);
      };
      const jobRecord = await instance.database.$transaction((database) =>
        sottoJobOutbox(database).read(recording.operationId)
      );
      const payload = classSpeakingGradingPayloadSchema.parse(jobRecord?.job.payload);
      const parent = payload.ownership.associations.parents.find(
        (candidate) => candidate.kind === 'class'
      );
      if (!parent) throw new Error('Missing class ownership');
      const job = {
        id: recording.operationId,
        name: 'speaking-grading.v2',
        data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
        updateProgress: vi.fn(),
      } as unknown as Job<unknown>;
      await processSpeakingGrading(job);
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { prerequisiteGate: receipt },
      });
      boundary.afterTranscription = null;
      await processSpeakingGrading(job);
      const grant = await instance.database.$transaction((database) =>
        learningPreparationGrant(
          database,
          { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
          'speaking'
        ).read(payload.grant)
      );
      expect(grant.attempts.map((attempt) => attempt.outcome)).toEqual(['succeeded']);
      expect(
        await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
      ).toMatchObject({ status: 'UNRESOLVED', transcript: null, overallScore: null });
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retires the grant before completing a recording that is already failed', async () => {
    const { instance, identity, gate, upload } = getContext();
    await gate(true);
    const recording = await upload();
    const record = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(recording.operationId)
    );
    const payload = classSpeakingGradingPayloadSchema.parse(record?.job.payload);
    const parent = payload.ownership.associations.parents.find(
      (candidate) => candidate.kind === 'class'
    );
    if (!parent) throw new Error('Missing class ownership');
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { status: 'FAILED' },
    });
    await processSpeakingGrading({
      id: recording.operationId,
      name: 'speaking-grading.v2',
      data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
      updateProgress: vi.fn(),
    } as unknown as Job<unknown>);
    const grant = await instance.database.$transaction((database) =>
      learningPreparationGrant(
        database,
        { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
        'speaking'
      ).read(payload.grant)
    );
    expect(grant).toMatchObject({ status: 'revoked', attempts: [] });
    expect(
      await instance.database.$transaction((database) =>
        sottoJobOutbox(database).receipt(recording.operationId)
      )
    ).toMatchObject({ status: 'complete' });
  });
}
