import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSkillRequirements, learningSkills, type SkillType } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import {
  prepareStorageBackend,
  prepareStorageReference,
  StorageBackendRegistry,
  StorageReferenceRegistry,
} from 'thesidedoor-core/storage';
import { prismaUnfiltered as database } from '@/lib/prisma';
import { setSiteConfig } from '@/lib/site-config';
import { invalidateServerInfra } from '@/lib/server-config';
import { captureStorageBackend } from '@/lib/r2';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { publishSpeakingPromptReferences } from '@/lib/class-speaking-generator';
import { executeMediaProcess } from '@/lib/audio/media-process';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { extractReadingVocabulary } from '@/lib/learning/reading-vocabulary';
import { upsertLiveVocab } from '@/lib/knowledge-graph';
import {
  assertStoredClassMaterial,
  classQuestionMaterialSchema,
} from '@/lib/learning/classes/class-material';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export async function seedClass() {
  const user = await database.user.findFirstOrThrow();
  const execution: SottoProviderExecution = {
    userId: user.id,
    authorize: async (transaction) => {
      await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
      return { userId: user.id };
    },
  };
  await database.user.update({
    where: { id: user.id },
    data: {
      hasCompletedOnboarding: true,
      preferredAiProvider: 'local',
      preferredAiModel: 'local:browser-fixture',
      preferredSttModel: 'browser-fixture',
    },
  });
  await setSiteConfig(
    {
      aiProvider: 'local',
      aiModel: 'browser-fixture',
      aiBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
      sttProvider: 'local',
      sttBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
      sttModel: 'browser-fixture',
      ttsProvider: 'local',
      ttsBaseUrl: process.env.SOTTO_BROWSER_PROVIDER!,
      storageProvider: 'local',
      localStorageRoot: join(process.env.SOTTO_BROWSER_DIRECTORY!, 'storage'),
    },
    user.id
  );
  invalidateServerInfra();
  const curriculum = await database.curriculum.upsert({
    where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
    update: {},
    create: {
      nativeLang: 'en',
      targetLang: 'de',
      title: 'German greetings',
      lessons: {
        create: {
          level: 'A1',
          order: 1,
          slug: 'greetings',
          title: 'Greeting friends',
          objective: 'Greet a friend',
          grammarPoints: ['present'],
          vocabThemes: ['greetings'],
          targetVocab: [{ lemma: 'Hallo', gloss: 'hello' }],
        },
      },
    },
    include: { lessons: true },
  });
  const course = await database.course.upsert({
    where: {
      userId_nativeLang_targetLang: { userId: user.id, nativeLang: 'en', targetLang: 'de' },
    },
    update: {},
    create: { userId: user.id, nativeLang: 'en', targetLang: 'de', curriculumId: curriculum.id },
  });
  const requirements = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A1',
    ttsProvider: 'local',
    sttProvider: 'local',
  });
  const counts = Object.fromEntries(
    learningSkills.map((skill) => {
      const requirement = requirements.skills[skill];
      if (requirement.state !== 'REQUIRED') throw new Error('Browser class requires every skill');
      return [skill, requirement.expectedCount];
    })
  ) as Record<SkillType, number>;
  const cls = await database.courseClass.create({
    data: {
      courseId: course.id,
      lessonId: curriculum.lessons[0].id,
      order: 1,
      status: 'AVAILABLE',
      skillRequirements: requirements as unknown as Prisma.InputJsonValue,
    },
  });
  await database.course.update({ where: { id: course.id }, data: { activeClassId: cls.id } });
  const episode = await database.episode.create({
    data: {
      userId: user.id,
      title: 'Morning greeting',
      topic: 'Greeting friends',
      source: 'CLASS',
      visibility: 'PRIVATE',
      language: 'de',
      status: 'READY',
      duration: 8,
    },
  });
  const speakingPrompts: Array<{ id: string; targetPhrase: string; translation: string }> = [];
  const turns = [{ speaker: 'HOST', text: 'Anna sagt Hallo zu ihrem Freund.' }];
  await database.script.create({
    data: { episodeId: episode.id, turns, markdown: 'HOST: Anna sagt Hallo zu ihrem Freund.' },
  });
  for (const skill of learningSkills) {
    const section = await database.classSection.create({
      data: {
        classId: cls.id,
        skill,
        seed: randomUUID(),
        spec: {
          objective: 'Greet a friend',
          ...(skill === 'LISTENING' ? { scriptHash: learningScriptHash(turns) } : {}),
        },
        status: 'READY',
        ...(skill === 'LISTENING' ? { episodeId: episode.id } : {}),
      },
    });
    for (let index = 0; index < counts[skill]; index++) {
      if (skill === 'SPEAKING') {
        const prompt = await database.speakingPrompt.create({
          data: {
            sectionId: section.id,
            order: index + 1,
            targetPhrase: 'Guten Morgen.',
            translation: 'Good morning.',
          },
        });
        speakingPrompts.push({
          id: prompt.id,
          targetPhrase: 'Guten Morgen.',
          translation: 'Good morning.',
        });
      } else if (skill === 'WRITING')
        await database.writingPrompt.create({
          data: {
            sectionId: section.id,
            order: index + 1,
            task: 'Greet a friend.',
            guidance: 'Write a short greeting.',
          },
        });
      else
        await database.lessonQuestion.create({
          data: {
            sectionId: section.id,
            order: index + 1,
            skill,
            question: `Choose the greeting (${skill.toLowerCase()}).`,
            options: ['Hallo', 'Danke', 'Bitte', 'Tschüss'],
            correctIndex: 0,
            explanation: 'Hallo is a greeting.',
            ...(skill === 'READING' ? { passageText: 'Anna sagt Hallo zu ihrem Freund.' } : {}),
          },
        });
    }
  }
  const backend = await captureStorageBackend();
  const key = `browser/${episode.id}.wav`;
  const reference = await backend.writeBuffer(
    key,
    await readFile(join(process.env.SOTTO_BROWSER_DIRECTORY!, 'microphone.wav')),
    'audio/wav'
  );
  await sottoTransaction(database, async (tx) => {
    const preparedBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const ownership = await captureEpisodeStorage(tx, episode.id);
    const prepared = prepareStorageReference({
      namespace: SIDEDOOR_STATE_ID,
      operationId: randomUUID(),
      reference,
      localRoutePrefix: '/api/v1/storage',
      target: { backendId: preparedBackend.id, binding: preparedBackend.binding, key },
      scopes: ownership.scopes,
    });
    const executor = {
      query: (sql: string, values: readonly unknown[]) =>
        tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    };
    await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
      preparedBackend
    );
    await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
      consumers: [{ consumer: `episode:${episode.id}:audio`, previousReference: null }],
      next: prepared,
    });
    await tx.episode.update({ where: { id: episode.id }, data: { audioUrl: reference } });
  });
  const referencePath = join(process.env.SOTTO_BROWSER_DIRECTORY!, `${cls.id}-reference.mp3`);
  await executeMediaProcess('ffmpeg', [
    '-n',
    '-i',
    join(process.env.SOTTO_BROWSER_DIRECTORY!, 'microphone.wav'),
    '-c:a',
    'libmp3lame',
    referencePath,
  ]);
  const referenceAudio = await readFile(referencePath);
  await publishSpeakingPromptReferences({
    required: true,
    userId: user.id,
    execution,
    prompts: speakingPrompts.map((prompt) => ({
      id: prompt.id,
      composed: { ...prompt, ipa: null, referenceTtsAudio: referenceAudio },
    })),
  });
  const readingQuestions = await database.lessonQuestion.findMany({
    where: { section: { classId: cls.id }, skill: 'READING' },
    orderBy: { order: 'asc' },
  });
  const readingVocabulary = await extractReadingVocabulary({
    userId: user.id,
    execution,
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A1',
    questions: readingQuestions.map((question) => ({
      id: question.id,
      passageText: question.passageText,
      ...classQuestionMaterialSchema.parse(question),
    })),
  });
  await upsertLiveVocab(course.id, readingVocabulary.words, 'A1', database);
  await database.courseClass.update({
    where: { id: cls.id },
    data: { readingVocabulary: readingVocabulary as unknown as Prisma.InputJsonValue },
  });
  await assertStoredClassMaterial(database, cls.id);
  return { classId: cls.id, courseId: course.id, counts };
}
