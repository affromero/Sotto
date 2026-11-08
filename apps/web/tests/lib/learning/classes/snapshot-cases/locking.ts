import { expect, it } from 'vitest';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureAssessmentCandidate } from '@/lib/learning/classes/material/assessment-snapshot';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type { SnapshotContext } from './context';

export function registerSnapshotLockingCases(getContext: () => SnapshotContext) {
  it('holds formative rows and insertion parents until the capture transaction finishes', async () => {
    const { instance, ownerId, classId, fixture } = getContext();
    const { expected, capture } = await fixture();
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId, skill: 'GRAMMAR' } },
    });
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const transaction = instance.database.$transaction(
      async (tx) => {
        const result = await captureAssessmentCandidate(
          tx,
          authorizedLearnerExecution(ownerId),
          expected
        );
        captured();
        await gate;
        return result;
      },
      { isolationLevel: 'Serializable' }
    );
    await acquired;
    const update = instance.database.lessonQuestion
      .update({ where: { id: question.id }, data: { question: 'Changed after capture' } })
      .then(() => 'updated');
    const insertion = instance.database.lessonQuestion
      .create({
        data: {
          sectionId: question.sectionId,
          order: 2,
          skill: 'GRAMMAR',
          question: 'Another task',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Reason',
        },
      })
      .then(() => 'inserted');
    const addendum = instance.database.courseClass
      .update({
        where: { id: classId },
        data: {
          adaptiveSeed: {
            prerequisiteAddendum: {
              version: 1,
              sourceHash: 'a'.repeat(64),
              content: {
                title: 'Pedir',
                explanation: 'Usa la fórmula.',
                examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
                directions: {
                  guided: 'Pide algo.',
                  tasks: [
                    {
                      sectionId: question.sectionId,
                      taskId: question.id,
                      kind: 'question',
                      instruction: 'Elige una respuesta.',
                    },
                  ],
                },
              },
            },
          },
        },
      })
      .then(() => 'updated');
    try {
      expect(
        await Promise.race([
          update,
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
      expect(
        await Promise.race([
          insertion,
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
      expect(
        await Promise.race([
          addendum,
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
    } finally {
      release();
    }
    expect((await transaction).status).toBe('CAPTURED');
    expect(await update).toBe('updated');
    expect(await insertion).toBe('inserted');
    expect(await addendum).toBe('updated');
    await expect(capture()).rejects.toThrow();
  });

  it('rejects a stale snapshot when a question commits before the class lock', async () => {
    const { instance, ownerId, classId, fixture } = getContext();
    const { expected, capture } = await fixture();
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId, skill: 'GRAMMAR' } },
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execution = {
      ...authorizedLearnerExecution(ownerId),
      authorize: async (database: Prisma.TransactionClient) => {
        await database.courseClass.findUniqueOrThrow({
          where: { id: classId },
          select: { id: true },
        });
        started();
        await gate;
        return { userId: ownerId };
      },
    };
    const capturing = instance.database.$transaction(
      (tx) => captureAssessmentCandidate(tx, execution, expected),
      { isolationLevel: 'Serializable', timeout: 15000 }
    );
    await startedPromise;
    try {
      await instance.database.lessonQuestion.create({
        data: {
          sectionId: question.sectionId,
          order: 2,
          skill: 'GRAMMAR',
          question: 'A new task',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Reason',
        },
      });
    } finally {
      release();
    }
    const conflict = await capturing.then(
      () => null,
      (error: unknown) => error
    );
    expect(isSerializationConflict(conflict)).toBe(true);
    await expect(capture()).rejects.toThrow();
  }, 20000);

  it.each(['course', 'lesson', 'formative script'] as const)(
    'rejects a stale snapshot when the %s changes before its lock',
    async (source) => {
      const { instance, ownerId, classId, courseId, fixture } = getContext();
      const { expected } = await fixture(true);
      const cls = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: classId },
      });
      const section = await instance.database.classSection.findFirstOrThrow({
        where: { classId, skill: 'LISTENING' },
      });
      if (!section.episodeId) throw new Error('Missing formative listening episode');
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
        if (source === 'course')
          await instance.database.course.update({
            where: { id: courseId },
            data: { targetLang: 'fr' },
          });
        else if (source === 'lesson')
          await instance.database.lesson.update({
            where: { id: cls.lessonId },
            data: { title: 'Changed' },
          });
        else
          await instance.database.script.update({
            where: { episodeId: section.episodeId },
            data: { turns: [{ speaker: 'HOST', text: 'Пока' }] },
          });
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

  it('fences both assessments when a held-out question changes parent', async () => {
    const { instance, ownerId, classId, courseId, fixture } = getContext();
    const { saved } = await fixture();
    const targetAssessment = await instance.database.classAssessment.create({
      data: {
        classId,
        courseId,
        userId: ownerId,
        classAttempt: 2,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        generationOperationId: 'second-assessment-operation',
      },
    });
    const targetSection = await instance.database.classAssessmentSection.create({
      data: {
        assessmentId: targetAssessment.id,
        skill: 'GRAMMAR',
        passThreshold: 0.7,
      },
    });
    const question = await instance.database.classAssessmentQuestion.findFirstOrThrow({
      where: { assessmentId: saved.id, section: { skill: 'GRAMMAR' } },
    });
    let release!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const reader = (assessmentId: string, started: () => void) =>
      instance.database.$transaction(
        async (tx) => {
          await tx.classAssessment.findUniqueOrThrow({
            where: { id: assessmentId },
            select: { id: true },
          });
          started();
          await gate;
          await tx.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${assessmentId} FOR UPDATE`;
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
    const first = reader(saved.id, firstStarted);
    const second = reader(targetAssessment.id, secondStarted);
    await Promise.all([firstReady, secondReady]);
    try {
      await instance.database.classAssessmentQuestion.update({
        where: { id: question.id },
        data: {
          assessmentId: targetAssessment.id,
          sectionId: targetSection.id,
        },
      });
    } finally {
      release();
    }
    const errors = await Promise.all([
      first.then(
        () => null,
        (error: unknown) => error
      ),
      second.then(
        () => null,
        (error: unknown) => error
      ),
    ]);
    expect(errors.every(isSerializationConflict)).toBe(true);
  }, 20000);

  it('fences both classes when a formative question changes section', async () => {
    const { instance, ownerId, classId, courseId, fixture } = getContext();
    const { expected } = await fixture();
    const original = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
    });
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: original.lessonId, order: 2, status: 'IN_PROGRESS' },
    });
    const target = await instance.database.classSection.create({
      data: { classId: other.id, skill: 'GRAMMAR', seed: 'other', spec: {}, status: 'READY' },
    });
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId, skill: 'GRAMMAR' } },
    });
    let release!: () => void;
    let firstReady!: () => void;
    let secondReady!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = new Promise<void>((resolve) => {
      firstReady = resolve;
    });
    const second = new Promise<void>((resolve) => {
      secondReady = resolve;
    });
    const execution = {
      ...authorizedLearnerExecution(ownerId),
      authorize: async (tx: Prisma.TransactionClient) => {
        await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
        firstReady();
        await gate;
        return { userId: ownerId };
      },
    };
    const firstReader = instance.database.$transaction(
      (tx) => captureAssessmentCandidate(tx, execution, expected),
      { isolationLevel: 'Serializable', timeout: 15000 }
    );
    const secondReader = instance.database.$transaction(
      async (tx) => {
        await tx.courseClass.findUniqueOrThrow({ where: { id: other.id }, select: { id: true } });
        secondReady();
        await gate;
        await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${other.id} FOR UPDATE`;
      },
      { isolationLevel: 'Serializable', timeout: 15000 }
    );
    await Promise.all([first, second]);
    try {
      await instance.database.lessonQuestion.update({
        where: { id: question.id },
        data: { sectionId: target.id },
      });
    } finally {
      release();
    }
    const [firstError, secondError] = await Promise.all([
      firstReader.then(
        () => null,
        (error: unknown) => error
      ),
      secondReader.then(
        () => null,
        (error: unknown) => error
      ),
    ]);
    expect(isSerializationConflict(firstError)).toBe(true);
    expect(isSerializationConflict(secondError)).toBe(true);
  }, 20000);

  it.each(['update', 'delete'] as const)(
    'rejects a stale snapshot when a question %s commits before the class lock',
    async (change) => {
      const { instance, ownerId, classId, fixture } = getContext();
      const { expected } = await fixture();
      const question = await instance.database.lessonQuestion.findFirstOrThrow({
        where: { section: { classId, skill: 'GRAMMAR' } },
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
        if (change === 'update')
          await instance.database.lessonQuestion.update({
            where: { id: question.id },
            data: { question: 'Changed' },
          });
        else await instance.database.lessonQuestion.delete({ where: { id: question.id } });
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

  it('leaves the saved class usable when a question change is rolled back', async () => {
    const { instance, classId, fixture } = getContext();
    const { capture } = await fixture();
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId, skill: 'GRAMMAR' } },
    });
    await expect(
      instance.database.$transaction(async (tx) => {
        await tx.lessonQuestion.update({
          where: { id: question.id },
          data: { question: 'Uncommitted' },
        });
        throw new Error('cancel change');
      })
    ).rejects.toThrow('cancel change');
    expect((await capture()).status).toBe('CAPTURED');
  });

  it.each(['insert', 'update', 'delete'] as const)(
    'rejects a stale snapshot when a section %s commits before the class lock',
    async (change) => {
      const { instance, ownerId, classId, fixture } = getContext();
      const { expected } = await fixture();
      const section = await instance.database.classSection.findFirstOrThrow({
        where: { classId, skill: 'GRAMMAR' },
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
        if (change === 'insert')
          await instance.database.classSection.create({
            data: {
              classId,
              skill: 'GRAMMAR',
              attempt: 2,
              status: 'READY',
              seed: 'new',
              spec: {},
            },
          });
        else if (change === 'update')
          await instance.database.classSection.update({
            where: { id: section.id },
            data: { passThreshold: 0.9 },
          });
        else await instance.database.classSection.delete({ where: { id: section.id } });
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

  it.each(['SPEAKING', 'WRITING'] as const)(
    'fences a newly added formative %s prompt',
    async (skill) => {
      const { instance, classId, fixture } = getContext();
      await fixture();
      const section =
        skill === 'WRITING'
          ? await instance.database.classSection.findFirstOrThrow({ where: { classId, skill } })
          : await instance.database.classSection.create({
              data: { classId, skill, seed: 'speaking', spec: {}, status: 'READY' },
            });
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const reader = instance.database.$transaction(
        async (tx) => {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
          started();
          await gate;
          await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      await began;
      try {
        if (skill === 'WRITING')
          await instance.database.writingPrompt.create({
            data: { sectionId: section.id, order: 1, task: 'Write a request' },
          });
        else
          await instance.database.speakingPrompt.create({
            data: { sectionId: section.id, order: 1, targetPhrase: 'Привет', translation: 'Hola' },
          });
      } finally {
        release();
      }
      const conflict = await reader.then(
        () => null,
        (error: unknown) => error
      );
      expect(isSerializationConflict(conflict)).toBe(true);
    },
    20000
  );

  it('lets a section deletion finish after an overlapping capture releases its class lock', async () => {
    const { instance, ownerId, classId, fixture } = getContext();
    const { expected } = await fixture();
    const section = await instance.database.classSection.findFirstOrThrow({
      where: { classId, skill: 'GRAMMAR' },
    });
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const transaction = instance.database.$transaction(
      async (tx) => {
        const result = await captureAssessmentCandidate(
          tx,
          authorizedLearnerExecution(ownerId),
          expected
        );
        captured();
        await gate;
        return result;
      },
      { isolationLevel: 'Serializable', timeout: 15000 }
    );
    await ready;
    const deleting = instance.database.classSection.delete({ where: { id: section.id } });
    try {
      expect(
        await Promise.race([
          deleting.then(() => 'deleted'),
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
    } finally {
      release();
    }
    expect((await transaction).status).toBe('CAPTURED');
    expect((await deleting).id).toBe(section.id);
  }, 20000);

  it('does not invalidate a class snapshot for section score changes alone', async () => {
    const { instance, classId, fixture } = getContext();
    await fixture();
    const section = await instance.database.classSection.findFirstOrThrow({
      where: { classId, skill: 'GRAMMAR' },
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const reader = instance.database.$transaction(
      async (tx) => {
        await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
        started();
        await gate;
        await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
      },
      { isolationLevel: 'Serializable', timeout: 15000 }
    );
    await began;
    try {
      await instance.database.classSection.update({
        where: { id: section.id },
        data: { score: 0.5, passed: false },
      });
    } finally {
      release();
    }
    await expect(reader).resolves.toBeUndefined();
  }, 20000);

  it('serializes overlapping bulk question writes across classes without a lock-order deadlock', async () => {
    const { instance, classId, courseId, fixture } = getContext();
    await fixture();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const firstSection = await instance.database.classSection.findFirstOrThrow({
      where: { classId, skill: 'GRAMMAR' },
    });
    const otherClass = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: cls.lessonId,
        order: 2,
        status: 'IN_PROGRESS',
      },
    });
    const secondSection = await instance.database.classSection.create({
      data: {
        classId: otherClass.id,
        skill: 'GRAMMAR',
        seed: 'second',
        spec: {},
        status: 'READY',
      },
    });
    const question = (sectionId: string, order: number) => ({
      sectionId,
      order,
      skill: 'GRAMMAR' as const,
      question: `Question ${order}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      explanation: 'Reason',
    });
    await instance.database.lessonQuestion.createMany({
      data: [
        question(firstSection.id, 2),
        question(secondSection.id, 1),
        question(secondSection.id, 2),
      ],
    });
    const rows = await instance.database.lessonQuestion.findMany({
      where: { sectionId: { in: [firstSection.id, secondSection.id] } },
      select: { id: true, sectionId: true, order: true },
    });
    const ids = (order: number) => rows.filter((row) => row.order === order).map((row) => row.id);
    let release!: () => void;
    let firstDone!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstUpdated = new Promise<void>((resolve) => {
      firstDone = resolve;
    });
    const first = instance.database.$transaction(
      async (tx) => {
        await tx.lessonQuestion.updateMany({
          where: { id: { in: ids(1) } },
          data: { explanation: 'First batch' },
        });
        firstDone();
        await gate;
      },
      { timeout: 15000 }
    );
    await firstUpdated;
    const second = instance.database.lessonQuestion.updateMany({
      where: { id: { in: ids(2) } },
      data: { explanation: 'Second batch' },
    });
    try {
      expect(
        await Promise.race([
          second.then(() => 'done'),
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
    } finally {
      release();
    }
    await first;
    expect((await second).count).toBe(2);
  }, 20000);

  it('retries complete transactions when separate question writes deadlock across classes', async () => {
    const { instance, classId, courseId, fixture } = getContext();
    await fixture();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const firstQuestion = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId, skill: 'GRAMMAR' } },
    });
    const otherClass = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: cls.lessonId,
        order: 2,
        status: 'IN_PROGRESS',
      },
    });
    const section = await instance.database.classSection.create({
      data: {
        classId: otherClass.id,
        skill: 'GRAMMAR',
        seed: 'other',
        spec: {},
        status: 'READY',
      },
    });
    const secondQuestion = await instance.database.lessonQuestion.create({
      data: {
        sectionId: section.id,
        order: 1,
        skill: 'GRAMMAR',
        question: 'Another task',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'Reason',
      },
    });
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let release!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstAttempts = 0;
    let secondAttempts = 0;
    const write = (firstId: string, secondId: string, firstSide: boolean) =>
      sottoTransaction(
        instance.database,
        async (tx) => {
          const attempt = firstSide ? ++firstAttempts : ++secondAttempts;
          await tx.lessonQuestion.update({
            where: { id: firstId },
            data: { explanation: firstSide ? 'A' : 'B' },
          });
          if (attempt === 1) {
            if (firstSide) firstStarted();
            else secondStarted();
            await gate;
          }
          await tx.lessonQuestion.update({
            where: { id: secondId },
            data: { explanation: firstSide ? 'A' : 'B' },
          });
        },
        { timeoutMs: 15000 }
      );
    const first = write(firstQuestion.id, secondQuestion.id, true);
    const second = write(secondQuestion.id, firstQuestion.id, false);
    await Promise.all([firstReady, secondReady]);
    release();
    await Promise.all([first, second]);
    expect(firstAttempts + secondAttempts).toBeGreaterThan(2);
    const rows = await instance.database.lessonQuestion.findMany({
      where: { id: { in: [firstQuestion.id, secondQuestion.id] } },
      select: { explanation: true },
    });
    expect(new Set(rows.map((row) => row.explanation)).size).toBe(1);
  }, 30000);
}
