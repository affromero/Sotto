import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { expect, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
} from '@/lib/sidedoor/storage/core/episode-storage';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { processWaveformGeneration } from '@/workers/waveform-generation.worker';

export async function exerciseOptionalWaveformImage(options: {
  database: PrismaClient;
  episodeId: string;
  directory: string;
  job: Job;
  loseCommit: (id: string) => void;
}) {
  const { database, episodeId, directory, job } = options;
  const storage = await sottoTransaction(database, (tx) => captureEpisodeStorage(tx, episodeId));
  const consumer = `episode:${episodeId}:spectrogram`;
  const previous = await writeStorageReference({
    database,
    signal: new AbortController().signal,
    prefix: `episodes/${episodeId}/spectrogram`,
    extension: 'png',
    contentType: 'image/png',
    body: Buffer.from('previous image'),
    captureAdmission: async (tx) => {
      await validateEpisodeStorage(tx, episodeId, storage);
      return { ...storage, consumer, snapshot: null };
    },
    validateAdmission: (tx) => validateEpisodeStorage(tx, episodeId, storage),
    previousReference: () => null,
    commit: async (tx, spectrogramUrl) => {
      await tx.episode.update({ where: { id: episodeId }, data: { spectrogramUrl } });
    },
  });
  const { stdout } = await promisify(execFile)('which', ['ffmpeg']);
  const wrapper = join(directory, 'spectrogram-fault');
  await mkdir(wrapper);
  const quoted = "'" + stdout.trim().replace(/'/g, "'\\''") + "'";
  await writeFile(
    join(wrapper, 'ffmpeg'),
    '#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in *showspectrumpic*) exit 17;; esac\ndone\nexec ' +
      quoted +
      ' "$@"\n',
    { mode: 0o755 }
  );
  const originalPath = process.env.PATH;
  vi.stubEnv('PATH', `${wrapper}:${originalPath}`);
  options.loseCommit(job.id!);
  try {
    await processWaveformGeneration(job);
    const episode = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(episode.waveformUrl).toBeTruthy();
    expect(episode.spectrogramUrl).toBeNull();
    const peaks: unknown = JSON.parse(
      await readFile(
        join(directory, episode.waveformUrl!.replace(/^\/api\/v1\/storage\//, '')),
        'utf8'
      )
    );
    expect(peaks).toHaveLength(200);
    expect(
      await readFile(join(directory, previous.replace(/^\/api\/v1\/storage\//, '')), 'utf8')
    ).toBe('previous image');
    await sottoTransaction(database, async (tx) => {
      const registry = new StorageReferenceRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await expect(registry.resolve({ consumer, reference: previous })).rejects.toThrow(
        'Storage reference does not belong to this consumer'
      );
      expect((await registry.listRetirements()).retirements).toEqual(
        expect.arrayContaining([expect.objectContaining({ consumer, previousReference: previous })])
      );
      expect((await sottoJobOutbox(tx).read(job.id!))?.complete).toBe(true);
    });
    await processWaveformGeneration(job);
    expect(
      (await database.episode.findUniqueOrThrow({ where: { id: episodeId } })).spectrogramUrl
    ).toBeNull();
  } finally {
    vi.stubEnv('PATH', originalPath);
  }
}
