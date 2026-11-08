import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createSkillRequirements } from '@sotto/shared';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { captureAssessmentGenerationSource } from '@/lib/learning/classes/material/assessment-source';
import { admitLearnerAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import { readAssessmentStatus } from '@/lib/learning/classes/lifecycle/assessment-status';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';

import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

interface AdmissionContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
}

export function registerLearnerAssessmentAdmissionCase(getContext: () => AdmissionContext) {
  it('admits one learner assessment only after practice is complete', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const materialHash = await sottoTransaction(instance.database, (tx) =>
      initialA1MaterialHash(tx, classId, identity.ownerId)
    );
    const receiptId = randomUUID();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          version: 1,
          receiptId,
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          attempt: cls.attempt,
          materialHash,
          acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
        },
      },
    });
    const request = () => ({
      id: randomUUID(),
      revision: randomUUID(),
      assessmentId: randomUUID(),
      classId,
      classAttempt: cls.attempt,
      assessmentAttempt: 1,
      expiresAt: Date.now() + 120_000,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      execution: authorizedLearnerExecution(identity.ownerId),
    });
    expect(
      await sottoTransaction(instance.database, (tx) =>
        readAssessmentStatus(tx, classId, authorizedLearnerExecution(identity.ownerId))
      )
    ).toEqual({ status: 'PRACTICE_REQUIRED', classAttempt: cls.attempt });
    await expect(
      sottoTransaction(instance.database, (tx) => admitLearnerAssessmentWork(tx, request()))
    ).rejects.toThrow('practice');
    expect(await instance.database.classAssessment.count({ where: { classId } })).toBe(0);
    const questions = await instance.database.lessonQuestion.findMany({
      where: { section: { classId } },
    });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { learnerAnswers: Object.fromEntries(questions.map((question) => [question.id, 0])) },
    });
    const prompts = await instance.database.writingPrompt.findMany({
      where: { section: { classId } },
    });
    for (const prompt of prompts)
      await instance.database.writingResponse.create({
        data: {
          promptId: prompt.id,
          sectionId: prompt.sectionId,
          userId: identity.ownerId,
          text: 'Una respuesta',
          overallScore: 0.1,
          corrections: [],
          feedback: 'Sigue practicando.',
        },
      });
    const malformed = questions.find((question) => question.skill === 'GRAMMAR')!;
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { options: ['duplicate', 'duplicate', 'third', 'fourth'] },
    });
    const { requireAssessmentPracticeComplete } =
      await import('@/lib/learning/classes/practice/assessment-practice');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireAssessmentPracticeComplete(tx, {
          classId,
          classAttempt: cls.attempt,
          userId: identity.ownerId,
        })
      )
    ).rejects.toThrow('grammar practice needs repair');
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { options: malformed.options as Prisma.InputJsonValue },
    });
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { skill: 'READING' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireAssessmentPracticeComplete(tx, {
          classId,
          classAttempt: cls.attempt,
          userId: identity.ownerId,
        })
      )
    ).rejects.toThrow('grammar practice needs repair');
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { skill: malformed.skill },
    });
    const savedOptions = malformed.options as string[];
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { options: savedOptions.slice(0, 2) },
    });
    const legacyHash = await sottoTransaction(instance.database, (tx) =>
      initialA1MaterialHash(tx, classId, identity.ownerId)
    );
    const gateFor = (hash: string) => ({
      version: 1,
      receiptId,
      classId,
      courseId: cls.courseId,
      userId: identity.ownerId,
      attempt: cls.attempt,
      materialHash: hash,
      acknowledgment: { userId: identity.ownerId, receiptId, materialHash: hash },
    });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { prerequisiteGate: gateFor(legacyHash) },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireAssessmentPracticeComplete(tx, {
          classId,
          classAttempt: cls.attempt,
          userId: identity.ownerId,
        })
      )
    ).resolves.toBeUndefined();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        readAssessmentStatus(tx, classId, authorizedLearnerExecution(identity.ownerId))
      )
    ).resolves.toMatchObject({ status: 'AVAILABLE', classAttempt: cls.attempt });
    const { GET: getAssessmentStatus } =
      await import('@/app/api/v1/classes/[classId]/assessment/status/route');
    const statusResponse = await getAssessmentStatus(
      new NextRequest(`http://localhost/api/v1/classes/${classId}/assessment/status`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      { params: Promise.resolve({ classId }) }
    );
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ status: 'AVAILABLE' });
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { correctIndex: 3 },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireAssessmentPracticeComplete(tx, {
          classId,
          classAttempt: cls.attempt,
          userId: identity.ownerId,
        })
      )
    ).rejects.toThrow('grammar practice needs repair');
    await instance.database.lessonQuestion.update({
      where: { id: malformed.id },
      data: { options: savedOptions, correctIndex: malformed.correctIndex },
    });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { prerequisiteGate: gateFor(materialHash) },
    });
    let startStale!: () => void;
    let releaseStale!: () => void;
    const staleReady = new Promise<void>((resolve) => {
      startStale = resolve;
    });
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const stale = instance.database
      .$transaction(
        async (tx) => {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId } });
          startStale();
          await staleGate;
          return admitLearnerAssessmentWork(tx, request());
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      )
      .then(
        () => null,
        (error: unknown) => error
      );
    await staleReady;
    let pending;
    try {
      const prompt = prompts[0]!;
      pending = await instance.database.writingResponse.create({
        data: {
          promptId: prompt.id,
          sectionId: prompt.sectionId,
          userId: identity.ownerId,
          text: 'Otra respuesta',
          createdAt: new Date(Date.now() + 1000),
        },
      });
    } finally {
      releaseStale();
    }
    expect(isSerializationConflict(await stale)).toBe(true);
    await expect(
      sottoTransaction(instance.database, (tx) => admitLearnerAssessmentWork(tx, request()))
    ).rejects.toThrow('writing practice');
    expect(await instance.database.classAssessment.count({ where: { classId } })).toBe(0);
    await instance.database.writingResponse.delete({ where: { id: pending.id } });
    expect(
      await sottoTransaction(instance.database, (tx) =>
        readAssessmentStatus(tx, classId, authorizedLearnerExecution(identity.ownerId))
      )
    ).toEqual({
      status: 'AVAILABLE',
      classAttempt: cls.attempt,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const [first, second] = await Promise.all([
      sottoTransaction(instance.database, (tx) => admitLearnerAssessmentWork(tx, request())),
      sottoTransaction(instance.database, (tx) => admitLearnerAssessmentWork(tx, request())),
    ]);
    expect(second.job.id).toBe(first.job.id);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(await instance.database.classAssessment.count({ where: { classId } })).toBe(1);
    expect(
      await sottoTransaction(instance.database, (tx) =>
        readAssessmentStatus(tx, classId, authorizedLearnerExecution(identity.ownerId))
      )
    ).toEqual({
      status: 'PENDING',
      classAttempt: cls.attempt,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const { fence } = assessmentWorkSchema.parse(first.job.payload);
    const classScope = fence.ownership.scopes.find(
      (scope) => scope.subjectId === `class:${classId}`
    );
    if (!classScope) throw new Error('Assessment class scope missing');
    await withSottoJobExecution({
      database: instance.database,
      parentId: first.job.id,
      fingerprint: first.fingerprint,
      signal: new AbortController().signal,
      capabilityScope: classScope,
      isCleanupFailure: () => false,
      validate: async () => true,
      run: async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 240_000);
        try {
          expect(
            await sottoTransaction(instance.database, (tx) =>
              readAssessmentStatus(tx, classId, authorizedLearnerExecution(identity.ownerId))
            )
          ).toEqual({
            status: 'PENDING',
            classAttempt: cls.attempt,
            revision: expect.stringMatching(/^[a-f0-9]{64}$/),
          });
        } finally {
          clock.mockRestore();
        }
      },
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 240_000);
    try {
      expect(
        await sottoTransaction(instance.database, (tx) =>
          readAssessmentStatus(tx, classId, authorizedLearnerExecution(identity.ownerId))
        )
      ).toEqual({ status: 'UNRESOLVED', classAttempt: cls.attempt });
    } finally {
      clock.mockRestore();
    }
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(first.job.id))
    ).toMatchObject({ status: 'pending', fingerprint: first.fingerprint });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        readAssessmentStatus(tx, classId, authorizedLearnerExecution(randomUUID()))
      )
    ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearnerAssessmentWork(tx, {
          ...request(),
          execution: authorizedLearnerExecution(randomUUID()),
        })
      )
    ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearnerAssessmentWork(tx, {
          ...request(),
          selection: { ...request().selection, model: 'other' },
        })
      )
    ).rejects.toThrow();
  });
}

export function registerUnavailableAssessmentCase(getContext: () => AdmissionContext) {
  it('reports a conflict when the class does not require an initial assessment', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'es',
          targetLang: 'ru',
          level: 'A2',
          ttsProvider: 'local',
          sttProvider: 'local',
        }),
      },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentGenerationSource(tx, authorizedLearnerExecution(identity.ownerId), {
          classId,
          classAttempt: cls.attempt,
        })
      )
    ).rejects.toMatchObject({
      name: 'AssessmentSourceConflict',
      message: 'This class does not require an initial assessment.',
    });
  });
}
