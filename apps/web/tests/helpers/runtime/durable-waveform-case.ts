import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { expect, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { waveformGenerationQueue } from '@/lib/queue';
import { sottoJobOutbox, deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  LocalStorageWriter,
  LocalStorageWriteError,
  StorageReferenceRegistry,
  StorageWriteJournal,
} from 'thesidedoor-core/storage';
import { processWaveformGeneration } from '@/workers/waveform-generation.worker';
import { exerciseOptionalWaveformImage } from '../setup/waveform-optional-image';
import { exerciseEpisodeInvalidation } from './episode-invalidation';
import {
  exerciseWaveformExecution,
  waveformExecutionScenarios,
} from '../setup/waveform-execution-case';

export const waveformScenarios = [
  ...waveformExecutionScenarios,
  'waveform historical source',
  'waveform wrong attribution',
  'waveform lost commit response',
  'waveform second upload failure',
  'waveform publication rollback',
  'waveform optional image failure',
  'waveform newer version',
];

export async function exerciseDurableWaveform(options: {
  database: PrismaClient;
  episodeId: string;
  directory: string;
  scenario: string;
  loseCommit: (id: string) => void;
  failCleanup: (directory: string) => Promise<void>;
  trackWorkspace: (directory: string) => void;
  configureStorage: (directory: string) => Promise<void>;
}): Promise<void> {
  const { database, episodeId, scenario } = options;
  const pending = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).listIncomplete());
  let operationId: string | undefined;
  for (const entry of pending.jobs) {
    const record = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(entry.id));
    if (record?.job.handler === 'waveform-generation') operationId = entry.id;
  }
  expect(operationId).toBeDefined();
  await deliverSottoJob({
    database,
    queue: waveformGenerationQueue,
    operationId: operationId!,
    version: 1,
  });
  const job = (await waveformGenerationQueue.getJob(operationId!))! as Job;
  let directory = options.directory;
  try {
    if (waveformExecutionScenarios.includes(scenario)) {
      await exerciseWaveformExecution({ ...options, job });
      return;
    }
    if (scenario === 'normal') await exerciseEpisodeInvalidation(database, episodeId);
    if (scenario === 'waveform optional image failure') {
      await exerciseOptionalWaveformImage({ ...options, job });
      return;
    }
    if (scenario === 'waveform newer version') {
      const progress = job.updateProgress.bind(job);
      const interception = vi.spyOn(job, 'updateProgress').mockImplementation(async (value) => {
        await progress(value);
        if (value === 30)
          await database.episode.update({
            where: { id: episodeId },
            data: { currentVersion: { increment: 1 }, lastCompletedStitchKey: 'newer-version' },
          });
      });
      try {
        await expect(processWaveformGeneration(job)).rejects.toThrow(
          'Waveform episode version changed'
        );
        const episode = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
        expect(episode.lastCompletedStitchKey).toBe('newer-version');
        expect(episode.waveformUrl).toBeNull();
        expect(episode.spectrogramUrl).toBeNull();
        expect(
          (await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(operationId!)))
            ?.complete
        ).toBe(false);
      } finally {
        interception.mockRestore();
      }
      return;
    }
    if (scenario === 'waveform historical source') {
      directory = join(directory, 'waveform-destination');
      await mkdir(directory);
      await options.configureStorage(directory);
    }
    if (scenario === 'waveform wrong attribution') {
      await database.episodeVersion.updateMany({
        where: { episodeId },
        data: { interactionId: null },
      });
      await expect(processWaveformGeneration(job)).rejects.toThrow(
        'Waveform source version attribution changed'
      );
      const unchanged = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
      expect(unchanged.waveformUrl).toBeNull();
      expect(unchanged.spectrogramUrl).toBeNull();
      expect(
        (await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(operationId!)))?.complete
      ).toBe(false);
      return;
    }
    if (scenario === 'waveform lost commit response') options.loseCommit(operationId!);
    if (
      scenario === 'waveform second upload failure' ||
      scenario === 'waveform publication rollback'
    ) {
      const write = LocalStorageWriter.prototype.writeImmutable;
      const interception = vi
        .spyOn(LocalStorageWriter.prototype, 'writeImmutable')
        .mockImplementation(async function (this: LocalStorageWriter, ...args) {
          await write.apply(this, args);
          if (scenario === 'waveform second upload failure' && args[0].includes('/spectrogram/'))
            throw new LocalStorageWriteError(
              true,
              new Error('Injected spectrogram upload failure')
            );
        });
      try {
        if (scenario === 'waveform publication rollback')
          await database.$executeRawUnsafe(
            'ALTER TABLE "Episode" ADD CONSTRAINT reject_waveform CHECK ("waveformUrl" IS NULL AND "spectrogramUrl" IS NULL)'
          );
        await expect(processWaveformGeneration(job)).rejects.toThrow();
        const unchanged = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
        expect(unchanged.waveformUrl).toBeNull();
        expect(unchanged.spectrogramUrl).toBeNull();
        await sottoTransaction(database, async (tx) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          const writes = await new StorageWriteJournal(
            executor,
            'postgres',
            SIDEDOOR_STATE_ID
          ).list(`episode:${episodeId}`);
          const artifacts = writes.intents.filter((intent) =>
            /\/(waveform|spectrogram)\//.test(intent.target.key)
          );
          expect(artifacts).toHaveLength(2);
          for (const artifact of artifacts) {
            expect(artifact).toMatchObject({ status: 'settled', outcome: 'unreferenced' });
            expect((await readFile(join(directory, artifact.target.key))).length).toBeGreaterThan(
              0
            );
          }
          const references = await new StorageReferenceRegistry(
            executor,
            'postgres',
            SIDEDOOR_STATE_ID
          ).listAssets();
          expect(
            references.assets.filter((asset) =>
              /\/(waveform|spectrogram)\//.test(asset.prepared.target.key)
            )
          ).toEqual([]);
          expect((await sottoJobOutbox(tx).read(operationId!))?.complete).toBe(false);
        });
      } finally {
        interception.mockRestore();
        if (scenario === 'waveform publication rollback')
          await database.$executeRawUnsafe(
            'ALTER TABLE "Episode" DROP CONSTRAINT IF EXISTS reject_waveform'
          );
      }
    }
    await processWaveformGeneration(job);
    const episode = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(episode.waveformUrl).toBeTruthy();
    expect(episode.spectrogramUrl).toBeTruthy();
    const path = (reference: string) =>
      join(directory, reference.replace(/^\/api\/v1\/storage\//, ''));
    const peaks: unknown = JSON.parse(await readFile(path(episode.waveformUrl!), 'utf8'));
    expect(Array.isArray(peaks)).toBe(true);
    expect(peaks).toHaveLength(200);
    expect(
      (peaks as number[]).every((peak) => Number.isFinite(peak) && peak >= 0 && peak <= 1)
    ).toBe(true);
    expect((peaks as number[]).some((peak) => peak > 0)).toBe(true);
    expect((await readFile(path(episode.spectrogramUrl!))).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    await sottoTransaction(database, async (tx) => {
      const registry = new StorageReferenceRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      const waveform = await registry.resolve({
        consumer: `episode:${episodeId}:waveform`,
        reference: episode.waveformUrl!,
      });
      const spectrogram = await registry.resolve({
        consumer: `episode:${episodeId}:spectrogram`,
        reference: episode.spectrogramUrl!,
      });
      expect(waveform).not.toBeNull();
      expect(spectrogram).not.toBeNull();
      expect(waveform!.prepared.target.key).not.toBe(spectrogram!.prepared.target.key);
      expect((await sottoJobOutbox(tx).read(operationId!))?.complete).toBe(true);
    });
    await processWaveformGeneration(job);
    const replayed = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(replayed.waveformUrl).toBe(episode.waveformUrl);
    expect(replayed.spectrogramUrl).toBe(episode.spectrogramUrl);
  } finally {
    await job.remove();
  }
}
