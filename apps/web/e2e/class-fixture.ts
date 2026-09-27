import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

export async function seedClass() {
  const user = await database.user.findFirstOrThrow();
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
      storageProvider: 'local',
      localStorageRoot: join(process.env.SOTTO_BROWSER_DIRECTORY!, 'storage'),
    },
    user.id
  );
  invalidateServerInfra();
  const curriculum = await database.curriculum.create({
    data: {
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
  const course = await database.course.create({
    data: { userId: user.id, nativeLang: 'en', targetLang: 'de', curriculumId: curriculum.id },
  });
  const cls = await database.courseClass.create({
    data: {
      courseId: course.id,
      lessonId: curriculum.lessons[0].id,
      order: 1,
      status: 'AVAILABLE',
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
  for (const skill of ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const) {
    const section = await database.classSection.create({
      data: {
        classId: cls.id,
        skill,
        seed: randomUUID(),
        spec: { objective: 'Greet a friend' },
        status: 'READY',
        ...(skill === 'LISTENING' ? { episodeId: episode.id } : {}),
      },
    });
    if (skill === 'SPEAKING')
      await database.speakingPrompt.create({
        data: {
          sectionId: section.id,
          order: 1,
          targetPhrase: 'Guten Morgen.',
          translation: 'Good morning.',
        },
      });
    else if (skill === 'WRITING')
      await database.writingPrompt.create({
        data: {
          sectionId: section.id,
          order: 1,
          task: 'Greet a friend.',
          guidance: 'Write a short greeting.',
        },
      });
    else
      await database.lessonQuestion.create({
        data: {
          sectionId: section.id,
          order: 1,
          skill,
          question: `Choose the greeting (${skill.toLowerCase()}).`,
          options: ['Hallo', 'Danke', 'Bitte', 'Tschüss'],
          correctIndex: 0,
          explanation: 'Hallo is a greeting.',
          ...(skill === 'READING' ? { passageText: 'Anna sagt Hallo zu ihrem Freund.' } : {}),
        },
      });
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
  return { classId: cls.id, courseId: course.id };
}
