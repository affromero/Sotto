// @vitest-environment node
// @vitest-environment node
import { createHash } from 'node:crypto';
import { assertStoredPracticeMaterial } from '@/lib/practice/material';
import { publishClassGeneration } from '@/lib/learning/classes/class-generation-state';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { submitClass } from '@/lib/learning/classes/class-submission';
import { submitPractice } from '@/lib/practice/submission';
import { saveLearningProgress, LearningProgressConflict } from '@/lib/learning/progress';
import { resumePractice } from '@/lib/practice/resume';
import { upsertLiveVocab } from '@/lib/knowledge-graph';
import { createSubmissionFixture } from './submissions/fixtures';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Complete learning submissions against PostgreSQL', () => {
  const fixture = createSubmissionFixture(binding, 'learning_submission');
  it.each([
    [false, false, 3],
    [true, false, 4],
    [false, true, 4],
    [true, true, 5],
  ] as const)(
    'classes complete with TTS=%s, STT=%s and %s required skills',
    async (tts, stt, count) => {
      const cls = await fixture.seedClass(fixture.requirements('CLASS', tts, stt));
      const result = await submitClass(cls.id, fixture.userId, cls.answers);
      expect(result?.passed).toBe(true);
      expect(result?.totalSections).toBe(count);
      expect(
        (
          await fixture.instance.database.course.findUniqueOrThrow({
            where: { id: fixture.courseId },
          })
        ).activeClassId
      ).toBeNull();
      expect(
        (
          await fixture.instance.database.learnerVocab.findFirstOrThrow({
            where: { courseId: fixture.courseId },
          })
        ).reps
      ).toBe(1);
    }
  );
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const)('full practice completes with TTS=%s and STT=%s', async (tts, stt) => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', tts, stt));
    expect(
      (await submitPractice(session.id, fixture.userId, session.answers)).score
    ).toBeGreaterThan(0.9);
    expect(
      (
        await fixture.instance.database.practiceSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).status
    ).toBe('COMPLETED');
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const)('publishes only complete stored classes with TTS=%s and STT=%s', async (tts, stt) => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', tts, stt));
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING' },
    });
    await fixture.instance.database.$transaction((database) =>
      publishClassGeneration(database, {
        classId: cls.id,
        attempt: 1,
        userId: fixture.userId,
        data: {},
      })
    );
    expect(
      (await fixture.instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
        .status
    ).toBe('AVAILABLE');
  });
  it.each([
    'questions',
    'extraction',
    'script',
    'reference',
    'changed_script',
    'duplicate_options',
  ] as const)('keeps incomplete %s unpublished', async (missing) => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING' },
    });
    if (missing === 'questions')
      await fixture.instance.database.lessonQuestion.delete({
        where: { id: cls.answers[0]!.questionId },
      });
    if (missing === 'extraction')
      await fixture.instance.database.courseClass.update({
        where: { id: cls.id },
        data: { readingVocabulary: { passageText: 'Unrelated source' } },
      });
    if (missing === 'script') await fixture.instance.database.script.deleteMany();
    if (missing === 'changed_script')
      await fixture.instance.database.script.updateMany({
        data: { turns: [{ speaker: 'Ana', text: 'Adiós.' }] },
      });
    if (missing === 'duplicate_options')
      await fixture.instance.database.lessonQuestion.update({
        where: { id: cls.answers[0]!.questionId },
        data: { options: ['hola', 'Hola', 'ayer', 'mañana'] },
      });
    if (missing === 'reference')
      await fixture.instance.database.speakingPrompt.updateMany({
        data: { referenceTtsUrl: null },
      });
    await expect(
      fixture.instance.database.$transaction((database) =>
        publishClassGeneration(database, {
          classId: cls.id,
          attempt: 1,
          userId: fixture.userId,
          data: {},
        })
      )
    ).rejects.toThrow();
    expect(
      (await fixture.instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
        .status
    ).toBe('GENERATING');
  });
  it.each([
    'questions',
    'extraction',
    'memory',
    'changed_script',
    'foreign_episode',
    'unowned_reference',
    'duplicate_options',
    'blank_writing',
    'blank_speaking',
  ] as const)('rejects damaged practice %s before activation and completion', async (damage) => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', true, true));
    const stored = await fixture.instance.database.practiceSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const items = stored.items as Array<{
      id: string;
      options: string[];
    }>;
    if (damage === 'questions')
      await fixture.instance.database.practiceSession.update({
        where: { id: session.id },
        data: { items: items.slice(1) },
      });
    if (damage === 'duplicate_options')
      await fixture.instance.database.practiceSession.update({
        where: { id: session.id },
        data: {
          items: items.map((item, index) =>
            index ? item : { ...item, options: ['hola', 'Hola', 'ayer', 'mañana'] }
          ),
        },
      });
    if (damage === 'extraction')
      await fixture.instance.database.practiceSession.update({
        where: { id: session.id },
        data: {
          readingVocabulary: {
            sourceHash: 'a'.repeat(64),
            passageText: 'Unrelated source',
            words: [],
          },
        },
      });
    if (damage === 'memory')
      await fixture.instance.database.learnerVocab.deleteMany({
        where: { courseId: fixture.courseId },
      });
    if (damage === 'changed_script')
      await fixture.instance.database.script.updateMany({
        data: { turns: [{ speaker: 'Ana', text: 'Adiós.' }] },
      });
    if (damage === 'foreign_episode') {
      const foreign = await fixture.instance.database.user.create({
        data: { email: 'foreign-learning@test.local', name: 'Other learner' },
      });
      await fixture.instance.database.episode.updateMany({ data: { userId: foreign.id } });
    }
    if (damage === 'unowned_reference')
      await fixture.instance.database.speakingPrompt.updateMany({
        data: { referenceTtsUrl: '/unowned/reference.mp3' },
      });
    if (damage === 'blank_writing')
      await fixture.instance.database.writingPrompt.updateMany({ data: { task: ' ' } });
    if (damage === 'blank_speaking')
      await fixture.instance.database.speakingPrompt.updateMany({ data: { targetPhrase: ' ' } });
    await expect(
      fixture.instance.database.$transaction((database) =>
        assertStoredPracticeMaterial(database, session.id)
      )
    ).rejects.toThrow();
    await expect(submitPractice(session.id, fixture.userId, session.answers)).rejects.toThrow();
    expect(
      (
        await fixture.instance.database.practiceSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).status
    ).toBe('ACTIVE');
    expect(
      (
        await fixture.instance.database.learnerGrammar.findFirstOrThrow({
          where: { courseId: fixture.courseId },
        })
      ).reps
    ).toBe(0);
  });
  it('rejects a stale publication attempt without changing the course gate', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING', attempt: 2 },
    });
    await expect(
      fixture.instance.database.$transaction((database) =>
        publishClassGeneration(database, {
          classId: cls.id,
          attempt: 1,
          userId: fixture.userId,
          data: {},
        })
      )
    ).rejects.toThrow(/cancelled/);
    expect(
      (await fixture.instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
        .status
    ).toBe('GENERATING');
    expect(
      (
        await fixture.instance.database.course.findUniqueOrThrow({
          where: { id: fixture.courseId },
        })
      ).activeClassId
    ).toBe(cls.id);
  });
  it('cannot compensate for failed writing with other class skills', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    await fixture.instance.database.writingResponse.updateMany({
      where: { sectionId: { not: null } },
      data: { overallScore: 0.1 },
    });
    const result = await submitClass(cls.id, fixture.userId, cls.answers);
    expect(result?.passed).toBe(false);
    expect(result?.passedSections).toBe(4);
    expect(
      (
        await fixture.instance.database.course.findUniqueOrThrow({
          where: { id: fixture.courseId },
        })
      ).activeClassId
    ).toBe(cls.id);
  });
  it('retains a failed receipt without replaying it after a newer generation fails', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    const failed = await submitClass(
      cls.id,
      fixture.userId,
      cls.answers.map((answer) => ({ ...answer, selectedIndex: 3 }))
    );
    expect(failed?.passed).toBe(false);
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: { attempt: 2, status: 'FAILED' },
    });
    await expect(submitClass(cls.id, fixture.userId, cls.answers)).rejects.toThrow(
      'not ready for submission'
    );
    expect(
      await fixture.instance.database.classSubmission.findUnique({ where: { classId: cls.id } })
    ).toMatchObject({ attempt: 1, receipt: failed });
  });
  it('practice completes after all work is graded even when scores are low', async () => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', true, true));
    await fixture.instance.database.writingResponse.updateMany({
      where: { practiceSessionId: session.id },
      data: { overallScore: 0.1 },
    });
    const result = await submitPractice(
      session.id,
      fixture.userId,
      session.answers.map((answer) => ({ ...answer, selectedIndex: 3 }))
    );
    expect(result.score).toBeLessThan(0.7);
    expect(result.correct).toBe(0);
  });
  it.each(['class', 'practice'] as const)(
    'rejects unfinished writing in a %s without changing progress',
    async (kind) => {
      const session =
        kind === 'class'
          ? await fixture.seedClass(fixture.requirements('CLASS', true, true))
          : await fixture.seedPractice(fixture.requirements('FULL', true, true));
      await fixture.instance.database.writingResponse.updateMany({ data: { overallScore: null } });
      const submit =
        kind === 'class'
          ? submitClass(
              session.id,
              fixture.userId,
              session.answers as Array<{
                questionId: string;
                selectedIndex: number;
              }>
            )
          : submitPractice(
              session.id,
              fixture.userId,
              session.answers as Array<{
                itemId: string;
                selectedIndex: number;
              }>
            );
      await expect(submit).rejects.toThrow(/feedback|writing/);
      expect(
        (
          await fixture.instance.database.learnerVocab.findFirstOrThrow({
            where: { courseId: fixture.courseId },
          })
        ).reps
      ).toBe(0);
      expect(await fixture.instance.database.classSubmission.count()).toBe(0);
    }
  );
  it('rejects completion if a listening script changed after publication', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    await fixture.instance.database.script.updateMany({
      data: { turns: [{ speaker: 'Ana', text: 'Adiós.' }] },
    });
    await expect(submitClass(cls.id, fixture.userId, cls.answers)).rejects.toThrow(/script/);
    expect(await fixture.instance.database.classSubmission.count()).toBe(0);
    expect(
      (
        await fixture.instance.database.course.findUniqueOrThrow({
          where: { id: fixture.courseId },
        })
      ).activeClassId
    ).toBe(cls.id);
  });
  it('a new pending recording cannot borrow an older passing score', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    const prompt = await fixture.instance.database.speakingPrompt.findFirstOrThrow();
    await fixture.instance.database.speakingRecording.create({
      data: {
        sectionId: prompt.sectionId,
        promptId: prompt.id,
        userId: fixture.userId,
        audioUrl: '/owned/new.webm',
        status: 'PENDING',
      },
    });
    await expect(submitClass(cls.id, fixture.userId, cls.answers)).rejects.toThrow(/speaking/);
    expect(
      await fixture.instance.database.speakingRecording.count({ where: { promptId: prompt.id } })
    ).toBe(2);
  });
  it('retained passed sections contribute mastery without repeating their vocabulary and grammar reviews', async () => {
    const contract = fixture.requirements('CLASS', false, true);
    const cls = await fixture.seedClass(contract);
    await fixture.instance.database.speakingRecording.updateMany({
      where: { prompt: { section: { classId: cls.id } } },
      data: { overallScore: 0.2 },
    });
    expect(await submitClass(cls.id, fixture.userId, cls.answers)).toMatchObject({ passed: false });
    const beforeVocab = await fixture.instance.database.learnerVocab.findMany({
      where: { courseId: fixture.courseId },
    });
    const beforeGrammar = await fixture.instance.database.learnerGrammar.findMany({
      where: { courseId: fixture.courseId },
    });
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'IN_PROGRESS', attempt: 2 },
    });
    const replacement = await fixture.instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        attempt: 2,
        seed: 'retake',
        spec: {},
        status: 'READY',
      },
    });
    for (let order = 1; order <= 4; order++) {
      const prompt = await fixture.instance.database.speakingPrompt.create({
        data: {
          sectionId: replacement.id,
          order,
          targetPhrase: `Hola ${order}`,
          translation: `Hello ${order}`,
        },
      });
      if (contract.referenceAudioRequired) await fixture.publishReference(prompt.id);
      await fixture.instance.database.speakingRecording.create({
        data: {
          sectionId: replacement.id,
          promptId: prompt.id,
          userId: fixture.userId,
          attempt: 2,
          audioUrl: '/owned/new-recording.webm',
          status: 'SCORED',
          overallScore: 0.9,
        },
      });
    }
    expect(await submitClass(cls.id, fixture.userId, cls.answers)).toMatchObject({
      passed: true,
      passedSections: 4,
    });
    expect(
      await fixture.instance.database.learnerVocab.findMany({
        where: { courseId: fixture.courseId },
      })
    ).toEqual(beforeVocab);
    expect(
      await fixture.instance.database.learnerGrammar.findMany({
        where: { courseId: fixture.courseId },
      })
    ).toEqual(beforeGrammar);
  });
  it('earlier speaking and writing attempts cannot satisfy a retake', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    await fixture.instance.database.classSection.updateMany({
      where: { classId: cls.id, skill: { in: ['SPEAKING', 'WRITING'] } },
      data: { attempt: 2 },
    });
    await expect(submitClass(cls.id, fixture.userId, cls.answers)).rejects.toThrow(
      /speaking|writing/
    );
    expect(await fixture.instance.database.speakingRecording.count()).toBe(4);
    expect(await fixture.instance.database.writingResponse.count()).toBe(3);
  });
  it('serializes duplicate class submissions and reviews vocabulary once', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    const [first, retry] = await Promise.all([
      submitClass(cls.id, fixture.userId, cls.answers),
      submitClass(cls.id, fixture.userId, cls.answers),
    ]);
    expect(retry).toEqual(first);
    expect(
      (
        await fixture.instance.database.learnerVocab.findFirstOrThrow({
          where: { courseId: fixture.courseId },
        })
      ).reps
    ).toBe(1);
    expect(await fixture.instance.database.classSubmission.count()).toBe(1);
  });
  it('serializes duplicate practice submissions and reopens the same result', async () => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', false, false));
    const [first, retry] = await Promise.all([
      submitPractice(session.id, fixture.userId, session.answers),
      submitPractice(session.id, fixture.userId, session.answers),
    ]);
    expect(retry).toEqual(first);
    expect(
      (
        await fixture.instance.database.learnerVocab.findFirstOrThrow({
          where: { courseId: fixture.courseId },
        })
      ).reps
    ).toBe(1);
    expect((await resumePractice(session.id, fixture.userId)).submissionResult).toEqual(first);
  });
  it('rolls back grades, submissions and course advancement when SRS persistence fails', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    await fixture.instance.database.$executeRawUnsafe(
      `CREATE FUNCTION reject_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Review persistence unavailable'; END; $$`
    );
    await fixture.instance.database.$executeRawUnsafe(
      `CREATE TRIGGER reject_review BEFORE UPDATE ON "LearnerVocab" FOR EACH ROW EXECUTE FUNCTION reject_review()`
    );
    try {
      await expect(submitClass(cls.id, fixture.userId, cls.answers)).rejects.toThrow(
        /Review persistence unavailable/
      );
      expect(await fixture.instance.database.classSubmission.count()).toBe(0);
      expect(
        (await fixture.instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
          .status
      ).toBe('AVAILABLE');
      expect(
        await fixture.instance.database.classSection.count({
          where: { classId: cls.id, passed: { not: null } },
        })
      ).toBe(0);
    } finally {
      await fixture.instance.database.$executeRawUnsafe(
        `DROP TRIGGER reject_review ON "LearnerVocab"`
      );
      await fixture.instance.database.$executeRawUnsafe(`DROP FUNCTION reject_review()`);
    }
  });
  it('restores owned answers and drafts without publishing answer keys', async () => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', false, false));
    const prompt = await fixture.instance.database.writingPrompt.findFirstOrThrow({
      where: { practiceSessionId: session.id },
    });
    await saveLearningProgress('PRACTICE', session.id, fixture.userId, {
      expectedRevision: 0,
      answers: { g0: 2 },
      writingDrafts: { [prompt.id]: 'Buenas tardes.' },
    });
    const resumed = await resumePractice(session.id, fixture.userId);
    expect(resumed.learnerAnswers).toEqual({ g0: 2 });
    expect(resumed.writingDrafts).toEqual({ [prompt.id]: 'Buenas tardes.' });
    expect(resumed.progressRevision).toBe(1);
    await expect(
      saveLearningProgress('PRACTICE', session.id, fixture.userId, {
        expectedRevision: 0,
        answers: { g0: 0 },
      })
    ).rejects.toBeInstanceOf(LearningProgressConflict);
    expect((await resumePractice(session.id, fixture.userId)).learnerAnswers).toEqual({ g0: 2 });
    if (resumed.status !== 'ready_full') throw new Error('Expected full practice');
    expect(resumed.items[0]).not.toHaveProperty('correctIndex');
    expect(resumed.items[0]).not.toHaveProperty('explanation');
    expect(
      await saveLearningProgress('PRACTICE', session.id, 'intruder', {
        expectedRevision: 0,
        answers: { g0: 0 },
      })
    ).toBe(false);
  });
  it('returns durable choice explanations and counts productive feedback separately', async () => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', false, false));
    const answers = session.answers;
    answers[0]!.selectedIndex = 1;
    const result = await submitPractice(session.id, fixture.userId, answers);
    expect(result).toMatchObject({ correct: 9, answered: 10, graded: 3, total: 13 });
    expect(result.itemFeedback?.[0]).toMatchObject({
      itemId: 'g0',
      selectedIndex: 1,
      correctIndex: 0,
      correct: false,
    });
    expect(result.itemFeedback?.[0]?.explanation).toBeTruthy();
    expect(result.writingFeedback).toHaveLength(3);
    expect(result.writingFeedback?.[0]?.grade).toMatchObject({
      text: 'Hola.',
      feedback: 'Clear greeting.',
      overallScore: 0.9,
    });
    expect(await submitPractice(session.id, fixture.userId, [])).toEqual(result);
    expect((await resumePractice(session.id, fixture.userId)).submissionResult).toEqual(result);
  });
  it('reviews extracted reading words only through their assessed questions', async () => {
    const session = await fixture.seedPractice(fixture.requirements('FULL', false, false));
    await upsertLiveVocab(
      fixture.courseId,
      [
        { lemma: 'amigo', gloss: 'friend' },
        { lemma: 'buenas', gloss: 'good' },
      ],
      'A1',
      fixture.instance.database
    );
    await fixture.instance.database.practiceSession.update({
      where: { id: session.id },
      data: {
        vocabLemmas: ['hola', 'amigo', 'buenas'],
        items: (
          (
            await fixture.instance.database.practiceSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).items as Array<{
            id: string;
            passageText?: string;
          }>
        ).map((item) =>
          item.id.startsWith('r') ? { ...item, passageText: 'Hola, amigo. Buenas tardes.' } : item
        ),
        readingVocabulary: {
          sourceHash: createHash('sha256').update('Hola, amigo. Buenas tardes.').digest('hex'),
          passageText: 'Hola, amigo. Buenas tardes.',
          words: [
            {
              lemma: 'hola',
              gloss: 'hello',
              pos: 'expression',
              sourceForm: 'Hola',
              questionIds: ['r0'],
            },
            {
              lemma: 'amigo',
              gloss: 'friend',
              pos: 'noun',
              sourceForm: 'amigo',
              questionIds: ['r1'],
            },
            {
              lemma: 'buenas',
              gloss: 'good',
              pos: 'adjective',
              sourceForm: 'Buenas',
              questionIds: [],
            },
          ],
        },
      },
    });
    const answers = session.answers;
    answers.find((answer) => answer.itemId === 'r1')!.selectedIndex = 1;
    await submitPractice(session.id, fixture.userId, answers);
    const vocab = await fixture.instance.database.learnerVocab.findMany({
      where: { courseId: fixture.courseId },
      select: { lemma: true, reps: true, lapses: true, lastReviewed: true },
    });
    expect(vocab.find((word) => word.lemma === 'hola')?.reps).toBe(1);
    expect(vocab.find((word) => word.lemma === 'amigo')).toMatchObject({ reps: 0, lapses: 1 });
    expect(vocab.find((word) => word.lemma === 'buenas')?.lastReviewed).toBeNull();
  });
  it('leaves lesson vocabulary unreviewed when reading questions do not assess it', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    await fixture.instance.database.learnerVocab.create({
      data: { courseId: fixture.courseId, lemma: 'amigo', translation: 'friend' },
    });
    await fixture.instance.database.lesson.update({
      where: { id: fixture.lessonId },
      data: {
        targetVocab: [
          { lemma: 'hola', gloss: 'hello' },
          { lemma: 'amigo', gloss: 'friend' },
        ],
      },
    });
    await submitClass(cls.id, fixture.userId, cls.answers);
    expect(
      await fixture.instance.database.learnerVocab.findUniqueOrThrow({
        where: { courseId_lemma: { courseId: fixture.courseId, lemma: 'amigo' } },
      })
    ).toMatchObject({ reps: 0, lastReviewed: null });
    expect(
      await fixture.instance.database.learnerVocab.findUniqueOrThrow({
        where: { courseId_lemma: { courseId: fixture.courseId, lemma: 'hola' } },
      })
    ).toMatchObject({ reps: 1 });
    await fixture.instance.database.lesson.update({
      where: { id: fixture.lessonId },
      data: { targetVocab: [{ lemma: 'hola', gloss: 'hello' }] },
    });
  });
  it('reviews frozen class grammar after a curriculum edit without crediting unassessed words', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        adaptiveSeed: {
          classTargets: {
            vocab: [{ lemma: 'amigo', gloss: 'friend' }],
            grammarPoints: ['articles'],
          },
        },
      },
    });
    await fixture.instance.database.learnerVocab.create({
      data: { courseId: fixture.courseId, lemma: 'amigo', translation: 'friend' },
    });
    await fixture.instance.database.learnerGrammar.create({
      data: { courseId: fixture.courseId, topicKey: 'verbs', title: 'Verbs' },
    });
    await fixture.instance.database.lesson.update({
      where: { id: fixture.lessonId },
      data: { grammarPoints: ['verbs'] },
    });
    try {
      await submitClass(cls.id, fixture.userId, cls.answers);
      await submitClass(cls.id, fixture.userId, cls.answers);
      const grammar = await fixture.instance.database.learnerGrammar.findMany({
        where: { courseId: fixture.courseId },
      });
      expect(grammar.find((item) => item.topicKey === 'articles')).toMatchObject({ reps: 1 });
      expect(grammar.find((item) => item.topicKey === 'verbs')).toMatchObject({
        reps: 0,
        lastReviewed: null,
      });
      expect(
        await fixture.instance.database.learnerVocab.findUniqueOrThrow({
          where: { courseId_lemma: { courseId: fixture.courseId, lemma: 'amigo' } },
        })
      ).toMatchObject({ reps: 0, lastReviewed: null });
    } finally {
      await fixture.instance.database.lesson.update({
        where: { id: fixture.lessonId },
        data: { grammarPoints: ['articles'] },
      });
    }
  });
  it('preserves both vocabulary reviews when different sessions finish concurrently', async () => {
    const first = await fixture.seedPractice(fixture.requirements('FULL', false, false));
    const second = await fixture.seedPractice(fixture.requirements('FULL', false, false));
    await Promise.all([
      submitPractice(first.id, fixture.userId, first.answers),
      submitPractice(second.id, fixture.userId, second.answers),
    ]);
    expect(
      (
        await fixture.instance.database.learnerVocab.findUniqueOrThrow({
          where: { courseId_lemma: { courseId: fixture.courseId, lemma: 'hola' } },
        })
      ).reps
    ).toBe(2);
  });
});
