import { randomUUID, createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { regenerateCurrentClass } from '@/lib/class-service';
import { requestClassPreparation, classPreparationStore } from '@/lib/classes/preparation';
import {
  repairClassReadingMemory,
  assertRepairQuizPreserved,
} from '@/lib/learning/classes/formative/class-repair';
import { grammarRepairSourceHash } from '@/lib/classes/repair/grammar-repair-source';
import {
  assertClassGeneration,
  settleClassGenerationFailure,
} from '@/lib/learning/classes/formative/class-generation-state';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import type { createRepairTarget } from './repair-target';

export function registerRepairConcurrencyCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    courseId: string;
    execution: SottoProviderExecution;
    repairTarget: () => ReturnType<typeof createRepairTarget>;
  }
) {
  it('serializes a linked answer writer behind the class publication lock', async () => {
    const { instance, identity, courseId, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: cls.lessonId, order: 2, status: 'IN_PROGRESS' },
    });
    const submission = await instance.database.classSubmission.create({
      data: { classId: other.id, userId: identity.ownerId },
    });
    let locked!: () => void;
    let release!: () => void;
    let reportPid!: (pid: number) => void;
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pidReady = new Promise<number>((resolve) => {
      reportPid = resolve;
    });
    const reader = instance.database.$transaction(
      async (database) => {
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
        locked();
        await gate;
        return grammarRepairSourceHash(database, cls.id, 8);
      },
      { isolationLevel: 'Serializable', timeout: 15_000 }
    );
    await lockReady;
    const writer = instance.database.$transaction(
      async (database) => {
        const [{ pid }] = await database.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        reportPid(pid!);
        await database.sectionAnswer.create({
          data: {
            submissionId: submission.id,
            sectionId: 'unrelated-section',
            questionId: grammar.questions[0]!.id,
            selectedIndex: 0,
            isCorrect: true,
          },
        });
      },
      { timeout: 15_000 }
    );
    const pid = await pidReady;
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
        const [{ waiting }] = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS waiting`;
        blocked = waiting;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    expect(blocked).toBe(true);
    expect(await reader).toMatch(/^[a-f0-9]{64}$/);
    await writer;
    expect(
      await instance.database.sectionAnswer.count({ where: { submissionId: submission.id } })
    ).toBe(1);
  });

  it('fences a stale class snapshot when a submission is reassigned to the class', async () => {
    const { instance, identity, courseId, repairTarget } = getContext();
    const { cls } = await repairTarget();
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: cls.lessonId, order: 2, status: 'IN_PROGRESS' },
    });
    const submission = await instance.database.classSubmission.create({
      data: { classId: other.id, userId: identity.ownerId },
    });
    let started!: () => void;
    let proceed!: () => void;
    const snapshot = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const reader = instance.database.$transaction(
      async (database) => {
        await database.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
        started();
        await gate;
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
      },
      { isolationLevel: 'Serializable' }
    );
    await snapshot;
    try {
      await instance.database.classSubmission.update({
        where: { id: submission.id },
        data: { classId: cls.id },
      });
    } finally {
      proceed();
    }
    const failure: unknown = await reader.then(
      () => null,
      (error: unknown) => error
    );
    expect(isSerializationConflict(failure)).toBe(true);
    expect(
      await instance.database.classSubmission.findUniqueOrThrow({ where: { id: submission.id } })
    ).toMatchObject({ classId: cls.id });
  });

  it.each(['question', 'vocabulary', 'section'] as const)(
    'does not overwrite changed reading material during memory repair (%s)',
    async (changed) => {
      const { instance, execution, repairTarget } = getContext();
      const { cls, requirements } = await repairTarget();
      const passageText = 'Mia sagt Hallo.';
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'READING',
          seed: 'saved',
          spec: {},
          status: 'READY',
          questions: {
            create: {
              order: 1,
              skill: 'READING',
              question: 'What does Hallo mean?',
              options: ['hello', 'goodbye'],
              correctIndex: 0,
              explanation: 'Mia says Hallo.',
              passageText,
            },
          },
        },
        include: { questions: true },
      });
      const vocabulary = {
        passageText,
        sourceHash: createHash('sha256').update(passageText).digest('hex'),
        words: [
          {
            lemma: 'Hallo',
            gloss: 'hello',
            pos: 'expression',
            sourceForm: 'Hallo',
            questionIds: [section.questions[0]!.id],
          },
        ],
      };
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { status: 'GENERATING', readingVocabulary: vocabulary },
      });
      const material = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
        include: {
          course: true,
          lesson: true,
          sections: {
            include: {
              questions: true,
              prompts: true,
              writingPrompts: true,
              episode: { include: { script: true } },
            },
          },
        },
      });
      if (changed === 'question')
        await instance.database.lessonQuestion.update({
          where: { id: section.questions[0]!.id },
          data: { question: 'A revised question?' },
        });
      if (changed === 'section')
        await instance.database.classSection.update({
          where: { id: section.id },
          data: { withdrawn: true },
        });
      if (changed === 'vocabulary')
        await instance.database.courseClass.update({
          where: { id: cls.id },
          data: {
            readingVocabulary: {
              ...vocabulary,
              words: [{ ...vocabulary.words[0]!, gloss: 'greeting' }],
            },
          },
        });
      const before = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      await expect(
        repairClassReadingMemory(material, requirements, execution, cls.attempt)
      ).rejects.toThrow('The reading material changed during repair.');
      const after = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(after.readingVocabulary).toEqual(before.readingVocabulary);
    }
  );

  it.each([
    ['Hallo', 'Tschüss'],
    ['Hallo', 'Tschüss', 'Morgen'],
  ])(
    'does not replace an answered saved quiz with choices %j during repair',
    async (...options) => {
      const { instance, courseId, execution, repairTarget } = getContext();
      const { cls, grammar } = await repairTarget();
      const question = grammar.questions[0]!;
      await instance.database.lessonQuestion.update({
        where: { id: question.id },
        data: { options },
      });
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { learnerAnswers: { [question.id]: 1 } },
      });
      const admitted = await requestClassPreparation(courseId, execution, {
        intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
      });
      expect(admitted.intent?.skills).not.toContain('GRAMMAR');
      expect(admitted.intent?.retainedQuiz?.sections).toEqual([
        expect.objectContaining({ sectionId: grammar.id }),
      ]);
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({
        status: 'GENERATING',
        attempt: 8,
        learnerAnswers: { [question.id]: 1 },
      });
      expect(
        await instance.database.lessonQuestion.findUniqueOrThrow({ where: { id: question.id } })
      ).toMatchObject({
        options,
        correctIndex: 0,
      });
      expect((await classPreparationStore(instance.database, courseId).read())?.id).toBe(
        admitted.id
      );
    }
  );

  it('leaves a direct repair unclaimed when its saved quiz cannot be safely replaced', async () => {
    const { instance, identity, execution, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    await instance.database.lessonQuestion.update({
      where: { id: grammar.questions[0]!.id },
      data: { options: ['Hallo', 'Tschüss'] },
    });
    await expect(
      regenerateCurrentClass(cls.id, identity.ownerId, execution, undefined, { repair: true })
    ).rejects.toThrow('saved quiz material that cannot be safely replaced');
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      status: 'IN_PROGRESS',
      attempt: cls.attempt,
      learnerAnswers: cls.learnerAnswers,
    });
  });

  it('does not claim a direct reading repair without durable staging authority', async () => {
    const { instance, identity, execution, repairTarget } = getContext();
    const { cls } = await repairTarget();
    await expect(
      regenerateCurrentClass(cls.id, identity.ownerId, execution, undefined, { repair: true })
    ).rejects.toThrow('Reading repair requires a durable staging operation.');
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      status: 'IN_PROGRESS',
      attempt: cls.attempt,
      learnerAnswers: cls.learnerAnswers,
    });
  });

  it('rejects a previously admitted repair before it creates a replacement section', async () => {
    const { instance, identity, execution, repairTarget } = getContext();
    const { cls, grammar, requirements } = await repairTarget();
    const question = grammar.questions[0]!;
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { options: ['Hallo', 'Tschüss'] },
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING', attempt: 8, learnerAnswers: { [question.id]: 1 } },
    });
    await expect(
      regenerateCurrentClass(
        cls.id,
        identity.ownerId,
        {
          ...execution,
          grammarRepairSourceHash: 'a'.repeat(64),
          stageClassGrammar: async () => {
            throw new Error('Unexpected stage');
          },
        },
        undefined,
        {
          repair: true,
          skills: ['GRAMMAR'],
          requirements,
          attempt: 8,
        }
      )
    ).rejects.toThrow('saved quiz material that cannot be safely replaced');
    expect(
      await instance.database.classSection.count({ where: { classId: cls.id, attempt: 8 } })
    ).toBe(0);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      learnerAnswers: { [question.id]: 1 },
    });
  });

  it('does not claim direct grammar repair without its admitted source receipt', async () => {
    const { instance, identity, execution, repairTarget } = getContext();
    const { cls, requirements } = await repairTarget();
    const before = await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
    await expect(
      regenerateCurrentClass(
        cls.id,
        identity.ownerId,
        {
          ...execution,
          stageClassGrammar: async () => {
            throw new Error('Unexpected stage');
          },
        },
        undefined,
        { repair: true, skills: ['GRAMMAR'], requirements }
      )
    ).rejects.toThrow('Grammar repair requires a durable staging operation.');
    const after = await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
    expect(after).toMatchObject({
      status: before.status,
      attempt: before.attempt,
      progressRevision: before.progressRevision,
    });
  });

  it('allows only the selected saved quiz as a retry and rejects partial attempts', async () => {
    const { instance, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    await instance.database.lessonQuestion.update({
      where: { id: grammar.questions[0]!.id },
      data: { options: ['Hallo', 'Tschüss'] },
    });
    const check = (retry?: { sectionId: string; skill: 'GRAMMAR' | 'READING' }) =>
      sottoTransaction(instance.database, async (database) => {
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
        return assertRepairQuizPreserved(database, cls.id, 8, ['GRAMMAR'], retry);
      });
    await expect(check({ sectionId: grammar.id, skill: 'GRAMMAR' })).resolves.toBeUndefined();
    await expect(check({ sectionId: grammar.id, skill: 'READING' })).rejects.toThrow(/saved quiz/);
    await instance.database.classSection.create({
      data: { classId: cls.id, skill: 'GRAMMAR', attempt: 8, seed: 'partial', spec: {} },
    });
    await expect(check({ sectionId: grammar.id, skill: 'GRAMMAR' })).rejects.toThrow(
      /already exists/
    );
  });

  it('selects repair skills from material committed before the class lock is acquired', async () => {
    const { instance, courseId, execution, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    let releaseWriter!: () => void;
    let writerReady!: (pid: number) => void;
    let writerFailed!: (error: unknown) => void;
    const ready = new Promise<number>((resolve, reject) => {
      writerReady = resolve;
      writerFailed = reject;
    });
    const release = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writer = instance.database.$transaction(async (database) => {
      const [backend] = await database.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pg_backend_pid() AS pid`;
      await database.lessonQuestion.update({
        where: { id: grammar.questions[0]!.id },
        data: { options: ['only one'] },
      });
      writerReady(backend!.pid);
      await release;
    });
    void writer.catch(writerFailed);
    const writerPid = await ready;
    const admission = requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND ${writerPid} = ANY(pg_blocking_pids(pid))
              AND query LIKE '%CourseClass%FOR UPDATE%'
          ) AS waiting
        `;
        if (waiting[0]?.waiting) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      releaseWriter();
      await writer;
    }
    expect((await admission).intent?.skills).toContain('GRAMMAR');
  });

  it('does not wait on another learner’s locked class when repair is requested', async () => {
    const { instance, identity, courseId, execution, repairTarget } = getContext();
    const { cls } = await repairTarget();
    const owner = await instance.database.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    const existingCourse = await instance.database.course.findUniqueOrThrow({
      where: { id: courseId },
    });
    const otherCourse = await instance.database.course.create({
      data: {
        userId: owner.id,
        curriculumId: existingCourse.curriculumId,
        nativeLang: 'en',
        targetLang: 'de',
      },
    });
    const otherClass = await instance.database.courseClass.create({
      data: { courseId: otherCourse.id, lessonId: cls.lessonId, order: 1, status: 'AVAILABLE' },
    });
    let release!: () => void;
    let locked!: () => void;
    let failed!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      locked = resolve;
      failed = reject;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = instance.database.$transaction(async (database) => {
      await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${otherClass.id} FOR UPDATE`;
      locked();
      await hold;
    });
    void writer.catch(failed);
    await ready;
    const admission = requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: otherClass.id, expectedAttempt: otherClass.attempt },
    }).then(
      () => ({ kind: 'accepted' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error })
    );
    const generationCheck = sottoTransaction(instance.database, (database) =>
      assertClassGeneration(database, otherClass.id, otherClass.attempt, identity.ownerId)
    ).then(
      () => ({ kind: 'accepted' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error })
    );
    const settlement = settleClassGenerationFailure(
      otherClass.id,
      otherClass.attempt,
      identity.ownerId
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.all([admission, generationCheck, settlement]),
        new Promise<{ kind: 'blocked' }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'blocked' }), 2000);
        }),
      ]);
      if (!Array.isArray(result)) throw new Error('A different learner’s class was locked');
      const [admissionResult, generationResult, settled] = result;
      expect(admissionResult.kind).toBe('rejected');
      if (admissionResult.kind !== 'rejected')
        throw new Error('Expected a rejected repair request');
      expect(admissionResult.error).toBeInstanceOf(Error);
      expect((admissionResult.error as Error).name).toBe('PreparationConflictError');
      expect((admissionResult.error as Error).message).toMatch(/Class not found/);
      expect(generationResult.kind).toBe('rejected');
      if (generationResult.kind !== 'rejected') throw new Error('Expected a rejected generation');
      expect((generationResult.error as Error).name).toBe('ClassGenerationCancelledError');
      expect(settled).toBe(false);
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await writer;
      await admission;
      await generationCheck;
      await settlement;
    }
  });

  it('replays a completed repair after its acknowledgement was lost without claiming new paid work', async () => {
    const { instance, courseId, execution, repairTarget } = getContext();
    const { cls } = await repairTarget();
    const input = {
      intent: { kind: 'REPAIR' as const, classId: cls.id, expectedAttempt: cls.attempt },
    };
    const admitted = await requestClassPreparation(courseId, execution, input);
    await classPreparationStore(instance.database, courseId).transact((current) => {
      if (!current) throw new Error('Missing operation');
      current.status = 'COMPLETED';
      current.result = 'created';
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'AVAILABLE' },
    });
    const replay = await requestClassPreparation(courseId, execution, input);
    expect(replay.id).toBe(admitted.id);
    expect(replay.status).toBe('COMPLETED');
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).attempt
    ).toBe(8);
  });
}
