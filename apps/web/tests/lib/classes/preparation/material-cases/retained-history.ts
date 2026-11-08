import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { getClassForUser } from '@/lib/class-service';
import { requestClassPreparation } from '@/lib/classes/preparation';
import { requireStageGuard } from '@/lib/classes/staging/stage-guard';
import { requireRepairQuizFence } from '@/lib/learning/classes/formative/class-repair';
import { grammarRepairSourceHash } from '@/lib/classes/repair/grammar-repair-source';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import type { createRepairTarget } from './repair-target';

export function registerRetainedHistoryCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    courseId: string;
    execution: SottoProviderExecution;
    repairTarget: () => ReturnType<typeof createRepairTarget>;
  }
) {
  it('returns previous owned speaking attempts while keeping the current attempt active', async () => {
    const { instance, identity, courseId, repairTarget } = getContext();
    const { cls } = await repairTarget();
    const old = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        seed: 'old-speech',
        spec: {},
        status: 'READY',
        attempt: 1,
        prompts: { create: { order: 1, targetPhrase: 'Hallo', translation: 'Hello' } },
      },
      include: { prompts: true },
    });
    const active = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        seed: 'current-speech',
        spec: {},
        status: 'READY',
        attempt: 2,
        prompts: { create: { order: 1, targetPhrase: 'Guten Tag', translation: 'Good day' } },
      },
      include: { prompts: true },
    });
    const other = await instance.database.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    const foreignCourse = await instance.database.course.create({
      data: {
        userId: other.id,
        curriculumId: (
          await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
        ).curriculumId,
        nativeLang: 'en',
        targetLang: 'de',
      },
    });
    const foreignClass = await instance.database.courseClass.create({
      data: {
        courseId: foreignCourse.id,
        lessonId: cls.lessonId,
        order: 1,
        status: 'IN_PROGRESS',
      },
    });
    const foreignSection = await instance.database.classSection.create({
      data: {
        classId: foreignClass.id,
        skill: 'SPEAKING',
        seed: 'foreign',
        spec: {},
        status: 'READY',
        prompts: {
          create: { order: 1, targetPhrase: 'Foreign private prompt', translation: 'Private' },
        },
      },
      include: { prompts: true },
    });
    await instance.database.speakingRecording.createMany({
      data: [
        {
          id: 'historical-speech',
          promptId: old.prompts[0]!.id,
          sectionId: old.id,
          userId: identity.ownerId,
          audioUrl: 'old-audio',
          transcript: 'Hallo',
          feedback: 'Clear.',
          attempt: 1,
        },
        {
          id: 'older-current-speech',
          promptId: active.prompts[0]!.id,
          sectionId: active.id,
          userId: identity.ownerId,
          audioUrl: 'older-audio',
          transcript: 'First try',
          attempt: 2,
          createdAt: new Date('2020-01-01'),
        },
        {
          id: 'current-speech',
          promptId: active.prompts[0]!.id,
          sectionId: active.id,
          userId: identity.ownerId,
          audioUrl: 'current-audio',
          transcript: 'Second try',
          attempt: 2,
          createdAt: new Date('2021-01-01'),
        },
        {
          id: 'other-speech',
          promptId: old.prompts[0]!.id,
          sectionId: old.id,
          userId: other.id,
          audioUrl: 'other-audio',
          transcript: 'Private',
          attempt: 1,
        },
        {
          id: 'mislinked-speech',
          promptId: old.prompts[0]!.id,
          sectionId: active.id,
          userId: identity.ownerId,
          audioUrl: 'mislinked-audio',
          transcript: 'Mismatched',
          attempt: 1,
        },
        {
          id: 'detached-speech',
          promptId: foreignSection.prompts[0]!.id,
          sectionId: old.id,
          userId: identity.ownerId,
          audioUrl: 'detached-audio',
          transcript: 'Owned words',
          attempt: 1,
        },
      ],
    });
    const detail = await getClassForUser(cls.id, identity.ownerId, instance.database);
    expect(
      detail?.speakingHistory.flatMap((section) =>
        section.prompts.flatMap((prompt) => prompt.recordings.map((item) => item.id))
      )
    ).toEqual(['older-current-speech', 'historical-speech']);
    expect(detail?.speakingHistory[1]?.prompts[0]?.recordings[0]).toMatchObject({
      transcript: 'Hallo',
      feedback: 'Clear.',
    });
    expect(detail?.speakingHistoryUnlinked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mislinked-speech', transcript: 'Mismatched' }),
        expect.objectContaining({ id: 'detached-speech', transcript: 'Owned words' }),
      ])
    );
    expect(JSON.stringify(detail?.speakingHistoryUnlinked)).not.toContain('Foreign private prompt');
    expect(
      detail?.sections.find((section) => section.id === active.id)?.prompts[0]?.recordings[0]?.id
    ).toBe('current-speech');
    expect(await getClassForUser(cls.id, other.id, instance.database)).toBeNull();
  });

  it('returns prior writing and drafts without exposing withdrawn or current material as history', async () => {
    const { instance, identity, repairTarget } = getContext();
    const { cls, writing } = await repairTarget();
    const prompt = writing.writingPrompts[0]!;
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { writingDrafts: { [prompt.id]: 'A newer draft.', orphan: 'Recovered words.' } },
    });
    await instance.database.writingResponse.create({
      data: {
        promptId: prompt.id,
        sectionId: writing.id,
        userId: identity.ownerId,
        attempt: 2,
        text: 'A pending response.',
      },
    });
    const active = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'WRITING',
        seed: 'replacement',
        spec: {},
        status: 'READY',
        attempt: 3,
        writingPrompts: { create: { order: 1, task: 'Current task.' } },
      },
    });
    const otherUser = await instance.database.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    await instance.database.writingResponse.createMany({
      data: [
        {
          promptId: prompt.id,
          sectionId: writing.id,
          userId: otherUser.id,
          attempt: 2,
          text: 'Another learner response.',
        },
        {
          promptId: prompt.id,
          sectionId: active.id,
          userId: identity.ownerId,
          attempt: 2,
          text: 'A mismatched response.',
        },
        {
          promptId: prompt.id,
          sectionId: writing.id,
          userId: identity.ownerId,
          attempt: 1,
          text: 'A response from before attempt tracking.',
        },
      ],
    });
    const withdrawn = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'WRITING',
        seed: 'private-stage',
        spec: {},
        status: 'READY',
        attempt: 4,
        withdrawn: true,
        writingPrompts: { create: { order: 1, task: 'Private staged task.' } },
      },
      include: { writingPrompts: true },
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        writingDrafts: {
          [prompt.id]: 'A newer draft.',
          orphan: 'Recovered words.',
          [withdrawn.writingPrompts[0]!.id]: 'A withdrawn draft.',
        },
      },
    });

    const result = await getClassForUser(cls.id, identity.ownerId, instance.database);
    expect(
      result?.sections.filter((section) => section.skill === 'WRITING').map((s) => s.id)
    ).toEqual([active.id]);
    expect(result?.writingHistory).toEqual([
      {
        sectionId: writing.id,
        attempt: 2,
        prompts: [
          expect.objectContaining({
            task: 'Write a greeting.',
            savedDraft: 'A newer draft.',
            responses: expect.arrayContaining([
              expect.objectContaining({ text: 'Hallo.', feedback: 'Clear greeting.' }),
              expect.objectContaining({ text: 'A pending response.', overallScore: null }),
              expect.objectContaining({
                text: 'A response from before attempt tracking.',
                attemptMatches: false,
              }),
            ]),
          }),
        ],
      },
    ]);
    expect(JSON.stringify(result?.writingHistory)).not.toContain('Private staged task.');
    expect(JSON.stringify(result?.writingHistory)).not.toContain('Another learner response.');
    expect(JSON.stringify(result?.writingHistory)).not.toContain('A mismatched response.');
    expect(result?.orphanWritingDrafts).toEqual(
      expect.arrayContaining([
        { id: 'orphan', text: 'Recovered words.' },
        { id: withdrawn.writingPrompts[0]!.id, text: 'A withdrawn draft.' },
      ])
    );
    expect(await getClassForUser(cls.id, 'another-learner', instance.database)).toBeNull();
  });

  it('returns owned saved and graded quiz history while isolating a foreign submission', async () => {
    const { instance, identity, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    const oldQuestion = grammar.questions[0]!;
    const current = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'GRAMMAR',
        seed: 'current',
        spec: {},
        status: 'READY',
        attempt: 8,
        questions: {
          create: {
            order: 1,
            skill: 'GRAMMAR',
            question: 'Current question',
            options: ['A', 'B'],
            correctIndex: 0,
            explanation: 'A',
          },
        },
      },
      include: { questions: true },
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        learnerAnswers: { [oldQuestion.id]: 0, [current.questions[0]!.id]: 1, missing: 2 },
      },
    });
    const submission = await instance.database.classSubmission.create({
      data: {
        classId: cls.id,
        userId: identity.ownerId,
        attempt: 7,
        history: [
          {
            attempt: 6,
            submittedAt: null,
            receipt: { passed: false, overallScore: 0.4 },
            answers: [
              {
                sectionId: grammar.id,
                questionId: oldQuestion.id,
                selectedIndex: 1,
                isCorrect: false,
              },
            ],
          },
        ],
        answers: {
          create: {
            sectionId: grammar.id,
            questionId: oldQuestion.id,
            selectedIndex: 0,
            isCorrect: true,
          },
        },
      },
    });
    const result = await getClassForUser(cls.id, identity.ownerId, instance.database);
    expect(
      result?.quizHistory.find((section) => section.sectionId === grammar.id)?.questions[0]
    ).toMatchObject({
      id: oldQuestion.id,
      savedChoice: 0,
      submissions: [
        expect.objectContaining({ selectedIndex: 0, isCorrect: true, attempt: 7 }),
        expect.objectContaining({ selectedIndex: 1, isCorrect: false, attempt: 6 }),
      ],
    });
    expect(result?.orphanQuizAnswers).toContainEqual(
      expect.objectContaining({ questionId: 'missing', savedChoice: 2 })
    );
    expect(result?.learnerAnswers).toEqual({ [current.questions[0]!.id]: 1 });
    expect(result?.quizSubmissionReceipts).toContainEqual({
      attempt: 6,
      submittedAt: null,
      passed: false,
      overallScore: 0.4,
      answersUnavailable: false,
      passedSections: null,
      totalSections: null,
      sections: [],
      summaryIncomplete: true,
    });
    const other = await instance.database.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    await instance.database.classSubmission.update({
      where: { id: submission.id },
      data: { userId: other.id },
    });
    const isolated = await getClassForUser(cls.id, identity.ownerId, instance.database);
    expect(isolated?.submission).toBeNull();
    expect(isolated?.quizHistoryUnreadable).toBe(true);
    expect(isolated?.quizSubmissionReceipts).toEqual([]);
    expect(
      isolated?.quizHistory.find((section) => section.sectionId === grammar.id)?.questions[0]
        ?.submissions
    ).toEqual([]);
  });

  it('atomically claims repair from complete history and replays the same durable admission', async () => {
    const { instance, courseId, execution, repairTarget } = getContext();
    const { cls, grammar, writing, requirements } = await repairTarget();
    const input = {
      intent: { kind: 'REPAIR' as const, classId: cls.id, expectedAttempt: cls.attempt },
    };
    const admitted = await requestClassPreparation(courseId, execution, input);
    const replay = await requestClassPreparation(courseId, execution, input);
    expect(replay.id).toBe(admitted.id);
    expect(admitted.intent).toMatchObject({
      classId: cls.id,
      kind: 'REPAIR',
      attempt: 8,
      skills: ['READING', 'WRITING'],
      retainedQuiz: {
        version: 1,
        sections: [{ sectionId: grammar.id, digest: expect.stringMatching(/^[a-f0-9]{64}$/) }],
      },
    });
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
    expect(saved).toMatchObject({
      status: 'GENERATING',
      attempt: 8,
      skillRequirements: requirements,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
    });
    expect(await instance.database.classSection.count({ where: { classId: cls.id } })).toBe(2);
    expect(await instance.database.lessonQuestion.count({ where: { sectionId: grammar.id } })).toBe(
      5
    );
    expect(
      await instance.database.writingResponse.findFirst({
        where: { promptId: writing.writingPrompts[0].id },
      })
    ).toMatchObject({ text: 'Hallo.', overallScore: 0.9 });
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(admitted.id)
      )
    ).not.toBeNull();
  });

  it.each(['disabled', 'replica'] as const)(
    'rejects repair when its quiz database fence is unavailable (%s)',
    async (mode) => {
      const { instance } = getContext();
      await expect(
        instance.database.$transaction(async (database) => {
          if (mode === 'disabled')
            await database.$executeRaw`ALTER TABLE "LessonQuestion" DISABLE TRIGGER "LessonQuestion_formative_update"`;
          else await database.$executeRaw`SET LOCAL session_replication_role = replica`;
          await requireRepairQuizFence(database);
        })
      ).rejects.toThrow('The class quiz database fence is unavailable.');
    }
  );

  it.each(['answers', 'stage', 'activation'] as const)(
    'rejects grammar repair when its %s trigger is disabled',
    async (target) => {
      const { instance, repairTarget } = getContext();
      const { cls } = await repairTarget();
      await expect(
        instance.database.$transaction(async (database) => {
          if (target === 'answers')
            await database.$executeRaw`ALTER TABLE "SectionAnswer" DISABLE TRIGGER "SectionAnswer_formative_update"`;
          if (target === 'stage')
            await database.$executeRaw`ALTER TABLE "ClassGrammarStage" DISABLE TRIGGER "ClassGrammarStage_guard"`;
          if (target === 'activation')
            await database.$executeRaw`ALTER TABLE "ClassSection" DISABLE TRIGGER "ClassSection_staged_grammar_guard"`;
          await grammarRepairSourceHash(database, cls.id, 8);
        })
      ).rejects.toThrow('The grammar evidence database fence is unavailable.');
    }
  );

  it.each([
    ['GRAMMAR', 'ClassGrammarStage', 'ClassGrammarStage_guard', 'guardClassGrammarStage'],
    [
      'GRAMMAR',
      'ClassSection',
      'ClassSection_staged_grammar_guard',
      'guardStagedGrammarActivation',
    ],
    ['READING', 'ClassReadingStage', 'ClassReadingStage_guard', 'guardClassReadingStage'],
    [
      'READING',
      'ClassSection',
      'ClassSection_staged_reading_guard',
      'guardStagedReadingActivation',
    ],
    ['WRITING', 'ClassWritingStage', 'ClassWritingStage_guard', 'guardClassWritingStage'],
    [
      'WRITING',
      'ClassSection',
      'ClassSection_staged_writing_guard',
      'guardStagedWritingActivation',
    ],
  ] as const)(
    'rejects %s stage with disabled, missing or changed guard %s.%s',
    async (skill, table, trigger, fn) => {
      const { instance } = getContext();
      for (const mode of ['disabled', 'missing', 'changed'] as const) {
        await expect(
          instance.database.$transaction(async (database) => {
            if (mode === 'disabled')
              await database.$executeRawUnsafe(
                `ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`
              );
            else if (mode === 'missing')
              await database.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "${table}"`);
            else
              await database.$executeRawUnsafe(
                `CREATE OR REPLACE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`
              );
            await requireStageGuard(database, skill);
          })
        ).rejects.toThrow('The private repair stage database guard is unavailable.');
      }
    }
  );

  it('keeps a stage trigger locked against concurrent disable until the transaction ends', async () => {
    const { instance } = getContext();
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
        await requireStageGuard(database, 'READING');
        locked();
        await gate;
      },
      { timeout: 15_000 }
    );
    await lockReady;
    const writer = instance.database.$transaction(
      async (database) => {
        const [{ pid }] = await database.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        reportPid(pid!);
        await database.$executeRaw`ALTER TABLE "ClassReadingStage" DISABLE TRIGGER "ClassReadingStage_guard"`;
        throw new Error('Roll back fixture DDL');
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
    await reader;
    await expect(writer).rejects.toThrow('Roll back fixture DDL');
    await instance.database.$transaction((database) => requireStageGuard(database, 'READING'));
  });

  it('rejects repair stages when the database session bypasses origin triggers', async () => {
    const { instance } = getContext();
    await expect(
      instance.database.$transaction(async (database) => {
        await database.$executeRaw`SET LOCAL session_replication_role = replica`;
        await requireStageGuard(database, 'READING');
      })
    ).rejects.toThrow('The private repair stage database guard is unavailable.');
  });

  it.each([
    ['GRAMMAR', 'ClassSection_staged_grammar_guard', 'guardStagedGrammarActivation'],
    ['READING', 'ClassSection_staged_reading_guard', 'guardStagedReadingActivation'],
    ['WRITING', 'ClassSection_staged_writing_guard', 'guardStagedWritingActivation'],
  ] as const)(
    'rejects %s activation guard watching the wrong column',
    async (skill, trigger, fn) => {
      const { instance } = getContext();
      await expect(
        instance.database.$transaction(async (database) => {
          await database.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "ClassSection"`);
          await database.$executeRawUnsafe(
            `CREATE TRIGGER "${trigger}" BEFORE UPDATE OF status ON "ClassSection" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`
          );
          await requireStageGuard(database, skill);
        })
      ).rejects.toThrow('The private repair stage database guard is unavailable.');
    }
  );

  it('rejects foreign submission evidence linked to the saved grammar', async () => {
    const { instance, identity, courseId, execution, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: cls.lessonId, order: 2, status: 'IN_PROGRESS' },
    });
    await instance.database.classSubmission.create({
      data: {
        classId: other.id,
        userId: identity.ownerId,
        answers: {
          create: {
            sectionId: grammar.id,
            questionId: grammar.questions[0]!.id,
            selectedIndex: 0,
            isCorrect: true,
          },
        },
      },
    });
    await instance.database.classSection.update({
      where: { id: grammar.id },
      data: { status: 'FAILED' },
    });
    await expect(
      requestClassPreparation(courseId, execution, {
        intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
      })
    ).rejects.toThrow('Saved grammar answers have inconsistent class ownership.');
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({ status: 'IN_PROGRESS', attempt: cls.attempt });
  });

  it.each([
    ['insert', 'section'],
    ['update', 'section'],
    ['delete', 'section'],
    ['insert', 'question'],
    ['update', 'question'],
    ['delete', 'question'],
  ] as const)(
    'fences a stale class snapshot for foreign answer %s via %s',
    async (mutation, link) => {
      const { instance, identity, courseId, repairTarget } = getContext();
      const { cls, grammar } = await repairTarget();
      const other = await instance.database.courseClass.create({
        data: { courseId, lessonId: cls.lessonId, order: 2, status: 'IN_PROGRESS' },
      });
      const submission = await instance.database.classSubmission.create({
        data: { classId: other.id, userId: identity.ownerId },
      });
      const answerData = {
        submissionId: submission.id,
        sectionId: link === 'section' ? grammar.id : 'unrelated-section',
        questionId: link === 'question' ? grammar.questions[0]!.id : 'unrelated-question',
        selectedIndex: 0,
        isCorrect: true,
      };
      const existing =
        mutation === 'insert'
          ? null
          : await instance.database.sectionAnswer.create({ data: answerData });
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
        if (mutation === 'insert')
          await instance.database.sectionAnswer.create({ data: answerData });
        if (mutation === 'update')
          await instance.database.sectionAnswer.update({
            where: { id: existing!.id },
            data: { selectedIndex: 1 },
          });
        if (mutation === 'delete')
          await instance.database.sectionAnswer.delete({ where: { id: existing!.id } });
      } finally {
        proceed();
      }
      const failure: unknown = await reader.then(
        () => null,
        (error: unknown) => error
      );
      expect(isSerializationConflict(failure)).toBe(true);
      const saved = await instance.database.sectionAnswer.findFirst({
        where: {
          submissionId: submission.id,
          sectionId: answerData.sectionId,
          questionId: answerData.questionId,
        },
      });
      if (mutation === 'delete') expect(saved).toBeNull();
      else expect(saved?.selectedIndex).toBe(mutation === 'update' ? 1 : 0);
    }
  );
}
