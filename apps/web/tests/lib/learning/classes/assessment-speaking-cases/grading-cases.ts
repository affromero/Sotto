import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareStorageCleanup, StorageCleanupJournal } from 'thesidedoor-core/storage';
import { authenticateRequest } from '@/lib/api-keys';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { assessmentSpeakingPrelaunchReceiptId } from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-prelaunch-receipt';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { assessmentMaterialDigest } from '@/lib/learning/classes/material/assessment-material';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';
import type { PrivateAssessmentMaterial } from '@/lib/learning/classes/material/assessment-material';
import type { admitAssessmentSpeaking } from '@/lib/learning/classes/speaking/assessment-speaking-admission';

interface AssessmentSpeakingCases {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  options: Parameters<typeof admitAssessmentSpeaking>[0];
  generationId: string;
  historicalMaterial: PrivateAssessmentMaterial;
  boundary: {
    task: unknown;
    sttDispatches: number;
    gradeDispatches: number;
    failStt: boolean;
    failGrade: boolean;
    waitStt: (() => Promise<void>) | null;
    failCompletion: boolean;
    unsupportedAi: boolean;
  };
}

export function registerAssessmentSpeakingCases(getContext: () => AssessmentSpeakingCases) {
  it('captures only the admitted task, owned recording, grant and exact audio for grading', async () => {
    const { instance, options, boundary } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { captureAssessmentSpeakingWork, verifyAssessmentSpeakingAudio } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-work');
    const admitted = await admitAssessmentSpeaking(options);
    const capture = () =>
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentSpeakingWork(tx, {
          operationId: admitted.operationId,
          fingerprint: admitted.fingerprint,
          execution: sottoRequestExecution(options.request, options.admission),
        })
      );
    const work = await capture();
    await expect(
      instance.database.$transaction((tx) =>
        captureAssessmentSpeakingWork(tx, {
          operationId: admitted.operationId,
          fingerprint: admitted.fingerprint,
          execution: sottoRequestExecution(options.request, options.admission),
        })
      )
    ).rejects.toThrow('Serializable');
    expect(() =>
      verifyAssessmentSpeakingAudio(options.audio, work.payload.assessment.audio)
    ).not.toThrow();
    expect(() =>
      verifyAssessmentSpeakingAudio(new Uint8Array([1, 2, 3]), work.payload.assessment.audio)
    ).toThrow();
    await instance.database.speakingRecording.update({
      where: { id: admitted.id },
      data: { sttSelection: { ...work.payload.assessment.selection, model: 'changed' } },
    });
    await expect(capture()).rejects.toThrow();
    await instance.database.speakingRecording.update({
      where: { id: admitted.id },
      data: { sttSelection: work.payload.assessment.selection },
    });
    boundary.task = { ...(boundary.task as object), materialDigest: 'd'.repeat(64) };
    await expect(capture()).rejects.toThrow();
  });

  it('does not treat a pending recording or another profile as completed evidence', async () => {
    const { instance, identity, options } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { captureAssessmentSpeakingEvidence } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-evidence');
    await admitAssessmentSpeaking(options);
    const capture = (execution: ReturnType<typeof sottoRequestExecution>) =>
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentSpeakingEvidence(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          promptId: options.promptId,
          execution,
        })
      );
    await expect(
      capture(sottoRequestExecution(options.request, options.admission))
    ).rejects.toThrow();
    const other = await identity.household('Another learner');
    const request = new Request('http://localhost/api/assessment/speaking', {
      headers: { cookie: `sotto_session=${other.token}` },
    });
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing second profile');
    await expect(capture(sottoRequestExecution(request, admission))).rejects.toThrow();
  });

  it('grades one admitted recording once and retains its private receipt', async () => {
    const { instance, options, boundary } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processSpeakingGrading } = await import('@/workers/speaking-grading.worker');
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    await processSpeakingGrading(job, AbortSignal.timeout(30_000));
    const recording = await instance.database.speakingRecording.findUniqueOrThrow({
      where: { id: admitted.id },
    });
    expect(recording).toMatchObject({ status: 'SCORED', transcript: 'Привет', overallScore: 0.8 });
    expect(boundary.sttDispatches).toBe(1);
    expect(boundary.gradeDispatches).toBe(1);
    await processSpeakingGrading(job, AbortSignal.timeout(30_000));
    expect(boundary.sttDispatches).toBe(1);
    expect(boundary.gradeDispatches).toBe(1);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(admitted.operationId)
    );
    expect(record?.complete).toBe(true);
    const snapshot = await sottoTransaction(instance.database, (tx) =>
      sottoJobSnapshot(tx).read(admitted.operationId, admitted.fingerprint, 0)
    );
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        operationId: admitted.operationId,
        fingerprint: admitted.fingerprint,
        recordingId: admitted.id,
        score: 0.8,
      }),
    ]);
    const { captureAssessmentSpeakingEvidence } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-evidence');
    const capture = () =>
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentSpeakingEvidence(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          promptId: options.promptId,
          execution: sottoRequestExecution(options.request, options.admission),
        })
      );
    expect(await capture()).toMatchObject({
      recordingId: admitted.id,
      operationFingerprint: admitted.fingerprint,
      evidence: { score: 0.8, itemId: options.promptId },
    });
    const { readAssessmentSpeakingStatus } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery');
    const readStatus = () =>
      sottoTransaction(instance.database, (tx) =>
        readAssessmentSpeakingStatus(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          promptId: options.promptId,
          execution: sottoRequestExecution(options.request, options.admission),
        })
      );
    expect(await readStatus()).toEqual({ status: 'COMPLETED', requestId: admitted.id });
    await instance.database.speakingRecording.update({
      where: { id: admitted.id },
      data: { feedback: 'Changed' },
    });
    await expect(capture()).rejects.toThrow();
    await expect(readStatus()).rejects.toThrow();
  });

  it('blocks deletion while assessment speaking work is retained', async () => {
    const { instance, identity, options, historicalMaterial } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { inspectSpeakingGradingDeletion, SpeakingDeletionConflict } =
      await import('@/lib/sidedoor/jobs/stitch/speaking-grading-deletion');
    const { processSpeakingGrading } = await import('@/workers/speaking-grading.worker');
    const admitted = await admitAssessmentSpeaking(options);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(admitted.operationId)
    );
    if (!record) throw new Error('Missing assessment speaking job');
    const inspect = () =>
      sottoTransaction(instance.database, (tx) =>
        inspectSpeakingGradingDeletion(tx, record.job.scopes)
      );
    await expect(inspect()).rejects.toBeInstanceOf(SpeakingDeletionConflict);
    await processSpeakingGrading(
      {
        id: admitted.operationId,
        name: 'speaking-grading.v3',
        data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
      } as import('bullmq').Job<unknown>,
      AbortSignal.timeout(30_000)
    );
    const { verifyAssessmentSpeakingForDeletion, reconcileAssessmentSpeakingDeletionScopes } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-deletion');
    const verify = (
      overrides: Partial<Parameters<typeof verifyAssessmentSpeakingForDeletion>[1]> = {}
    ) =>
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentSpeakingForDeletion(tx, {
          classId: options.classId,
          courseId: historicalMaterial.courseId,
          userId: identity.ownerId,
          assessmentId: options.assessmentId,
          recordingId: admitted.id,
          operationId: admitted.operationId,
          fingerprint: admitted.fingerprint,
          ...overrides,
        })
      );
    await expect(verify()).resolves.toBeUndefined();
    await expect(verify({ recordingId: randomUUID() })).rejects.toThrow();
    await expect(verify({ fingerprint: 'a'.repeat(64) })).rejects.toThrow();
    await expect(inspect()).rejects.toBeInstanceOf(SpeakingDeletionConflict);
    const classScope = record.job.scopes.find(
      (scope) => scope.subjectId === `class:${options.classId}`
    );
    const courseScope = record.job.scopes.find(
      (scope) => scope.subjectId === `course:${historicalMaterial.courseId}`
    );
    if (!classScope || !courseScope) throw new Error('Missing assessment deletion scopes');
    await sottoTransaction(instance.database, async (tx) => {
      const cleanup = new StorageCleanupJournal(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await cleanup.createJob(
        prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...classScope })
      );
      expect(
        await sottoJobSnapshot(tx).eraseNext(admitted.operationId, admitted.fingerprint)
      ).toEqual({ complete: true });
      await sottoJobOutbox(tx).erase(admitted.operationId, admitted.fingerprint, classScope);
    });
    const inspectCourse = () =>
      sottoTransaction(instance.database, (tx) =>
        inspectSpeakingGradingDeletion(tx, [courseScope])
      );
    const reconcileCourse = () =>
      sottoTransaction(instance.database, (tx) =>
        reconcileAssessmentSpeakingDeletionScopes(tx, [courseScope], [])
      );
    await expect(inspectCourse()).rejects.toBeInstanceOf(SpeakingDeletionConflict);
    await expect(reconcileCourse()).rejects.toThrow();
    await instance.database.sidedoorState.deleteMany({
      where: {
        id: {
          in: [
            `${SIDEDOOR_STATE_ID}:speaking-grant:${admitted.operationId}`,
            `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${admitted.operationId}`,
            assessmentSpeakingPrelaunchReceiptId(admitted.operationId),
          ],
        },
      },
    });
    await expect(inspectCourse()).resolves.toEqual([]);
    await expect(reconcileCourse()).resolves.toEqual([]);
  });

  it('verifies committed speaking evidence against the retained task and rejects changed grades', async () => {
    const { instance, identity, options, boundary, generationId, historicalMaterial } =
      getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const { verifyFailedAssessmentSpeaking } =
      await import('@/lib/learning/classes/history/assessment-failed-speaking');
    const { assessmentSpeakingReceiptSchema } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-receipt');
    const section = historicalMaterial.sections[0]!;
    if (section.skill !== 'SPEAKING') throw new Error('Speaking fixture is missing');
    const originalTask = boundary.task as object;
    const failed = await admitAssessmentSpeaking(options);
    boundary.unsupportedAi = true;
    await expect(
      processAssessmentSpeaking(
        {
          id: failed.operationId,
          name: 'speaking-grading.v3',
          data: { operationId: failed.operationId, fingerprint: failed.fingerprint },
        } as import('bullmq').Job<unknown>,
        AbortSignal.timeout(30_000)
      )
    ).rejects.toThrow();
    boundary.unsupportedAi = false;
    const completed: Array<{
      prompt: (typeof section.items)[number];
      admitted: Awaited<ReturnType<typeof admitAssessmentSpeaking>>;
      receipt: ReturnType<typeof assessmentSpeakingReceiptSchema.parse>;
    }> = [];
    for (const prompt of section.items) {
      boundary.task = { ...originalTask, prompt };
      const admitted = await admitAssessmentSpeaking({
        ...options,
        promptId: prompt.id,
        requestId: randomUUID(),
      });
      await processAssessmentSpeaking(
        {
          id: admitted.operationId,
          name: 'speaking-grading.v3',
          data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
        } as import('bullmq').Job<unknown>,
        AbortSignal.timeout(30_000)
      );
      const page = await sottoTransaction(instance.database, (tx) =>
        sottoJobSnapshot(tx).read(admitted.operationId, admitted.fingerprint, 0)
      );
      completed.push({
        prompt,
        admitted,
        receipt: assessmentSpeakingReceiptSchema.parse(page.items[0]),
      });
    }
    await sottoTransaction(instance.database, async (tx) => {
      const submission = await tx.classAssessmentSubmission.create({
        data: { assessmentId: options.assessmentId, requestDigest: 'a'.repeat(64), receipt: {} },
      });
      for (const { prompt, admitted, receipt } of completed)
        await tx.classAssessmentProductiveEvidence.create({
          data: {
            submissionId: submission.id,
            assessmentId: options.assessmentId,
            sectionId: section.id,
            promptId: prompt.id,
            speakingRecordingId: admitted.id,
            operationId: admitted.operationId,
            operationFingerprint: admitted.fingerprint,
            materialDigest: assessmentMaterialDigest(historicalMaterial),
            inputDigest: receipt.inputDigest,
            score: receipt.score,
            snapshot: receipt,
          },
        });
      await tx.classAssessment.update({
        where: { id: options.assessmentId },
        data: { status: 'COMMITTED' },
      });
    });
    const verify = () =>
      sottoTransaction(instance.database, (tx) =>
        verifyFailedAssessmentSpeaking(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          execution: sottoRequestExecution(options.request, options.admission),
          material: historicalMaterial,
          generationFence: {
            id: generationId,
            assessmentId: options.assessmentId,
            status: 'COMPLETED',
            speakingPolicy: 'READ_ALOUD_TRANSCRIPT_V1',
          },
        })
      );
    const verified = await verify();
    expect(verified).toHaveLength(section.items.length);
    expect(verified).toContainEqual(
      expect.objectContaining({ itemId: options.promptId, score: 0.8 })
    );
    const { verifyFailedSpeakingForDeletion } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-failed-verification');
    const verifyPriorFailure = () =>
      sottoTransaction(instance.database, (tx) =>
        verifyFailedSpeakingForDeletion(
          tx,
          {
            classId: options.classId,
            courseId: historicalMaterial.courseId,
            userId: identity.ownerId,
            assessmentId: options.assessmentId,
            recordingId: failed.id,
            operationId: failed.operationId,
            fingerprint: failed.fingerprint,
          },
          { material: historicalMaterial, speakingPolicy: 'READ_ALOUD_TRANSCRIPT_V1' }
        )
      );
    await expect(verifyPriorFailure()).resolves.toBeUndefined();
    await instance.database.speakingRecording.update({
      where: { id: failed.id },
      data: { overallScore: 0.8 },
    });
    await expect(verifyPriorFailure()).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyFailedAssessmentSpeaking(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          execution: sottoRequestExecution(options.request, options.admission),
          material: historicalMaterial,
          generationFence: {
            id: generationId,
            assessmentId: options.assessmentId,
            status: 'COMPLETED',
          },
        })
      )
    ).rejects.toThrow();
    await instance.database.speakingRecording.update({
      where: { id: completed[0]!.admitted.id },
      data: { feedback: 'Changed' },
    });
    await expect(verify()).rejects.toThrow();
  });

  it('does not repeat a speech provider request whose outcome is unknown', async () => {
    const { instance, options, boundary } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    boundary.failStt = true;
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow();
    boundary.failStt = false;
    expect(
      await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
    ).toMatchObject({ status: 'UNRESOLVED' });
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow();
    expect(boundary.sttDispatches).toBe(1);
    expect(boundary.gradeDispatches).toBe(0);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(admitted.operationId)
    );
    expect(record?.complete).toBe(false);
  });

  it('settles drained failed grading without retrying successful provider requests', async () => {
    const { instance, options, boundary } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    boundary.failGrade = true;
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow();
    expect(
      await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
    ).toMatchObject({ status: 'UNRESOLVED' });
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(admitted.operationId)
        )
      )?.complete
    ).toBe(true);
    boundary.failGrade = false;
    await processAssessmentSpeaking(job, AbortSignal.timeout(30_000));
    expect(boundary.sttDispatches).toBe(1);
    expect(boundary.gradeDispatches).toBe(1);
  });

  it('marks a drained failure before provider dispatch without losing its recording', async () => {
    const { instance, identity, options, boundary, historicalMaterial } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    boundary.unsupportedAi = true;
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow();
    const recording = await instance.database.speakingRecording.findUniqueOrThrow({
      where: { id: admitted.id },
    });
    expect(recording).toMatchObject({ status: 'FAILED' });
    expect(recording.audioUrl).toBeTruthy();
    expect(boundary.sttDispatches).toBe(0);
    expect(boundary.gradeDispatches).toBe(0);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(admitted.operationId)
    );
    expect(record?.complete).toBe(true);
    const { verifyAssessmentSpeakingForDeletion } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-deletion');
    const verification = {
      classId: options.classId,
      courseId: historicalMaterial.courseId,
      userId: identity.ownerId,
      assessmentId: options.assessmentId,
      recordingId: admitted.id,
      operationId: admitted.operationId,
      fingerprint: admitted.fingerprint,
    };
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentSpeakingForDeletion(tx, verification)
      )
    ).resolves.toBeUndefined();
    const { readAssessmentSpeakingStatus } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery');
    expect(
      await sottoTransaction(instance.database, (tx) =>
        readAssessmentSpeakingStatus(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          promptId: options.promptId,
          execution: sottoRequestExecution(options.request, options.admission),
        })
      )
    ).toEqual({ status: 'FAILED', requestId: admitted.id });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentSpeakingForDeletion(tx, { ...verification, fingerprint: 'a'.repeat(64) })
      )
    ).rejects.toThrow();
    await instance.database.speakingRecording.update({
      where: { id: admitted.id },
      data: { overallScore: 0.8 },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentSpeakingForDeletion(tx, verification)
      )
    ).rejects.toThrow();
  });

  it('does not retire a recording while its provider execution is active', async () => {
    const { instance, options, boundary } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const { settleAssessmentSpeakingFailure } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-failure');
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    let started!: () => void;
    let release!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    boundary.waitStt = async () => {
      started();
      await waiting;
    };
    const running = processAssessmentSpeaking(job, AbortSignal.timeout(30_000));
    try {
      await Promise.race([
        dispatched,
        running.then(() => {
          throw new Error('Grading ended before dispatch');
        }),
      ]);
      await sottoTransaction(instance.database, (tx) =>
        settleAssessmentSpeakingFailure(tx, admitted)
      );
      expect(
        await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
      ).toMatchObject({ status: 'PENDING' });
    } finally {
      release();
      await running;
    }
    expect(
      await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
    ).toMatchObject({ status: 'SCORED' });
  });

  it('recovers a saved grade after queue completion fails without repeating provider work', async () => {
    const { instance, options, boundary } = getContext();
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const { readAssessmentSpeakingStatus } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery');
    const readStatus = () =>
      sottoTransaction(instance.database, (tx) =>
        readAssessmentSpeakingStatus(tx, {
          classId: options.classId,
          assessmentId: options.assessmentId,
          promptId: options.promptId,
          execution: sottoRequestExecution(options.request, options.admission),
        })
      );
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    boundary.failCompletion = true;
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow(
      'Lost queue completion'
    );
    boundary.failCompletion = false;
    expect(
      await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
    ).toMatchObject({ status: 'SCORED' });
    expect(await readStatus()).toEqual({ status: 'UNRESOLVED', requestId: admitted.id });
    await processAssessmentSpeaking(job, AbortSignal.timeout(30_000));
    expect(await readStatus()).toEqual({ status: 'COMPLETED', requestId: admitted.id });
    expect(boundary.sttDispatches).toBe(1);
    expect(boundary.gradeDispatches).toBe(1);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(admitted.operationId)
    );
    expect(record?.complete).toBe(true);
  });
}
