// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import { registerPreludeCases } from './provenance/prelude-cases';
import type { PrismaClient } from '@/generated/prisma/client';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { authorizedLearnerExecution } from '../../../helpers/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import {
  emptyTeachingCriticFixture,
  shapeTeachingProviderFixture,
} from '../../classes/quality/intro-provider-fixture';
const binding = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  audioAdmissions: 0,
  realQueue: false,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (userId: string, execution: object) => ({
    provider: 'fixture',
    model: 'fixture',
    execution: { ...execution, userId },
  }),
  capturedLearningAiOptions: async () => ({ model: 'fixture' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/script-generator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/script-generator')>()),
  generateScript: async () => ({
    turns: [{ speaker: 'HOST', text: 'Мия пьёт воду.', direction: 'calm' }],
    soundCues: [],
    markdown: 'Мия пьёт воду.',
    references: [],
    vocabulary: [],
    places: [],
    model: 'fixture',
  }),
}));
vi.mock('@/lib/segment-creator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/segment-creator')>()),
  createSegmentsAndQueueAudio: async (
    _id: string,
    _turns: unknown,
    options: { onPrepared: (database: unknown, key: string) => Promise<void> }
  ) => {
    if (binding.realQueue) {
      const actual =
        await vi.importActual<typeof import('@/lib/segment-creator')>('@/lib/segment-creator');
      return actual.createSegmentsAndQueueAudio(
        _id,
        _turns as Parameters<typeof actual.createSegmentsAndQueueAudio>[1],
        options as Parameters<typeof actual.createSegmentsAndQueueAudio>[2]
      );
    }
    await binding.database!.$transaction((database) => options.onPrepared(database, 'fixture-key'));
    binding.audioAdmissions += 1;
  },
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema?: { name: string } }
    ) => {
      if (options.jsonSchema?.name === 'class_teaching_critic')
        return shapeTeachingProviderFixture(
          system,
          messages,
          options,
          emptyTeachingCriticFixture(messages, options)
        );
      if (options.jsonSchema?.name === 'class_teaching_adjudicator')
        return shapeTeachingProviderFixture(system, messages, options, {
          model: 'fixture',
          content: JSON.stringify({
            items: (
              JSON.parse(messages[0].content) as { items: Array<{ index: number }> }
            ).items.map(({ index }) => ({ index, acceptable: true, issues: [], feedback: [] })),
          }),
        });
      if (options.jsonSchema?.name === 'class_section_quality') {
        const input = JSON.parse(messages[0].content) as {
          questions: Array<{ index: number; options: string[] }>;
        };
        return {
          model: 'fixture',
          content: JSON.stringify({
            passageFindings: [],
            issues: [],
            questions: input.questions.map((question) => ({
              index: question.index,
              acceptableOptionIndices: [question.options.indexOf('вода')],
              issues: [],
            })),
          }),
        };
      }
      if (options.jsonSchema?.name === 'class_section_questions')
        return {
          model: 'fixture',
          content: JSON.stringify({
            passage: 'Мия пьёт воду.',
            questions: Array.from({ length: 5 }, (_, index) => ({
              taskContext: 'Elige la palabra indicada en este ejercicio.',
              question: `¿Qué palabra corresponde al agua? ${index + 1}`,
              options: ['вода', 'дом', 'кот', 'стол'],
              correctIndex: 0,
              explanation: 'Вода significa agua.',
              passageRef: '',
            })),
          }),
        };
      if (options.jsonSchema?.name === 'class_writing_prompts')
        return {
          model: 'fixture',
          content: JSON.stringify({
            prompts: ['Hola', 'Gracias', 'Agua'].map((sourceText, index) => ({
              taskType: 'translation',
              task: 'Traduce al ruso.',
              sourceText,
              modelAnswer: ['Привет', 'Спасибо', 'Вода'][index],
              guidance: null,
              ideas: null,
              starterText: null,
              correctionReason: null,
            })),
          }),
        };
      if (options.jsonSchema?.name === 'class_speaking_prompts')
        return {
          model: 'fixture',
          content: JSON.stringify({
            prompts: [
              ['Привет', 'Hola'],
              ['Спасибо', 'Gracias'],
              ['До свидания', 'Adiós'],
              ['Доброе утро', 'Buenos días'],
            ].map(([targetPhrase, translation]) => ({ targetPhrase, translation, ipa: null })),
          }),
        };
      if (options.jsonSchema?.name === 'class_listening_quiz')
        return {
          model: 'fixture',
          content: JSON.stringify({
            questions: Array.from({ length: 4 }, (_, index) => ({
              question: `¿Qué bebe Mия? ${index + 1}`,
              options: ['вода', 'дом', 'кот', 'стол'],
              correctIndex: 0,
              explanation: 'El diálogo menciona agua.',
            })),
          }),
        };
      return { model: 'fixture', content: JSON.stringify(sampleTeaching) };
    },
  }),
}));
import { generateClassTeaching, sealInitialA1TeachingSeed } from '@/lib/classes/lesson/teaching';
import { publishClassGeneration } from '@/lib/learning/classes/formative/class-generation-state';
import {
  bindInitialA1SectionReview,
  generateSectionQuestions,
  sealInitialA1SectionReviews,
} from '@/lib/class-generation';
import type { InitialA1SectionReceipt } from '@/lib/classes/quality/section-review/section-review-proof';
import { generateClassWriting, sealInitialA1WritingReview } from '@/lib/class-writing-generator';
import { generateClassSpeaking, sealInitialA1SpeakingReview } from '@/lib/class-speaking-generator';
import {
  prepareClassListening,
  queueListeningAudio,
  sealInitialA1ListeningReview,
} from '@/lib/class-listening-generator';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { checkConcurrentPrerequisiteAcknowledgment } from './provenance-race-cases';
import {
  acknowledgeInitialA1Provenance,
  initialA1MaterialHash,
  classTaskMaterialHash,
  readInitialA1Provenance,
  readClassTeachingPrelude,
  acknowledgeClassTeachingPrelude,
  requireInitialA1PracticeAccess,
} from '@/lib/classes/lesson/initial-a1-provenance';
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('initial A1 publication scope', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('initial_a_publication');
    binding.database = instance.database;
  });
  afterAll(async () => {
    binding.database = null;
    await instance?.close();
  });
  it.each([
    'skills',
    'course language',
    'lesson title',
    'lesson objective',
    'source title',
    'source URL',
    'outgoing source',
    'unchanged',
    'regenerated source',
    'URL without title',
    'modified reviewed key',
    'modified writing guidance',
    'modified writing ideas',
    'replaced writing prompt',
    'reordered writing tasks',
    'extra writing task',
    'duplicate writing section',
    'replacement writing section',
    'speaking unchanged',
    'speaking changed translation',
    'speaking changed task mode',
    'speaking changed reference',
    'speaking extra prompt',
    'speaking duplicate section',
    'speaking replacement section',
    'listening unchanged',
    'listening audio unchanged',
    'listening changed turn',
    'listening changed direction',
    'listening changed answer',
    'listening changed owner',
    'listening duplicate section',
    'listening replacement section',
    'listening changed before audio',
    'partial proof flags',
    'concurrent acknowledgment',
  ] as const)('binds publication to the reviewed context for %s', async (change) => {
    const { ownerId } = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'initial' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'initial',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Make a request',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
      update: { title: 'First lesson', objective: 'Make a request' },
    });
    const course = await instance.database.course.create({
      data: { userId: ownerId, curriculumId: curriculum.id, nativeLang: 'es', targetLang: 'ru' },
    });
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: change.startsWith('listening ') ? 'cartesia' : null,
      sttProvider: change.startsWith('speaking ') ? 'openai' : null,
    });
    const before =
      change === 'regenerated source'
        ? { title: 'Old source', url: 'https://example.com/old' }
        : {
            title: null,
            url: change === 'URL without title' ? 'https://example.com/source' : null,
          };
    const after =
      change === 'regenerated source'
        ? { title: 'New source', url: 'https://example.com/new' }
        : before;
    const cls = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 1,
        status: 'GENERATING',
        skillRequirements: requirements,
        sourceTitle: before.title,
        sourceUrl: before.url,
      },
    });
    const scope = {
      userId: ownerId,
      execution: { ...authorizedLearnerExecution(ownerId), initialA1Class: true },
      level: 'A1',
      nativeLang: 'es',
      targetLang: 'ru',
      title: lesson.title,
      objective: after.title ?? lesson.objective,
      grammarPoints: [],
      targetVocab: [],
      reviewScope: {
        classId: cls.id,
        courseId: course.id,
        attempt: 1,
        requirements,
        course: { nativeLang: 'es', targetLang: 'ru' },
        lesson: { id: lesson.id, title: lesson.title, objective: lesson.objective },
        sourceBefore: before,
        sourceAfter: after,
      },
    };
    const unit = await generateClassTeaching(scope);
    const seed = { teaching: unit };
    sealInitialA1TeachingSeed(seed, unit, scope);
    const changed = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: 'cartesia',
      sttProvider: null,
    });
    if (change === 'skills')
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { skillRequirements: changed },
      });
    if (change === 'course language')
      await instance.database.course.update({
        where: { id: course.id },
        data: { targetLang: 'de' },
      });
    if (change === 'lesson title')
      await instance.database.lesson.update({
        where: { id: lesson.id },
        data: { title: 'Changed title' },
      });
    if (change === 'lesson objective')
      await instance.database.lesson.update({
        where: { id: lesson.id },
        data: { objective: 'Changed objective' },
      });
    if (change === 'source title')
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { sourceTitle: 'Changed source' },
      });
    if (change === 'source URL')
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { sourceUrl: 'https://example.com/new' },
      });
    const valid = [
      'unchanged',
      'regenerated source',
      'URL without title',
      'speaking unchanged',
      'listening unchanged',
      'listening audio unchanged',
      'partial proof flags',
      'concurrent acknowledgment',
    ].includes(change);
    const writingChange = change.includes('writing');
    const speakingChange = change.startsWith('speaking ') && change !== 'speaking unchanged';
    const listeningChange = change.startsWith('listening ') && !valid;
    const exercisesPrepared =
      valid ||
      change === 'modified reviewed key' ||
      writingChange ||
      speakingChange ||
      listeningChange;
    if (exercisesPrepared) {
      const passage = 'Мия пьёт воду.';
      const receipts: InitialA1SectionReceipt[] = [];
      let firstQuestionId = '';
      for (const skill of ['GRAMMAR', 'READING'] as const) {
        const requirement = requirements.skills[skill];
        if (requirement.state !== 'REQUIRED') throw new Error('Missing fixture skill');
        const section = await instance.database.classSection.create({
          data: {
            classId: cls.id,
            attempt: 1,
            skill,
            status: 'READY',
            seed: skill,
            spec: {},
          },
        });
        {
          const sectionScope = {
            userId: ownerId,
            execution: scope.execution,
            skill,
            level: 'A1',
            nativeLang: 'es',
            targetLang: 'ru',
            objective: scope.objective,
            grammarPoints: [],
            targetVocab: [],
            seed: skill,
            teaching: unit,
            reviewScope: {
              classId: cls.id,
              courseId: course.id,
              sectionId: section.id,
              attempt: 1,
            },
          };
          const generated = await generateSectionQuestions(sectionScope);
          const assessed = generated.map((question) => ({
            ...structuredClone(question),
            learningAssessment: null,
          }));
          const ids: string[] = [];
          for (const [index, question] of assessed.entries()) {
            const saved = await instance.database.lessonQuestion.create({
              data: {
                sectionId: section.id,
                skill,
                order: index + 1,
                question: question.question,
                options: question.options,
                correctIndex: question.correctIndex,
                explanation: question.explanation,
                passageRef: question.passageRef ?? null,
                passageText: question.passageText ?? null,
              },
            });
            ids.push(saved.id);
          }
          firstQuestionId ||= ids[0]!;
          receipts.push(bindInitialA1SectionReview(generated, sectionScope, assessed, ids));
        }
      }
      sealInitialA1SectionReviews(seed, unit, receipts, {
        classId: cls.id,
        courseId: course.id,
        userId: ownerId,
        attempt: 1,
        skills: ['GRAMMAR', 'READING'],
        level: 'A1',
        nativeLang: 'es',
        targetLang: 'ru',
        objective: scope.objective,
        grammarPoints: [],
        targetVocab: [],
      });
      const writing = await generateClassWriting({
        userId: ownerId,
        execution: scope.execution,
        classId: cls.id,
        attempt: 1,
        level: 'A1',
        nativeLang: 'es',
        targetLang: 'ru',
        objective: scope.objective,
        targetVocab: [],
        teaching: unit,
        reviewScope: { courseId: course.id },
      });
      if (!writing.reviewReceipt) throw new Error('Missing writing review');
      sealInitialA1WritingReview(seed, unit, writing.reviewReceipt, {
        classId: cls.id,
        courseId: course.id,
        userId: ownerId,
        attempt: 1,
        level: 'A1',
        nativeLang: 'es',
        targetLang: 'ru',
        objective: scope.objective,
        targetVocab: [],
      });
      if (requirements.skills.LISTENING.state === 'REQUIRED') {
        const listening = await prepareClassListening({
          userId: ownerId,
          execution: scope.execution,
          classId: cls.id,
          courseId: course.id,
          attempt: 1,
          level: 'A1',
          nativeLang: 'es',
          targetLang: 'ru',
          objective: scope.objective,
          mustIncludeVocab: [],
          teaching: unit,
          ttsProvider: 'cartesia',
          deferAudio: true,
          requireInitialA1Proof: true,
        });
        if (!listening.reviewReceipt) throw new Error('Missing listening review');
        sealInitialA1ListeningReview(seed, unit, listening.reviewReceipt, {
          classId: cls.id,
          courseId: course.id,
          userId: ownerId,
          attempt: 1,
          level: 'A1',
          nativeLang: 'es',
          targetLang: 'ru',
          objective: scope.objective,
          mustIncludeVocab: [],
          ttsProvider: 'cartesia',
          deferAudio: true,
        });
        if (
          [
            'listening changed turn',
            'listening changed direction',
            'listening changed before audio',
          ].includes(change)
        ) {
          const turns = structuredClone(listening.content.turns);
          if (change === 'listening changed direction') turns[0]!.direction = 'loud';
          else turns[0]!.text = 'Изменено';
          await instance.database.script.update({
            where: { episodeId: listening.episodeId },
            data: { turns },
          });
        }
        if (change === 'listening changed answer') {
          const question = await instance.database.lessonQuestion.findFirstOrThrow({
            where: { sectionId: listening.sectionId },
          });
          await instance.database.lessonQuestion.update({
            where: { id: question.id },
            data: { correctIndex: 1 },
          });
        }
        if (change === 'listening changed owner') {
          const other = await instance.database.user.create({
            data: { email: `other-${ownerId}@example.test` },
          });
          await instance.database.episode.update({
            where: { id: listening.episodeId },
            data: { userId: other.id },
          });
        }
        if (change === 'listening duplicate section' || change === 'listening replacement section')
          await instance.database.classSection.create({
            data: {
              classId: cls.id,
              skill: 'LISTENING',
              attempt: change === 'listening duplicate section' ? 1 : 2,
              status: 'READY',
              seed: 'another-listening-section',
              spec: {},
            },
          });
        if (change === 'listening changed before audio') {
          binding.audioAdmissions = 0;
          const beforeJobs = await instance.database.$transaction((database) =>
            sottoJobOutbox(database).listIncomplete()
          );
          binding.realQueue = true;
          try {
            await expect(
              queueListeningAudio(listening.content, scope.execution, {
                classId: cls.id,
                attempt: 1,
                requireInitialA1Proof: true,
              })
            ).rejects.toThrow('Listening audio source changed before admission.');
          } finally {
            binding.realQueue = false;
          }
          const episode = await instance.database.episode.findUniqueOrThrow({
            where: { id: listening.episodeId },
          });
          expect(episode).toMatchObject({ status: 'SCRIPT_READY', audioGenerationKey: null });
          expect(
            await instance.database.segment.count({ where: { episodeId: listening.episodeId } })
          ).toBe(0);
          expect(
            await instance.database.$transaction((database) =>
              sottoJobOutbox(database).listIncomplete()
            )
          ).toEqual(beforeJobs);
        }
        if (change === 'listening audio unchanged') {
          binding.audioAdmissions = 0;
          await queueListeningAudio(listening.content, scope.execution, {
            classId: cls.id,
            attempt: 1,
          });
          expect(binding.audioAdmissions).toBe(1);
        }
      }
      if (requirements.skills.SPEAKING.state === 'REQUIRED') {
        const speaking = await generateClassSpeaking({
          ttsProvider: null,
          referenceAudioRequired: false,
          userId: ownerId,
          execution: scope.execution,
          classId: cls.id,
          attempt: 1,
          level: 'A1',
          nativeLang: 'es',
          targetLang: 'ru',
          objective: scope.objective,
          targetVocab: [],
          teaching: unit,
          reviewCourseId: course.id,
        });
        if (!speaking.reviewReceipt) throw new Error('Missing speaking review');
        sealInitialA1SpeakingReview(seed, unit, speaking.reviewReceipt, {
          classId: cls.id,
          courseId: course.id,
          userId: ownerId,
          attempt: 1,
          level: 'A1',
          nativeLang: 'es',
          targetLang: 'ru',
          objective: scope.objective,
          targetVocab: [],
          ttsProvider: null,
          referenceAudioRequired: false,
        });
        if (
          [
            'speaking changed translation',
            'speaking changed task mode',
            'speaking changed reference',
          ].includes(change)
        ) {
          const prompt = await instance.database.speakingPrompt.findFirstOrThrow({
            where: { sectionId: speaking.sectionId },
          });
          await instance.database.speakingPrompt.update({
            where: { id: prompt.id },
            data:
              change === 'speaking changed translation'
                ? { translation: 'Changed' }
                : change === 'speaking changed task mode'
                  ? { learningObjectives: { taskMode: 'COMMUNICATIVE' } }
                  : { referenceTtsUrl: 'changed-reference' },
          });
        }
        if (change === 'speaking extra prompt')
          await instance.database.speakingPrompt.create({
            data: {
              sectionId: speaking.sectionId,
              order: 5,
              targetPhrase: 'Привет',
              translation: 'Hola',
            },
          });
        if (change === 'speaking duplicate section' || change === 'speaking replacement section')
          await instance.database.classSection.create({
            data: {
              classId: cls.id,
              skill: 'SPEAKING',
              attempt: change === 'speaking duplicate section' ? 1 : 2,
              status: 'READY',
              seed: 'another-speaking-section',
              spec: {},
            },
          });
      }
      if (change === 'modified writing guidance') {
        const prompt = await instance.database.writingPrompt.findFirstOrThrow({
          where: { sectionId: writing.sectionId },
        });
        await instance.database.writingPrompt.update({
          where: { id: prompt.id },
          data: { guidance: 'Changed guidance' },
        });
      }
      if (change === 'modified writing ideas') {
        const prompt = await instance.database.writingPrompt.findFirstOrThrow({
          where: { sectionId: writing.sectionId },
        });
        await instance.database.writingPrompt.update({
          where: { id: prompt.id },
          data: { ideas: ['A changed opening'] },
        });
      }
      if (change === 'replaced writing prompt') {
        const prompt = await instance.database.writingPrompt.findFirstOrThrow({
          where: { sectionId: writing.sectionId },
          orderBy: { order: 'asc' },
        });
        await instance.database.writingPrompt.delete({ where: { id: prompt.id } });
        await instance.database.writingPrompt.create({
          data: {
            sectionId: writing.sectionId,
            order: prompt.order,
            task: prompt.task,
            guidance: prompt.guidance,
            ideas: prompt.ideas,
          },
        });
      }
      if (change === 'reordered writing tasks') {
        const prompts = await instance.database.writingPrompt.findMany({
          where: { sectionId: writing.sectionId },
          orderBy: { order: 'asc' },
        });
        await instance.database.writingPrompt.update({
          where: { id: prompts[0]!.id },
          data: { order: 99 },
        });
        await instance.database.writingPrompt.update({
          where: { id: prompts[1]!.id },
          data: { order: 1 },
        });
        await instance.database.writingPrompt.update({
          where: { id: prompts[0]!.id },
          data: { order: 2 },
        });
      }
      if (change === 'extra writing task')
        await instance.database.writingPrompt.create({
          data: { sectionId: writing.sectionId, order: 4, task: 'Changed task' },
        });
      if (change === 'duplicate writing section' || change === 'replacement writing section')
        await instance.database.classSection.create({
          data: {
            classId: cls.id,
            skill: 'WRITING',
            attempt: change === 'duplicate writing section' ? 1 : 2,
            status: 'READY',
            seed: 'another-writing-section',
            spec: {},
          },
        });
      if (change === 'modified reviewed key') {
        const original = await instance.database.lessonQuestion.findUniqueOrThrow({
          where: { id: firstQuestionId },
        });
        await instance.database.lessonQuestion.update({
          where: { id: firstQuestionId },
          data: { correctIndex: (original.correctIndex + 1) % 4 },
        });
      }
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: {
          readingVocabulary: {
            passageText: passage,
            sourceHash: createHash('sha256').update(passage).digest('hex'),
            words: [
              { lemma: 'вода', gloss: 'agua', pos: 'noun', sourceForm: 'воду', questionIds: [] },
            ],
          },
        },
      });
    }
    const publication = instance.database.$transaction((database) =>
      publishClassGeneration(database, {
        classId: cls.id,
        attempt: 1,
        userId: ownerId,
        requireInitialA1TeachingProof: true,
        requireInitialA1SectionProof: exercisesPrepared,
        requireInitialA1WritingProof: exercisesPrepared,
        requireInitialA1SpeakingProof: exercisesPrepared && change !== 'partial proof flags',
        requireInitialA1ListeningProof: exercisesPrepared,
        data: {
          adaptiveSeed: seed,
          ...(change === 'regenerated source'
            ? { sourceTitle: after.title, sourceUrl: after.url }
            : {}),
          ...(change === 'outgoing source' ? { sourceTitle: 'Injected source' } : {}),
        },
      })
    );
    if (valid) {
      await expect(publication).resolves.toBeUndefined();
      const published = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(published).toMatchObject({
        status: 'AVAILABLE',
        sourceTitle: after.title,
        sourceUrl: after.url,
      });
      if (change === 'partial proof flags') {
        expect(published.prerequisiteGate).toBeNull();
        expect(await readInitialA1Provenance(instance.database, cls.id, scope.execution)).toEqual({
          status: 'UNREVIEWED',
        });
      } else {
        expect(published.prerequisiteGate).toMatchObject({
          version: 1,
          classId: cls.id,
          courseId: course.id,
          userId: ownerId,
          attempt: 1,
          receiptId: expect.any(String),
          materialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        const beforeProgress = await initialA1MaterialHash(instance.database, cls.id, ownerId);
        if (change === 'speaking unchanged') {
          const prompt = await instance.database.speakingPrompt.findFirstOrThrow({
            where: { section: { classId: cls.id } },
          });
          await instance.database.speakingPrompt.update({
            where: { id: prompt.id },
            data: { referenceTtsUrl: 'https://example.com/refreshed-audio' },
          });
          expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).toBe(
            beforeProgress
          );
          await instance.database.speakingPrompt.update({
            where: { id: prompt.id },
            data: { referenceTtsUrl: prompt.referenceTtsUrl },
          });
        }
        if (change === 'listening unchanged') {
          const section = await instance.database.classSection.findFirstOrThrow({
            where: { classId: cls.id, skill: 'LISTENING' },
          });
          if (!section.episodeId) throw new Error('Missing listening episode');
          const episode = await instance.database.episode.findUniqueOrThrow({
            where: { id: section.episodeId },
          });
          await instance.database.episode.update({
            where: { id: episode.id },
            data: { audioUrl: 'https://example.com/refreshed-audio' },
          });
          expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).toBe(
            beforeProgress
          );
          await instance.database.episode.update({
            where: { id: episode.id },
            data: { audioUrl: episode.audioUrl },
          });
        }
        if (change === 'unchanged') {
          const first = await instance.database.lessonQuestion.findFirstOrThrow({
            where: { section: { classId: cls.id } },
          });
          await instance.database.lessonQuestion.update({
            where: { id: first.id },
            data: { correctIndex: first.correctIndex === 0 ? 1 : 0 },
          });
          expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).not.toBe(
            beforeProgress
          );
          await instance.database.lessonQuestion.update({
            where: { id: first.id },
            data: { correctIndex: first.correctIndex },
          });
          expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).toBe(
            beforeProgress
          );
        }
        const initial = await readInitialA1Provenance(instance.database, cls.id, scope.execution);
        const prelude = await readClassTeachingPrelude(instance.database, cls.id, scope.execution);
        const requirePractice = () =>
          instance.database.$transaction((database) =>
            requireInitialA1PracticeAccess(database, cls.id, ownerId)
          );
        await expect(requirePractice()).rejects.toThrow('Review the prerequisite teaching');
        expect(prelude).toMatchObject({ kind: 'BASE', acknowledged: false });
        expect(JSON.stringify(prelude)).not.toContain('guidedPractice');
        expect(JSON.stringify(prelude)).not.toContain('correctIndex');
        expect(JSON.stringify(prelude)).not.toContain('materialHash');
        expect(JSON.stringify(prelude)).not.toContain('¿Qué palabra corresponde al agua?');
        expect(JSON.stringify(prelude)).not.toContain(unit.guidedPractice.answer);
        expect(initial).toMatchObject({ status: 'REVIEWED', acknowledged: false });
        expect(initial).not.toHaveProperty('materialHash');
        if (initial.status !== 'REVIEWED') throw new Error('Missing reviewed receipt');
        if (change === 'concurrent acknowledgment') {
          await checkConcurrentPrerequisiteAcknowledgment(
            instance,
            cls.id,
            initial.receiptId,
            scope.execution
          );
          return;
        }
        await expect(
          acknowledgeClassTeachingPrelude(
            instance.database,
            {
              classId: cls.id,
              kind: 'ADDENDUM',
              receiptId: initial.receiptId,
            },
            scope.execution
          )
        ).rejects.toThrow('prerequisite teaching changed');
        await expect(
          acknowledgeClassTeachingPrelude(
            instance.database,
            {
              classId: cls.id,
              kind: 'BASE',
              receiptId: initial.receiptId,
            },
            scope.execution
          )
        ).resolves.toMatchObject({ kind: 'BASE', acknowledged: true });
        expect(
          await readClassTeachingPrelude(instance.database, cls.id, scope.execution)
        ).toMatchObject({ kind: 'BASE', acknowledged: true });
        await expect(requirePractice()).resolves.toBeUndefined();
        const cancelled = new AbortController();
        cancelled.abort(new Error('Acknowledgment cancelled'));
        await expect(
          acknowledgeInitialA1Provenance(
            instance.database,
            { classId: cls.id, receiptId: initial.receiptId },
            { ...scope.execution, signal: cancelled.signal }
          )
        ).rejects.toThrow('Acknowledgment cancelled');
        await expect(
          acknowledgeInitialA1Provenance(
            instance.database,
            { classId: cls.id, receiptId: 'other-receipt' },
            scope.execution
          )
        ).rejects.toThrow('prerequisite teaching changed');
        const ack = () =>
          acknowledgeInitialA1Provenance(
            instance.database,
            { classId: cls.id, receiptId: initial.receiptId },
            scope.execution
          );
        await expect(ack()).resolves.toMatchObject({ status: 'REVIEWED', acknowledged: true });
        await expect(ack()).resolves.toMatchObject({ status: 'REVIEWED', acknowledged: true });
        await expect(
          readInitialA1Provenance(
            instance.database,
            cls.id,
            authorizedLearnerExecution('other-user')
          )
        ).rejects.toThrow('prerequisite teaching changed');
        const revoked = { ...scope.execution, authorize: async () => ({ userId: 'other-user' }) };
        await expect(readInitialA1Provenance(instance.database, cls.id, revoked)).rejects.toThrow(
          'prerequisite teaching changed'
        );
        await expect(
          acknowledgeInitialA1Provenance(
            instance.database,
            { classId: cls.id, receiptId: initial.receiptId },
            revoked
          )
        ).rejects.toThrow('prerequisite teaching changed');
        await instance.database.courseClass.update({
          where: { id: cls.id },
          data: {
            learnerAnswers: { existing: 1 },
            writingDrafts: { existing: 'saved' },
            progressRevision: 1,
          },
        });
        expect(await initialA1MaterialHash(instance.database, cls.id, ownerId)).toBe(
          beforeProgress
        );
        expect(
          await readInitialA1Provenance(instance.database, cls.id, scope.execution)
        ).toMatchObject({ status: 'REVIEWED', acknowledged: true });
        const question = await instance.database.lessonQuestion.findFirstOrThrow({
          where: { section: { classId: cls.id } },
        });
        await instance.database.lessonQuestion.update({
          where: { id: question.id },
          data: { explanation: 'Changed explanation' },
        });
        expect(await initialA1MaterialHash(instance.database, cls.id, ownerId)).not.toBe(
          beforeProgress
        );
        await expect(requirePractice()).rejects.toThrow('Review the prerequisite teaching');
        expect(await readInitialA1Provenance(instance.database, cls.id, scope.execution)).toEqual({
          status: 'STALE',
        });
        await expect(ack()).rejects.toThrow('prerequisite teaching changed');
      }
      expect(
        (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } }))
          .activeClassId
      ).toBe(cls.id);
      return;
    }
    await expect(publication).rejects.toThrow(
      listeningChange
        ? 'The reviewed listening material changed before publication.'
        : speakingChange
          ? 'The reviewed speaking tasks changed before publication.'
          : writingChange
            ? 'The reviewed writing tasks changed before publication.'
            : change === 'modified reviewed key'
              ? 'The reviewed exercises changed before publication.'
              : 'Class generation was cancelled'
    );
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({ status: 'GENERATING', prerequisiteGate: null });
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })).activeClassId
    ).toBeNull();
  });
  registerPreludeCases(() => instance);
});
