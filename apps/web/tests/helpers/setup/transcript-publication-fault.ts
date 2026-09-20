import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { expect, vi } from 'vitest';
import {
  LocalStorageWriter,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  StorageWriteJournal,
  prepareStorageCleanup,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { processPdfGeneration } from '@/workers/pdf-generation.worker';

export async function exerciseTranscriptPublicationFault(options: {
  database: PrismaClient;
  job: Job<unknown>;
  episodeId: string;
  directory: string;
  fault: 'deletion during transcript upload' | 'rejected transcript publication';
}): Promise<'cancelled' | 'retry'> {
  const { database, job, episodeId, directory, fault } = options;
  const executor = (tx: Prisma.TransactionClient) => ({
    query: (sql: string, values: readonly unknown[]) =>
      tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  });
  const episode = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
  const cleanup = prepareStorageCleanup({
    namespace: SIDEDOOR_STATE_ID,
    subjectId: `episode:${episodeId}`,
    generation: episode.createdAt.getTime(),
    retentionPolicy: 'job-id-snapshots-v1',
  });
  const write = LocalStorageWriter.prototype.writeImmutable;
  const interception = vi
    .spyOn(LocalStorageWriter.prototype, 'writeImmutable')
    .mockImplementation(async function (this: LocalStorageWriter, ...args) {
      await write.apply(this, args);
      if (fault !== 'deletion during transcript upload' || !args[0].startsWith('transcripts/'))
        return;
      await sottoTransaction(database, async (tx) => {
        await new StorageCleanupJournal(executor(tx), 'postgres', SIDEDOOR_STATE_ID).createJob(
          cleanup
        );
        await tx.episode.delete({ where: { id: episodeId } });
      });
    });
  try {
    if (fault === 'rejected transcript publication') {
      await database.$executeRawUnsafe(
        'ALTER TABLE "Episode" ADD CONSTRAINT reject_transcript CHECK ("pdfUrl" IS NULL)'
      );
      await expect(processPdfGeneration(job)).rejects.toThrow();
      expect((await database.episode.findUniqueOrThrow({ where: { id: episodeId } })).pdfUrl).toBe(
        episode.pdfUrl
      );
    } else {
      await processPdfGeneration(job);
      expect(await database.episode.findUnique({ where: { id: episodeId } })).toBeNull();
      await processPdfGeneration(job);
    }
    await sottoTransaction(database, async (tx) => {
      const writes = await new StorageWriteJournal(
        executor(tx),
        'postgres',
        SIDEDOOR_STATE_ID
      ).list(`episode:${episodeId}`);
      const transcripts = writes.intents.filter((intent) =>
        intent.target.key.startsWith('transcripts/')
      );
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toMatchObject({ status: 'settled', outcome: 'unreferenced' });
      expect(await readFile(join(directory, transcripts[0]!.target.key), 'utf8')).toContain(
        `# ${episode.title}`
      );
      const references = await new StorageReferenceRegistry(
        executor(tx),
        'postgres',
        SIDEDOOR_STATE_ID
      ).listAssets();
      expect(
        references.assets.filter((asset) => asset.prepared.target.key.startsWith('transcripts/'))
      ).toEqual([]);
      expect((await sottoJobOutbox(tx).read(job.id!))?.complete).toBe(
        fault === 'deletion during transcript upload'
      );
    });
  } finally {
    interception.mockRestore();
    if (fault === 'rejected transcript publication')
      await database.$executeRawUnsafe(
        'ALTER TABLE "Episode" DROP CONSTRAINT IF EXISTS reject_transcript'
      );
  }
  return fault === 'deletion during transcript upload' ? 'cancelled' : 'retry';
}
