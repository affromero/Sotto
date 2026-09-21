import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  StorageReferenceRegistry,
  StorageBackendRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { captureStorageBackend } from '@/lib/r2';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

export async function createRegenerationSource(
  database: PrismaClient,
  ownerId: string,
  directory: string,
  audio: Buffer,
  withHistory = false,
  attributed = true
) {
  await writeFile(join(directory, 'before.mp3'), audio);
  await writeFile(join(directory, 'after.mp3'), audio);
  if (withHistory) await writeFile(join(directory, 'previous.mp3'), audio);
  const episode = await database.episode.create({
    data: {
      userId: ownerId,
      title: 'Lesson',
      topic: 'Spanish',
      status: 'READY',
      language: 'es',
      ttsProvider: 'local',
      ttsModel: 'chosen-model',
      ...(withHistory ? { audioUrl: '/api/v1/storage/previous.mp3', currentVersion: 1 } : {}),
      segments: {
        create: [
          {
            order: 0,
            speaker: 'HOST',
            text: 'Before',
            startTime: 0,
            duration: 1,
            audioUrl: '/api/v1/storage/before.mp3',
          },
          {
            order: 1,
            speaker: 'EXPERT',
            text: 'After',
            startTime: 1,
            duration: 1,
            audioUrl: '/api/v1/storage/after.mp3',
          },
        ],
      },
    },
  });
  if (withHistory)
    await database.episodeVersion.create({
      data: {
        episodeId: episode.id,
        version: 1,
        audioUrl: '/api/v1/storage/previous.mp3',
        changeType: 'initial',
      },
    });
  const interaction = await database.interaction.create({
    data: {
      episodeId: episode.id,
      userId: ownerId,
      question: 'Why?',
      answer: 'Because.',
      timestamp: 0.5,
      status: 'ANSWERED',
    },
  });
  if (attributed) {
    const backend = await captureStorageBackend();
    const registration = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    await sottoTransaction(database, async (tx) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registration
      );
      const references = new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
      const ownership = await captureEpisodeStorage(tx, episode.id);
      for (const segment of await tx.segment.findMany({ where: { episodeId: episode.id } })) {
        const reference = segment.audioUrl!;
        await references.replace({
          consumer: `segment:${segment.id}:audio`,
          previousReference: null,
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference,
            localRoutePrefix: '/api/v1/storage',
            scopes: ownership.scopes,
            target: {
              backendId: registration.id,
              binding: registration.binding,
              key: backend.normalize(reference),
            },
          }),
        });
      }
    });
  }
  return { episode, interaction };
}
