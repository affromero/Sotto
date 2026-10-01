// @vitest-environment node
import { createHash } from 'node:crypto';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { captureSpeakingPromptStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { assertStoredPracticeMaterial } from '@/lib/practice/material';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { publishClassGeneration } from '@/lib/learning/classes/class-generation-state';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements, learningSkills, type SkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import { submitClass } from '@/lib/learning/classes/class-submission';
import { submitPractice } from '@/lib/practice/submission';
import { saveLearningProgress, LearningProgressConflict } from '@/lib/learning/progress';
import { resumePractice } from '@/lib/practice/resume';
import { upsertLiveVocab } from '@/lib/knowledge-graph';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Complete learning submissions against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let courseId: string;
  let lessonId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('learning_submission');
    binding.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
    binding.database = null;
  });
  beforeEach(async () => {
    userId = (await instance.reset()).ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'greetings' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'greetings',
        level: 'A1',
        order: 1,
        title: 'Greetings',
        objective: 'Greet people',
        grammarPoints: ['articles'],
        targetVocab: [{ lemma: 'hola', gloss: 'hello' }],
        vocabThemes: ['greetings'],
      },
      update: {},
    });
    lessonId = lesson.id;
    courseId = (
      await instance.database.course.create({
        data: { userId, curriculumId: curriculum.id, nativeLang: 'en', targetLang: 'es' },
      })
    ).id;
    await instance.database.learnerVocab.create({
      data: { courseId, lemma: 'hola', translation: 'hello' },
    });
    await instance.database.learnerGrammar.create({
      data: { courseId, topicKey: 'articles', title: 'Articles' },
    });
  });

  function requirements(scope: 'CLASS' | 'FULL', tts: boolean, stt: boolean) {
    return createSkillRequirements({
      scope,
      nativeLang: 'en',
      targetLang: 'es',
      level: 'A1',
      ttsProvider: tts ? 'cartesia' : null,
      sttProvider: stt ? 'openai' : null,
    });
  }

  async function publishReference(promptId: string) {
    await writeStorageReference({
      database: instance.database,
      signal: new AbortController().signal,
      prefix: `speaking-ref/${promptId}`,
      extension: 'mp3',
      contentType: 'audio/mpeg',
      body: Buffer.from('reference fixture'),
      captureAdmission: async (database) => ({
        ...(await captureSpeakingPromptStorage(database, promptId)),
        consumer: `speaking-prompt:${promptId}:reference`,
        snapshot: null,
      }),
      validateAdmission: async (database) => {
        await captureSpeakingPromptStorage(database, promptId);
      },
      previousReference: () => null,
      commit: async (database, referenceTtsUrl) => {
        await database.speakingPrompt.update({
          where: { id: promptId },
          data: { referenceTtsUrl },
        });
      },
    });
  }

  async function seedClass(contract: SkillRequirements) {
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId, order: 1, status: 'AVAILABLE', skillRequirements: contract },
    });
    await instance.database.course.update({
      where: { id: courseId },
      data: { activeClassId: cls.id },
    });
    const answers: Array<{ questionId: string; selectedIndex: number }> = [];
    for (const skill of learningSkills) {
      const required = contract.skills[skill];
      if (required.state !== 'REQUIRED') continue;
      const episode =
        skill === 'LISTENING'
          ? await instance.database.episode.create({
              data: {
                userId,
                title: 'Greetings',
                topic: 'Greetings',
                status: 'READY',
                audioUrl: '/owned/listening.mp3',
              },
            })
          : null;
      if (episode)
        await instance.database.script.create({
          data: {
            episodeId: episode.id,
            markdown: 'Ana: Hola.',
            turns: [{ speaker: 'Ana', text: 'Hola.' }],
          },
        });
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill,
          status: 'READY',
          seed: skill,
          spec: episode
            ? { scriptHash: learningScriptHash([{ speaker: 'Ana', text: 'Hola.' }]) }
            : {},
          episodeId: episode?.id,
        },
      });
      for (let index = 0; index < required.expectedCount; index++) {
        if (skill === 'SPEAKING') {
          const prompt = await instance.database.speakingPrompt.create({
            data: {
              sectionId: section.id,
              order: index + 1,
              targetPhrase: `Hola ${index}`,
              translation: `Hello ${index}`,
              referenceTtsUrl: null,
            },
          });
          if (contract.referenceAudioRequired) await publishReference(prompt.id);
          await instance.database.speakingRecording.create({
            data: {
              sectionId: section.id,
              promptId: prompt.id,
              userId,
              status: 'SCORED',
              audioUrl: `/owned/recording-${index}.webm`,
              overallScore: 0.9,
            },
          });
        } else if (skill === 'WRITING') {
          const prompt = await instance.database.writingPrompt.create({
            data: {
              sectionId: section.id,
              order: index + 1,
              task: 'Reply to the supplied greeting.',
            },
          });
          await instance.database.writingResponse.create({
            data: {
              sectionId: section.id,
              promptId: prompt.id,
              userId,
              text: 'Hola.',
              overallScore: 0.9,
              corrections: [],
              feedback: 'Clear greeting.',
            },
          });
        } else {
          const question = await instance.database.lessonQuestion.create({
            data: {
              sectionId: section.id,
              skill,
              order: index + 1,
              question: `Greeting ${index}?`,
              options: ['hola', 'adiós', 'ayer', 'mañana'],
              correctIndex: 0,
              explanation: 'Hola is a greeting.',
              passageText: skill === 'READING' ? 'Ana saluda a sus amigos: hola.' : null,
            },
          });
          answers.push({ questionId: question.id, selectedIndex: 0 });
        }
      }
    }
    const passageText = 'Ana saluda a sus amigos: hola.';
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        readingVocabulary: {
          passageText,
          sourceHash: createHash('sha256').update(passageText).digest('hex'),
          words: [
            {
              lemma: 'hola',
              gloss: 'hello',
              pos: 'expression',
              sourceForm: 'hola',
              questionIds: await instance.database.lessonQuestion
                .findMany({
                  where: { section: { classId: cls.id }, skill: 'READING' },
                  select: { id: true },
                })
                .then((questions) => questions.map((question) => question.id)),
            },
          ],
        },
      },
    });
    return { id: cls.id, answers };
  }

  async function seedPractice(contract: SkillRequirements) {
    const episode =
      contract.skills.LISTENING.state === 'REQUIRED'
        ? await instance.database.episode.create({
            data: {
              userId,
              title: 'Practice',
              topic: 'Greetings',
              status: 'READY',
              audioUrl: '/owned/practice.mp3',
            },
          })
        : null;
    if (episode)
      await instance.database.script.create({
        data: {
          episodeId: episode.id,
          markdown: 'Ana: Hola.',
          turns: [{ speaker: 'Ana', text: 'Hola.' }],
        },
      });
    const items = learningSkills.flatMap((skill) => {
      const requirement = contract.skills[skill];
      if (requirement.state !== 'REQUIRED' || skill === 'WRITING' || skill === 'SPEAKING')
        return [];
      const prefix = skill === 'GRAMMAR' ? 'g' : skill === 'READING' ? 'r' : 'l';
      return Array.from({ length: requirement.expectedCount }, (_, index) => ({
        id: `${prefix}${index}`,
        prompt: 'Choose the greeting.',
        options: ['hola', 'adiós', 'ayer', 'mañana'],
        correctIndex: 0,
        explanation: 'Hola is a greeting.',
        vocabLemma: null,
        focusTargetId: null,
        ...(skill === 'READING' ? { passageText: 'Ana saluda a sus amigos: hola.' } : {}),
      }));
    });
    const session = await instance.database.practiceSession.create({
      data: {
        courseId,
        kind: 'FULL',
        seed: 'fixture',
        skillRequirements: contract,
        items,
        episodeId: episode?.id,
        listeningScriptHash: episode
          ? learningScriptHash([{ speaker: 'Ana', text: 'Hola.' }])
          : null,
        readingVocabulary: {
          passageText: 'Ana saluda a sus amigos: hola.',
          sourceHash: createHash('sha256').update('Ana saluda a sus amigos: hola.').digest('hex'),
          words: [
            {
              lemma: 'hola',
              gloss: 'hello',
              pos: 'expression',
              sourceForm: 'hola',
              questionIds: ['r0'],
            },
          ],
        },
        vocabLemmas: ['hola'],
        grammarKeys: ['articles'],
      },
    });
    if (contract.skills.SPEAKING.state === 'REQUIRED')
      for (let index = 0; index < 4; index++) {
        const prompt = await instance.database.speakingPrompt.create({
          data: {
            practiceSessionId: session.id,
            order: index + 1,
            targetPhrase: `Hola ${index}`,
            translation: `Hello ${index}`,
            referenceTtsUrl: null,
          },
        });
        if (contract.referenceAudioRequired) await publishReference(prompt.id);
        await instance.database.speakingRecording.create({
          data: {
            practiceSessionId: session.id,
            promptId: prompt.id,
            userId,
            status: 'SCORED',
            audioUrl: `/owned/recording-${index}.webm`,
            overallScore: 0.9,
          },
        });
      }
    for (let index = 0; index < 3; index++) {
      const prompt = await instance.database.writingPrompt.create({
        data: {
          practiceSessionId: session.id,
          order: index + 1,
          task: 'Reply to the supplied greeting.',
        },
      });
      await instance.database.writingResponse.create({
        data: {
          practiceSessionId: session.id,
          promptId: prompt.id,
          userId,
          text: 'Hola.',
          overallScore: 0.9,
          corrections: [],
          feedback: 'Clear greeting.',
        },
      });
    }
    return {
      id: session.id,
      answers: items.map((item) => ({ itemId: item.id, selectedIndex: 0 })),
    };
  }

  it.each([
    [false, false, 3],
    [true, false, 4],
    [false, true, 4],
    [true, true, 5],
  ] as const)(
    'classes complete with TTS=%s, STT=%s and %s required skills',
    async (tts, stt, count) => {
      const cls = await seedClass(requirements('CLASS', tts, stt));
      const result = await submitClass(cls.id, userId, cls.answers);
      expect(result?.passed).toBe(true);
      expect(result?.totalSections).toBe(count);
      expect(
        (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } }))
          .activeClassId
      ).toBeNull();
      expect(
        (await instance.database.learnerVocab.findFirstOrThrow({ where: { courseId } })).reps
      ).toBe(1);
    }
  );
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const)('full practice completes with TTS=%s and STT=%s', async (tts, stt) => {
    const session = await seedPractice(requirements('FULL', tts, stt));
    expect((await submitPractice(session.id, userId, session.answers)).score).toBeGreaterThan(0.9);
    expect(
      (await instance.database.practiceSession.findUniqueOrThrow({ where: { id: session.id } }))
        .status
    ).toBe('COMPLETED');
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const)('publishes only complete stored classes with TTS=%s and STT=%s', async (tts, stt) => {
    const cls = await seedClass(requirements('CLASS', tts, stt));
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING' },
    });
    await instance.database.$transaction((database) =>
      publishClassGeneration(database, {
        classId: cls.id,
        attempt: 1,
        userId,
        data: {},
      })
    );
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
    ).toBe('AVAILABLE');
  });

  it.each([
    'questions',
    'extraction',
    'memory',
    'script',
    'reference',
    'changed_script',
    'duplicate_options',
  ] as const)('keeps incomplete %s unpublished', async (missing) => {
    const cls = await seedClass(requirements('CLASS', true, true));
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING' },
    });
    if (missing === 'questions')
      await instance.database.lessonQuestion.delete({
        where: { id: cls.answers[0]!.questionId },
      });
    if (missing === 'extraction')
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { readingVocabulary: { passageText: 'Unrelated source' } },
      });
    if (missing === 'memory')
      await instance.database.learnerVocab.deleteMany({ where: { courseId } });
    if (missing === 'script') await instance.database.script.deleteMany();
    if (missing === 'changed_script')
      await instance.database.script.updateMany({
        data: { turns: [{ speaker: 'Ana', text: 'Adiós.' }] },
      });
    if (missing === 'duplicate_options')
      await instance.database.lessonQuestion.update({
        where: { id: cls.answers[0]!.questionId },
        data: { options: ['hola', 'Hola', 'ayer', 'mañana'] },
      });
    if (missing === 'reference')
      await instance.database.speakingPrompt.updateMany({ data: { referenceTtsUrl: null } });
    await expect(
      instance.database.$transaction((database) =>
        publishClassGeneration(database, {
          classId: cls.id,
          attempt: 1,
          userId,
          data: {},
        })
      )
    ).rejects.toThrow();
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
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
    const session = await seedPractice(requirements('FULL', true, true));
    const stored = await instance.database.practiceSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const items = stored.items as Array<{ id: string; options: string[] }>;
    if (damage === 'questions')
      await instance.database.practiceSession.update({
        where: { id: session.id },
        data: { items: items.slice(1) },
      });
    if (damage === 'duplicate_options')
      await instance.database.practiceSession.update({
        where: { id: session.id },
        data: {
          items: items.map((item, index) =>
            index ? item : { ...item, options: ['hola', 'Hola', 'ayer', 'mañana'] }
          ),
        },
      });
    if (damage === 'extraction')
      await instance.database.practiceSession.update({
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
      await instance.database.learnerVocab.deleteMany({ where: { courseId } });
    if (damage === 'changed_script')
      await instance.database.script.updateMany({
        data: { turns: [{ speaker: 'Ana', text: 'Adiós.' }] },
      });
    if (damage === 'foreign_episode') {
      const foreign = await instance.database.user.create({
        data: { email: 'foreign-learning@test.local', name: 'Other learner' },
      });
      await instance.database.episode.updateMany({ data: { userId: foreign.id } });
    }
    if (damage === 'unowned_reference')
      await instance.database.speakingPrompt.updateMany({
        data: { referenceTtsUrl: '/unowned/reference.mp3' },
      });
    if (damage === 'blank_writing')
      await instance.database.writingPrompt.updateMany({ data: { task: ' ' } });
    if (damage === 'blank_speaking')
      await instance.database.speakingPrompt.updateMany({ data: { targetPhrase: ' ' } });
    await expect(
      instance.database.$transaction((database) =>
        assertStoredPracticeMaterial(database, session.id)
      )
    ).rejects.toThrow();
    await expect(submitPractice(session.id, userId, session.answers)).rejects.toThrow();
    expect(
      (await instance.database.practiceSession.findUniqueOrThrow({ where: { id: session.id } }))
        .status
    ).toBe('ACTIVE');
    expect(
      (await instance.database.learnerGrammar.findFirstOrThrow({ where: { courseId } })).reps
    ).toBe(0);
  });

  it('rejects a stale publication attempt without changing the course gate', async () => {
    const cls = await seedClass(requirements('CLASS', false, false));
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'GENERATING', attempt: 2 },
    });
    await expect(
      instance.database.$transaction((database) =>
        publishClassGeneration(database, {
          classId: cls.id,
          attempt: 1,
          userId,
          data: {},
        })
      )
    ).rejects.toThrow(/cancelled/);
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
    ).toBe('GENERATING');
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).activeClassId
    ).toBe(cls.id);
  });

  it('cannot compensate for failed writing with other class skills', async () => {
    const cls = await seedClass(requirements('CLASS', true, true));
    await instance.database.writingResponse.updateMany({
      where: { sectionId: { not: null } },
      data: { overallScore: 0.1 },
    });
    const result = await submitClass(cls.id, userId, cls.answers);
    expect(result?.passed).toBe(false);
    expect(result?.passedSections).toBe(4);
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).activeClassId
    ).toBe(cls.id);
  });
  it('retains a failed receipt without replaying it after a newer generation fails', async () => {
    const cls = await seedClass(requirements('CLASS', false, false));
    const failed = await submitClass(
      cls.id,
      userId,
      cls.answers.map((answer) => ({ ...answer, selectedIndex: 3 }))
    );
    expect(failed?.passed).toBe(false);
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { attempt: 2, status: 'FAILED' },
    });
    await expect(submitClass(cls.id, userId, cls.answers)).rejects.toThrow(
      'not ready for submission'
    );
    expect(
      await instance.database.classSubmission.findUnique({ where: { classId: cls.id } })
    ).toMatchObject({ attempt: 1, receipt: failed });
  });
  it('practice completes after all work is graded even when scores are low', async () => {
    const session = await seedPractice(requirements('FULL', true, true));
    await instance.database.writingResponse.updateMany({
      where: { practiceSessionId: session.id },
      data: { overallScore: 0.1 },
    });
    const result = await submitPractice(
      session.id,
      userId,
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
          ? await seedClass(requirements('CLASS', true, true))
          : await seedPractice(requirements('FULL', true, true));
      await instance.database.writingResponse.updateMany({ data: { overallScore: null } });
      const submit =
        kind === 'class'
          ? submitClass(
              session.id,
              userId,
              session.answers as Array<{ questionId: string; selectedIndex: number }>
            )
          : submitPractice(
              session.id,
              userId,
              session.answers as Array<{ itemId: string; selectedIndex: number }>
            );
      await expect(submit).rejects.toThrow(/feedback|writing/);
      expect(
        (await instance.database.learnerVocab.findFirstOrThrow({ where: { courseId } })).reps
      ).toBe(0);
      expect(await instance.database.classSubmission.count()).toBe(0);
    }
  );
  it('rejects completion if a listening script changed after publication', async () => {
    const cls = await seedClass(requirements('CLASS', true, true));
    await instance.database.script.updateMany({
      data: { turns: [{ speaker: 'Ana', text: 'Adiós.' }] },
    });
    await expect(submitClass(cls.id, userId, cls.answers)).rejects.toThrow(/script/);
    expect(await instance.database.classSubmission.count()).toBe(0);
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).activeClassId
    ).toBe(cls.id);
  });

  it('a new pending recording cannot borrow an older passing score', async () => {
    const cls = await seedClass(requirements('CLASS', true, true));
    const prompt = await instance.database.speakingPrompt.findFirstOrThrow();
    await instance.database.speakingRecording.create({
      data: {
        sectionId: prompt.sectionId,
        promptId: prompt.id,
        userId,
        audioUrl: '/owned/new.webm',
        status: 'PENDING',
      },
    });
    await expect(submitClass(cls.id, userId, cls.answers)).rejects.toThrow(/speaking/);
    expect(
      await instance.database.speakingRecording.count({ where: { promptId: prompt.id } })
    ).toBe(2);
  });
  it('retained passed sections contribute mastery without repeating their vocabulary and grammar reviews', async () => {
    const contract = requirements('CLASS', false, true);
    const cls = await seedClass(contract);
    await instance.database.speakingRecording.updateMany({
      where: { prompt: { section: { classId: cls.id } } },
      data: { overallScore: 0.2 },
    });
    expect(await submitClass(cls.id, userId, cls.answers)).toMatchObject({ passed: false });
    const beforeVocab = await instance.database.learnerVocab.findMany({ where: { courseId } });
    const beforeGrammar = await instance.database.learnerGrammar.findMany({ where: { courseId } });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'IN_PROGRESS', attempt: 2 },
    });
    const replacement = await instance.database.classSection.create({
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
      const prompt = await instance.database.speakingPrompt.create({
        data: {
          sectionId: replacement.id,
          order,
          targetPhrase: `Hola ${order}`,
          translation: `Hello ${order}`,
        },
      });
      if (contract.referenceAudioRequired) await publishReference(prompt.id);
      await instance.database.speakingRecording.create({
        data: {
          sectionId: replacement.id,
          promptId: prompt.id,
          userId,
          attempt: 2,
          audioUrl: '/owned/new-recording.webm',
          status: 'SCORED',
          overallScore: 0.9,
        },
      });
    }
    expect(await submitClass(cls.id, userId, cls.answers)).toMatchObject({
      passed: true,
      passedSections: 4,
    });
    expect(await instance.database.learnerVocab.findMany({ where: { courseId } })).toEqual(
      beforeVocab
    );
    expect(await instance.database.learnerGrammar.findMany({ where: { courseId } })).toEqual(
      beforeGrammar
    );
  });

  it('earlier speaking and writing attempts cannot satisfy a retake', async () => {
    const cls = await seedClass(requirements('CLASS', true, true));
    await instance.database.classSection.updateMany({
      where: { classId: cls.id, skill: { in: ['SPEAKING', 'WRITING'] } },
      data: { attempt: 2 },
    });
    await expect(submitClass(cls.id, userId, cls.answers)).rejects.toThrow(/speaking|writing/);
    expect(await instance.database.speakingRecording.count()).toBe(4);
    expect(await instance.database.writingResponse.count()).toBe(3);
  });
  it('serializes duplicate class submissions and reviews vocabulary once', async () => {
    const cls = await seedClass(requirements('CLASS', false, false));
    const [first, retry] = await Promise.all([
      submitClass(cls.id, userId, cls.answers),
      submitClass(cls.id, userId, cls.answers),
    ]);
    expect(retry).toEqual(first);
    expect(
      (await instance.database.learnerVocab.findFirstOrThrow({ where: { courseId } })).reps
    ).toBe(1);
    expect(await instance.database.classSubmission.count()).toBe(1);
  });
  it('serializes duplicate practice submissions and reopens the same result', async () => {
    const session = await seedPractice(requirements('FULL', false, false));
    const [first, retry] = await Promise.all([
      submitPractice(session.id, userId, session.answers),
      submitPractice(session.id, userId, session.answers),
    ]);
    expect(retry).toEqual(first);
    expect(
      (await instance.database.learnerVocab.findFirstOrThrow({ where: { courseId } })).reps
    ).toBe(1);
    expect((await resumePractice(session.id, userId)).submissionResult).toEqual(first);
  });
  it('rolls back grades, submissions and course advancement when SRS persistence fails', async () => {
    const cls = await seedClass(requirements('CLASS', false, false));
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION reject_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Review persistence unavailable'; END; $$`
    );
    await instance.database.$executeRawUnsafe(
      `CREATE TRIGGER reject_review BEFORE UPDATE ON "LearnerVocab" FOR EACH ROW EXECUTE FUNCTION reject_review()`
    );
    try {
      await expect(submitClass(cls.id, userId, cls.answers)).rejects.toThrow(
        /Review persistence unavailable/
      );
      expect(await instance.database.classSubmission.count()).toBe(0);
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
      ).toBe('AVAILABLE');
      expect(
        await instance.database.classSection.count({
          where: { classId: cls.id, passed: { not: null } },
        })
      ).toBe(0);
    } finally {
      await instance.database.$executeRawUnsafe(`DROP TRIGGER reject_review ON "LearnerVocab"`);
      await instance.database.$executeRawUnsafe(`DROP FUNCTION reject_review()`);
    }
  });
  it('restores owned answers and drafts without publishing answer keys', async () => {
    const session = await seedPractice(requirements('FULL', false, false));
    const prompt = await instance.database.writingPrompt.findFirstOrThrow({
      where: { practiceSessionId: session.id },
    });
    await saveLearningProgress('PRACTICE', session.id, userId, {
      expectedRevision: 0,
      answers: { g0: 2 },
      writingDrafts: { [prompt.id]: 'Buenas tardes.' },
    });
    const resumed = await resumePractice(session.id, userId);
    expect(resumed.learnerAnswers).toEqual({ g0: 2 });
    expect(resumed.writingDrafts).toEqual({ [prompt.id]: 'Buenas tardes.' });
    expect(resumed.progressRevision).toBe(1);
    await expect(
      saveLearningProgress('PRACTICE', session.id, userId, {
        expectedRevision: 0,
        answers: { g0: 0 },
      })
    ).rejects.toBeInstanceOf(LearningProgressConflict);
    expect((await resumePractice(session.id, userId)).learnerAnswers).toEqual({ g0: 2 });
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
    const session = await seedPractice(requirements('FULL', false, false));
    const answers = session.answers;
    answers[0]!.selectedIndex = 1;
    const result = await submitPractice(session.id, userId, answers);
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
    expect(await submitPractice(session.id, userId, [])).toEqual(result);
    expect((await resumePractice(session.id, userId)).submissionResult).toEqual(result);
  });

  it('reviews extracted reading words only through their assessed questions', async () => {
    const session = await seedPractice(requirements('FULL', false, false));
    await upsertLiveVocab(
      courseId,
      [
        { lemma: 'amigo', gloss: 'friend' },
        { lemma: 'buenas', gloss: 'good' },
      ],
      'A1',
      instance.database
    );
    await instance.database.practiceSession.update({
      where: { id: session.id },
      data: {
        vocabLemmas: ['hola', 'amigo', 'buenas'],
        items: (
          (await instance.database.practiceSession.findUniqueOrThrow({ where: { id: session.id } }))
            .items as Array<{ id: string; passageText?: string }>
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
    await submitPractice(session.id, userId, answers);
    const vocab = await instance.database.learnerVocab.findMany({
      where: { courseId },
      select: { lemma: true, reps: true, lapses: true, lastReviewed: true },
    });
    expect(vocab.find((word) => word.lemma === 'hola')?.reps).toBe(1);
    expect(vocab.find((word) => word.lemma === 'amigo')).toMatchObject({ reps: 0, lapses: 1 });
    expect(vocab.find((word) => word.lemma === 'buenas')?.lastReviewed).toBeNull();
  });

  it('leaves lesson vocabulary unreviewed when reading questions do not assess it', async () => {
    const cls = await seedClass(requirements('CLASS', false, false));
    await instance.database.learnerVocab.create({
      data: { courseId, lemma: 'amigo', translation: 'friend' },
    });
    await instance.database.lesson.update({
      where: { id: lessonId },
      data: {
        targetVocab: [
          { lemma: 'hola', gloss: 'hello' },
          { lemma: 'amigo', gloss: 'friend' },
        ],
      },
    });
    await submitClass(cls.id, userId, cls.answers);
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({
        where: { courseId_lemma: { courseId, lemma: 'amigo' } },
      })
    ).toMatchObject({ reps: 0, lastReviewed: null });
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({
        where: { courseId_lemma: { courseId, lemma: 'hola' } },
      })
    ).toMatchObject({ reps: 1 });
    await instance.database.lesson.update({
      where: { id: lessonId },
      data: { targetVocab: [{ lemma: 'hola', gloss: 'hello' }] },
    });
  });

  it('preserves both vocabulary reviews when different sessions finish concurrently', async () => {
    const first = await seedPractice(requirements('FULL', false, false));
    const second = await seedPractice(requirements('FULL', false, false));
    await Promise.all([
      submitPractice(first.id, userId, first.answers),
      submitPractice(second.id, userId, second.answers),
    ]);
    expect(
      (
        await instance.database.learnerVocab.findUniqueOrThrow({
          where: { courseId_lemma: { courseId, lemma: 'hola' } },
        })
      ).reps
    ).toBe(2);
  });
});
