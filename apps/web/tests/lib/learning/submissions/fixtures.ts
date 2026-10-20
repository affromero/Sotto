import { createHash } from 'node:crypto';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { captureSpeakingPromptStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createSkillRequirements, learningSkills, type SkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import { ensureLearningLevelBinding, readBoundCatalog } from '@/lib/learning-map/binding';
import {
  objectiveTaskFingerprint,
  reviewedObjectiveAssessmentSchema,
  type ObjectiveTask,
} from '@/lib/learning-map/evidence/protocol';
export function createSubmissionFixture(binding: { database: PrismaClient | null }, label: string) {
  let instance: SharedTestInstance;
  let userId: string;
  let courseId: string;
  let lessonId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance(label);
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
  async function reviewedGrammarTask(task: ObjectiveTask) {
    return instance.database.$transaction(async (database) => {
      const course = await database.course.findUniqueOrThrow({ where: { id: courseId } });
      const pinned = await ensureLearningLevelBinding(
        database,
        course,
        'A1',
        requirements('CLASS', false, false)
      );
      const { catalog } = readBoundCatalog(pinned);
      const objective = catalog.nodes.find(
        (node) =>
          node.kind === 'OBJECTIVE' && node.level === 'A1' && node.skills.includes('GRAMMAR')
      );
      if (objective?.kind !== 'OBJECTIVE')
        throw new Error('Expected an authored A1 grammar criterion.');
      const criterion = {
        objectiveId: objective.id,
        criterionVersion: objective.criterionVersion,
        policyVersion: objective.policyVersion,
        level: objective.level,
        skill: 'GRAMMAR' as const,
        assessment: objective.skillCriteria.GRAMMAR!,
      };
      const assessment = reviewedObjectiveAssessmentSchema.parse({
        schemaVersion: 1,
        scope: {
          schemaVersion: 1,
          courseId,
          userId,
          bindingId: pinned.id,
          catalogHash: pinned.revision.catalogHash,
          targetLang: 'es',
          level: 'A1',
          criteria: [criterion],
        },
        criterion,
        task,
        taskFingerprint: objectiveTaskFingerprint('es', criterion, task),
        review: {
          protocol: 'DIRECT_CRITERION_ELICITATION_V1',
          provider: 'test-boundary',
          model: 'synthetic-reviewed-fixture',
          inputSha256: '1'.repeat(64),
          responseSha256: '2'.repeat(64),
          elicitationQuote: task.kind === 'KEYED_MULTIPLE_CHOICE' ? task.question : task.task,
          rationale: 'Synthetic criterion review fixture binds the committed exact keyed task.',
        },
      });
      return { assessment, objective };
    });
  }
  return {
    get instance() {
      return instance;
    },
    get userId() {
      return userId;
    },
    get courseId() {
      return courseId;
    },
    get lessonId() {
      return lessonId;
    },
    requirements,
    publishReference,
    seedClass,
    seedPractice,
    reviewedGrammarTask,
  };
}
