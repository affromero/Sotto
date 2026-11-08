// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSnapshotFixture } from './snapshot-cases/fixture';
import { registerSnapshotAudioCases } from './snapshot-cases/audio';
import { registerSnapshotReservationCases } from './snapshot-cases/reservation';
import { registerSnapshotLockingCases } from './snapshot-cases/locking';
import { randomUUID } from 'node:crypto';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureAssessmentCandidate } from '@/lib/learning/classes/material/assessment-snapshot';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { authorizedLearnerExecution } from '../../../helpers/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

describe.skipIf(!process.env.SIDEDOOR_TEST_DATABASE_URL)('stored assessment candidate', () => {
  let instance: SharedTestInstance;
  let ownerId: string;
  let ownerToken: string;
  let classId: string;
  let courseId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('assessment_snapshot');
  }, 120_000);
  afterAll(async () => {
    await instance?.close();
  });
  beforeEach(async () => {
    const identity = await instance.reset();
    ownerId = identity.ownerId;
    ownerToken = identity.ownerToken;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'snapshot-test' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'snapshot-test',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Greet',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
      update: {},
    });
    const course = await instance.database.course.create({
      data: { userId: ownerId, curriculumId: curriculum.id, nativeLang: 'es', targetLang: 'ru' },
    });
    courseId = course.id;
    classId = (
      await instance.database.courseClass.create({
        data: {
          courseId,
          lessonId: lesson.id,
          order: 1,
          status: 'IN_PROGRESS',
          adaptiveSeed: { teaching: sampleTeaching },
        },
      })
    ).id;
  });

  function fixture(
    withListening = false,
    withSpeaking = false,
    reserveAudio = true,
    materialVersion: 1 | 2 = 1
  ) {
    return createSnapshotFixture(
      { instance, ownerId, classId, courseId },
      withListening,
      withSpeaking,
      reserveAudio,
      materialVersion
    );
  }

  it('binds version 2 even when the assessment has no speaking section', async () => {
    const { capture, expected } = await fixture(false, false, true, 2);
    const candidate = await capture();
    expect(candidate).toMatchObject({ status: 'CAPTURED', material: { version: 2 } });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentCandidate(tx, authorizedLearnerExecution(ownerId), {
          ...expected,
          materialVersion: undefined,
        })
      )
    ).rejects.toThrow(/Assessment class or generation changed/);
  });

  it('captures stored private grading context and rejects stale class material', async () => {
    const { capture } = await fixture();
    const result = await capture();
    expect(result.status).toBe('CAPTURED');
    if (result.status !== 'CAPTURED') throw new Error('candidate fixture');
    const writing = result.material.sections.find((section) => section.skill === 'WRITING');
    expect(writing?.items[0]).toMatchObject({
      privateGuidance: 'Private guidance',
      privateIdeas: ['Private idea'],
      privateRubric: 'Criteria',
    });
    await instance.database.classSection.updateMany({
      where: { classId, skill: 'GRAMMAR' },
      data: { seed: 'changed' },
    });
    await expect(capture()).rejects.toThrow();
  });

  it('preserves the sealed original and its locator until the class is deleted', async () => {
    const { saved } = await fixture(false, true);
    const prompt = await instance.database.speakingPrompt.findFirstOrThrow({
      where: { assessmentSection: { assessmentId: saved.id } },
    });
    await instance.database.speakingPrompt.update({
      where: { id: prompt.id },
      data: { referenceTtsUrl: '/reference.wav' },
    });
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: {
        status: 'READY',
        reviewOperationId: 'fixture-review',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceTtsUrl: '/changed.wav' },
      })
    ).rejects.toThrow('Sealed assessment material cannot change');
    await expect(
      instance.database.assessmentSpeakingReference.delete({ where: { promptId: prompt.id } })
    ).rejects.toThrow('Sealed assessment speaking locator cannot be removed');
    await instance.database.courseClass.delete({ where: { id: classId } });
    expect(
      await instance.database.assessmentSpeakingReference.findUnique({
        where: { promptId: prompt.id },
      })
    ).toBeNull();
  });

  it('ignores obsolete repairs for reviewed base teaching and rejects a replaced teaching receipt', async () => {
    const { capture } = await fixture();
    const content = {
      title: 'Pedir una bebida',
      explanation: 'Usa esta fórmula para pedir algo.',
      examples: [
        { target: 'Вода, пожалуйста', meaning: 'Agua, por favor', explanation: 'Una petición.' },
      ],
      directions: {
        guided: 'Pide una bebida.',
        tasks: [
          {
            sectionId: 'section',
            taskId: 'task',
            kind: 'question' as const,
            instruction: 'Elige una respuesta.',
          },
        ],
      },
    };
    const addendum = { version: 1 as const, sourceHash: 'a'.repeat(64), content };
    const save = (value: unknown) =>
      instance.database.courseClass.update({
        where: { id: classId },
        data: {
          adaptiveSeed: {
            teaching: sampleTeaching,
            prerequisiteAddendum: value,
          } as Prisma.InputJsonValue,
        },
      });
    const first = await capture();
    await save(addendum);
    expect(await capture()).toEqual(first);
    await save({
      ...addendum,
      acknowledgment: {
        userId: ownerId,
        sourceHash: addendum.sourceHash,
        contentHash: 'b'.repeat(64),
        receiptId: randomUUID(),
      },
    });
    expect(await capture()).toEqual(first);
    await save({ version: 1, sourceHash: 'invalid', content });
    expect(await capture()).toEqual(first);
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const gate = cls.prerequisiteGate as Prisma.JsonObject;
    const newReceiptId = randomUUID();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          ...gate,
          receiptId: newReceiptId,
          acknowledgment: {
            userId: ownerId,
            receiptId: newReceiptId,
            materialHash: gate.materialHash,
          },
        } as Prisma.InputJsonValue,
      },
    });
    await expect(capture()).rejects.toThrow('Assessment formative material changed');
  });

  it('requires Serializable isolation even when the assessment has no audio', async () => {
    const { expected } = await fixture();
    await expect(
      instance.database.$transaction((tx) =>
        captureAssessmentCandidate(tx, authorizedLearnerExecution(ownerId), expected)
      )
    ).rejects.toThrow('Assessment capture requires a Serializable transaction');
  });

  it('rejects a changed attempt, operation, ownership scope or threshold', async () => {
    const { saved, expected, capture } = await fixture();
    const run = (binding: typeof expected) =>
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentCandidate(tx, authorizedLearnerExecution(ownerId), binding)
      );
    await expect(run({ ...expected, classAttempt: 2 })).rejects.toThrow(
      /class or generation changed/
    );
    await expect(run({ ...expected, assessmentAttempt: 2 })).rejects.toThrow(
      /class or generation changed/
    );
    await expect(run({ ...expected, generationOperationId: 'other' })).rejects.toThrow(
      /class or generation changed/
    );
    const changedOwnership = structuredClone(expected.ownership);
    changedOwnership.scopes[0].generation += 1;
    await expect(run({ ...expected, ownership: changedOwnership })).rejects.toThrow(
      /ownership changed/
    );
    await instance.database.classAssessmentSection.updateMany({
      where: { assessmentId: saved.id, skill: 'WRITING' },
      data: { passThreshold: 0.9 },
    });
    await expect(capture()).rejects.toThrow(/threshold changed/);
  });

  it('does not capture an assessment before the class is published', async () => {
    const { capture } = await fixture();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'GENERATING' },
    });
    await expect(capture()).rejects.toThrow('Assessment class or generation changed');
  });

  it.each([
    'question-insert',
    'question-update',
    'question-delete',
    'section-insert',
    'section-update',
    'section-delete',
    'writing-insert',
    'writing-update',
    'writing-delete',
    'speaking-insert',
    'speaking-update',
    'speaking-delete',
  ] as const)(
    'rejects a stale snapshot after assessment material %s',
    async (change) => {
      const { saved, expected } = await fixture();
      const grammar = await instance.database.classAssessmentSection.findFirstOrThrow({
        where: { assessmentId: saved.id, skill: 'GRAMMAR' },
      });
      const question = await instance.database.classAssessmentQuestion.findFirstOrThrow({
        where: { assessmentId: saved.id, sectionId: grammar.id },
      });
      const writing = await instance.database.classAssessmentSection.findFirstOrThrow({
        where: { assessmentId: saved.id, skill: 'WRITING' },
      });
      const writingPrompt = await instance.database.writingPrompt.findFirstOrThrow({
        where: { assessmentSectionId: writing.id },
      });
      const speaking = await instance.database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'SPEAKING', passThreshold: 0.7 },
      });
      const speakingPrompt = await instance.database.speakingPrompt.create({
        data: {
          assessmentSectionId: speaking.id,
          assessmentRubric: 'Criteria',
          assessmentTaskMode: 'READ_ALOUD',
          order: 1,
          targetPhrase: 'Привет',
          translation: 'Hola',
        },
      });
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const execution = {
        ...authorizedLearnerExecution(ownerId),
        authorize: async (tx: Prisma.TransactionClient) => {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
          started();
          await gate;
          return { userId: ownerId };
        },
      };
      const capturing = instance.database.$transaction(
        (tx) => captureAssessmentCandidate(tx, execution, expected),
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      await began;
      try {
        switch (change) {
          case 'question-insert':
            await instance.database.classAssessmentQuestion.create({
              data: {
                assessmentId: saved.id,
                sectionId: grammar.id,
                order: 99,
                question: 'New?',
                options: ['a', 'b', 'c', 'd'],
                correctIndex: 0,
                explanation: 'Reason',
              },
            });
            break;
          case 'question-update':
            await instance.database.classAssessmentQuestion.update({
              where: { id: question.id },
              data: { explanation: 'Changed' },
            });
            break;
          case 'question-delete':
            await instance.database.classAssessmentQuestion.delete({ where: { id: question.id } });
            break;
          case 'section-insert':
            await instance.database.classAssessmentSection.create({
              data: { assessmentId: saved.id, skill: 'LISTENING', passThreshold: 0.7 },
            });
            break;
          case 'section-update':
            await instance.database.classAssessmentSection.update({
              where: { id: grammar.id },
              data: { passThreshold: 0.9 },
            });
            break;
          case 'section-delete':
            await instance.database.classAssessmentSection.delete({ where: { id: grammar.id } });
            break;
          case 'writing-insert':
            await instance.database.writingPrompt.create({
              data: {
                assessmentSectionId: writing.id,
                assessmentRubric: 'Criteria',
                order: 99,
                task: 'Write',
              },
            });
            break;
          case 'writing-update':
            await instance.database.writingPrompt.update({
              where: { id: writingPrompt.id },
              data: { task: 'Changed' },
            });
            break;
          case 'writing-delete':
            await instance.database.writingPrompt.delete({ where: { id: writingPrompt.id } });
            break;
          case 'speaking-insert':
            await instance.database.speakingPrompt.create({
              data: {
                assessmentSectionId: speaking.id,
                assessmentRubric: 'Criteria',
                assessmentTaskMode: 'READ_ALOUD',
                order: 99,
                targetPhrase: 'Да',
                translation: 'Sí',
              },
            });
            break;
          case 'speaking-update':
            await instance.database.speakingPrompt.update({
              where: { id: speakingPrompt.id },
              data: { translation: 'Buenos días' },
            });
            break;
          case 'speaking-delete':
            await instance.database.speakingPrompt.delete({ where: { id: speakingPrompt.id } });
            break;
        }
      } finally {
        release();
      }
      const conflict = await capturing.then(
        () => null,
        (error: unknown) => error
      );
      expect(isSerializationConflict(conflict)).toBe(true);
    },
    20000
  );

  it('rejects noncanonical private material instead of hashing different grader inputs', async () => {
    const { saved, capture } = await fixture();
    await instance.database.writingPrompt.updateMany({
      where: { assessmentSection: { assessmentId: saved.id } },
      data: { task: '  changed  ' },
    });
    await expect(capture()).rejects.toThrow(/not canonical/);
  });

  it('rejects an exact formative task with a new assessment ID', async () => {
    const { saved, capture } = await fixture();
    const question = await instance.database.classAssessmentQuestion.findFirstOrThrow({
      where: { assessmentId: saved.id, section: { skill: 'GRAMMAR' } },
    });
    await instance.database.classAssessmentQuestion.update({
      where: { id: question.id },
      data: { question: 'Formative question', options: ['d', 'c', 'b', 'a'] },
    });
    await expect(capture()).rejects.toThrow(/must differ/);
  });

  registerSnapshotLockingCases(() => ({
    instance,
    ownerId,
    ownerToken,
    classId,
    courseId,
    fixture,
  }));

  registerSnapshotReservationCases(() => ({
    instance,
    ownerId,
    ownerToken,
    classId,
    courseId,
    fixture,
  }));

  registerSnapshotAudioCases(() => ({ instance, ownerId, ownerToken, classId, courseId, fixture }));
});
