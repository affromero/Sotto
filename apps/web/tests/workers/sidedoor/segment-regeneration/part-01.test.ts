// @vitest-environment node
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import {
  audioStitchingQueue,
  episodeStatusQueue,
  pdfGenerationQueue,
  segmentRegenerationQueue,
  waveformGenerationQueue,
} from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { invalidateServerInfra } from '@/lib/server-config';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  captureIncorporation,
  commitIncorporation,
  prepareIncorporation,
} from '@/lib/sidedoor/jobs/stitch/incorporation';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
} from '@/lib/sidedoor/storage/core/episode-storage';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { setSiteConfig } from '@/lib/site-config';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import { processPdfGeneration } from '@/workers/pdf-generation.worker';
import { processSegmentRegeneration } from '@/workers/segment-regeneration.worker';
import type { Job } from 'bullmq';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exerciseDurableWaveform,
  waveformScenarios,
} from '../../../helpers/runtime/durable-waveform-case';
import { createRegenerationSource } from '../../../helpers/runtime/regeneration-source';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import { exerciseTranscriptPublicationFault } from '../../../helpers/setup/transcript-publication-fault';

const binding = vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated Redis 15');
    vi.stubEnv('REDIS_URL', configured);
  }
  return {
    database: null as PrismaClient | null,
    loseCommit: null as string | null,
    redisUrl: configured,
    cleanupPaths: [] as string[],
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(binding), {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== '$transaction') return value;
      return async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(value, target, args);
        if (binding.loseCommit) {
          const records = await binding.database!.$queryRawUnsafe<Array<{ complete: string }>>(
            `SELECT state->>'complete' AS complete FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'id' = $1`,
            binding.loseCommit
          );
          if (records[0]?.complete === 'true') {
            binding.loseCommit = null;
            throw new Error('Lost response after committed transaction');
          }
        }
        return result;
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('durable segment regeneration with PostgreSQL, Redis and local files', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  let duringSpeech: (() => Promise<void>) | null;
  let requests: Array<Record<string, unknown>>;
  let jobs: string[];
  let stitchJobs: string[];
  let pdfJobs: string[];
  const audio = Buffer.alloc(32044);
  audio.write('RIFF');
  audio.writeUInt32LE(32036, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(32000, 40);
  for (let sample = 0; sample < 16000; sample++)
    audio.writeInt16LE(
      Math.round(6000 * Math.sin((2 * Math.PI * 440 * sample) / 16000)),
      44 + sample * 2
    );
  beforeAll(async () => {
    instance = await createSharedTestInstance('durable_regeneration');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    directory = await mkdtemp(join(tmpdir(), 'sotto-durable-regen-'));
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    if (binding.redisUrl) vi.stubEnv('REDIS_URL', binding.redisUrl);
    vi.stubEnv('TTS_BASE_URL', 'http://tts.example.test');
    await setSiteConfig(
      {
        storageProvider: 'local',
        localStorageRoot: directory,
        ttsProvider: 'local',
        ttsBaseUrl: 'http://tts.example.test',
        ttsVoices: 'voice-a,voice-b',
      },
      identity.ownerId
    );
    invalidateServerInfra();
    duringSpeech = null;
    binding.loseCommit = null;
    requests = [];
    jobs = [];
    stitchJobs = [];
    pdfJobs = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      if (request.url !== 'http://tts.example.test/tts')
        throw new Error(`Unexpected provider request ${request.url}`);
      requests.push(await request.json());
      await duringSpeech?.();
      return new Response(new Uint8Array(audio));
    });
  });
  afterEach(async () => {
    for (const path of binding.cleanupPaths.splice(0))
      await rm(path, { recursive: true, force: true });
    for (const id of jobs) await (await segmentRegenerationQueue.getJob(id))?.remove();
    for (const id of stitchJobs) await (await audioStitchingQueue.getJob(id))?.remove();
    for (const id of pdfJobs) await (await pdfGenerationQueue.getJob(id))?.remove();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await segmentRegenerationQueue.close();
    await audioStitchingQueue.close();
    await pdfGenerationQueue.close();
    await waveformGenerationQueue.close();
    await episodeStatusQueue.close();
    await closeRedis();
    await instance?.close();
    binding.database = null;
  });
  async function fixture(withHistory = false, attributed = true) {
    const { episode, interaction } = await createRegenerationSource(
      instance.database,
      identity.ownerId,
      directory,
      audio,
      withHistory,
      attributed
    );
    const request = new Request('http://localhost/incorporate', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      captureIncorporation(tx, request, episode.id, interaction.id)
    );
    const prepared = prepareIncorporation(admission, 'An explanation');
    const record = await sottoTransaction(instance.database, (tx) =>
      commitIncorporation(tx, request, admission, prepared)
    );
    await deliverSottoJob({
      database: instance.database,
      queue: segmentRegenerationQueue,
      operationId: prepared.id,
      version: 1,
    });
    jobs.push(prepared.id);
    const job = (await segmentRegenerationQueue.getJob(prepared.id))! as Job;
    return { episode, interaction, record, job };
  }
  it.each([
    'normal',
    'rejected fingerprint',
    'changed storage root',
    'changed storage root after preflight',
    'newer transcript version',
    'lost transcript commit response',
    'deletion during transcript upload',
    'rejected transcript publication',
    ...waveformScenarios,
  ])('preserves playable version history with %s', async (scenario) => {
    const rejectFingerprint = scenario === 'rejected fingerprint';
    const item = await fixture(true);
    await writeFile(
      join(directory, 'fpcalc'),
      '#!/bin/sh\nprintf \'%s\' \'{"duration":2,"fingerprint":[123,456]}\'\n',
      { mode: 0o755 }
    );
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`);
    if (rejectFingerprint)
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "AudioFingerprint" ADD CONSTRAINT reject_fingerprint CHECK (false)'
      );
    try {
      await processSegmentRegeneration(item.job);
      let outputDirectory = directory;
      if (scenario === 'changed storage root') {
        outputDirectory = join(directory, 'new-root');
        await mkdir(outputDirectory);
        await setSiteConfig({ localStorageRoot: outputDirectory }, identity.ownerId);
        invalidateServerInfra();
      }
      const incomplete = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).listIncomplete()
      );
      const stitchId = incomplete.jobs[0]!.id;
      await deliverSottoJob({
        database: instance.database,
        queue: audioStitchingQueue,
        operationId: stitchId,
        version: 1,
      });
      stitchJobs.push(stitchId);
      const stitchJob = (await audioStitchingQueue.getJob(stitchId))! as Job;
      if (scenario === 'changed storage root after preflight') {
        const laterRoot = join(directory, 'later-root');
        await mkdir(laterRoot);
        const updateProgress = stitchJob.updateProgress.bind(stitchJob);
        stitchJob.updateProgress = async (progress) => {
          await updateProgress(progress);
          if (progress === 50) {
            await setSiteConfig({ localStorageRoot: laterRoot }, identity.ownerId);
            invalidateServerInfra();
          }
        };
      }
      await processAudioStitching(stitchJob);
      if (scenario === 'changed storage root after preflight') {
        await setSiteConfig({ localStorageRoot: directory }, identity.ownerId);
        invalidateServerInfra();
      }
      const episode = await instance.database.episode.findUniqueOrThrow({
        where: { id: item.episode.id },
      });
      expect(episode).toMatchObject({ status: 'READY', currentVersion: 2 });
      const savedFingerprint = await instance.database.audioFingerprint.findUnique({
        where: { episodeId: episode.id },
      });
      if (rejectFingerprint) expect(savedFingerprint).toBeNull();
      else expect(savedFingerprint).toMatchObject({ fingerprint: [123, 456], duration: 2 });
      const versions = await instance.database.episodeVersion.findMany({
        where: { episodeId: episode.id },
        orderBy: { version: 'asc' },
        include: { segments: true },
      });
      expect(versions).toHaveLength(2);
      expect(versions[0]?.audioUrl).toBe('/api/v1/storage/previous.mp3');
      expect(versions[1]).toMatchObject({
        audioUrl: episode.audioUrl,
        interactionId: item.interaction.id,
        changeType: 'incorporation',
      });
      expect(versions[1]?.segments).toHaveLength(3);
      const bytes = await readFile(
        join(outputDirectory, episode.audioUrl!.replace(/^\/api\/v1\/storage\//, ''))
      );
      expect(bytes.length).toBe(episode.fileSize);
      expect(bytes.length).toBeGreaterThan(100);
      if (scenario === 'changed storage root')
        await expect(
          readFile(join(directory, episode.audioUrl!.replace(/^\/api\/v1\/storage\//, '')))
        ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(directory, 'previous.mp3'))).toEqual(audio);
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(stitchId)))
          ?.complete
      ).toBe(true);
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete()))
          .jobs
      ).toHaveLength(4);
      await processAudioStitching(stitchJob);
      expect(
        await instance.database.episodeVersion.count({ where: { episodeId: episode.id } })
      ).toBe(2);
      const effects = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).listIncomplete()
      );
      let pdfId: string | undefined;
      for (const effect of effects.jobs) {
        const record = await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(effect.id)
        );
        if (record?.job.handler === 'pdf-generation') pdfId = effect.id;
      }
      expect(pdfId).toBeDefined();
      await deliverSottoJob({
        database: instance.database,
        queue: pdfGenerationQueue,
        operationId: pdfId!,
        version: 1,
      });
      pdfJobs.push(pdfId!);
      const pdfJob = (await pdfGenerationQueue.getJob(pdfId!))! as Job;
      if (
        scenario === 'deletion during transcript upload' ||
        scenario === 'rejected transcript publication'
      ) {
        const outcome = await exerciseTranscriptPublicationFault({
          database: instance.database,
          job: pdfJob,
          episodeId: episode.id,
          directory: outputDirectory,
          fault: scenario,
        });
        if (outcome === 'cancelled') return;
      }
      if (scenario === 'lost transcript commit response') binding.loseCommit = pdfId!;
      if (scenario === 'newer transcript version') {
        const ownership = await sottoTransaction(instance.database, (tx) =>
          captureEpisodeStorage(tx, episode.id)
        );
        const consumer = `episode:${episode.id}:transcript`;
        let replacement: string | null = null;
        const progress = pdfJob.updateProgress.bind(pdfJob);
        vi.spyOn(pdfJob, 'updateProgress').mockImplementation(async (value) => {
          await progress(value);
          if (value !== 30) return;
          replacement = await writeStorageReference({
            database: instance.database,
            signal: new AbortController().signal,
            prefix: 'transcripts',
            extension: 'md',
            contentType: 'text/markdown',
            body: Buffer.from('Newer transcript'),
            captureAdmission: async (tx) => {
              await validateEpisodeStorage(tx, episode.id, ownership);
              return { ...ownership, consumer, snapshot: null };
            },
            validateAdmission: (tx) => validateEpisodeStorage(tx, episode.id, ownership),
            previousReference: () => episode.pdfUrl,
            commit: async (tx, pdfUrl) => {
              await tx.episode.update({
                where: { id: episode.id },
                data: {
                  currentVersion: { increment: 1 },
                  lastCompletedStitchKey: 'newer-stitch',
                  pdfUrl,
                },
              });
            },
          });
        });
        await expect(processPdfGeneration(pdfJob)).rejects.toThrow(
          'Transcript episode version changed'
        );
        expect(
          (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).pdfUrl
        ).toBe(replacement);
        expect(replacement).not.toBeNull();
        await sottoTransaction(instance.database, async (tx) => {
          const registry = new StorageReferenceRegistry(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            SIDEDOOR_STATE_ID
          );
          expect(
            (await registry.resolve({ consumer, reference: replacement! }))?.prepared.reference
          ).toBe(replacement);
          expect((await sottoJobOutbox(tx).read(pdfId!))?.complete).toBe(false);
        });
        expect(
          await readFile(
            join(outputDirectory, replacement!.replace(/^\/api\/v1\/storage\//, '')),
            'utf8'
          )
        ).toBe('Newer transcript');
        return;
      }
      await processPdfGeneration(pdfJob);
      const published = await instance.database.episode.findUniqueOrThrow({
        where: { id: episode.id },
      });
      const transcript = await readFile(
        join(outputDirectory, published.pdfUrl!.replace(/^\/api\/v1\/storage\//, '')),
        'utf8'
      );
      expect(transcript).toContain(`# ${episode.title}`);
      expect(transcript).toContain('An explanation');
      await processPdfGeneration(pdfJob);
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).pdfUrl
      ).toBe(published.pdfUrl);
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(pdfId!)))
          ?.complete
      ).toBe(true);
      if (scenario === 'normal' || scenario.startsWith('waveform '))
        await exerciseDurableWaveform({
          database: instance.database,
          episodeId: episode.id,
          directory: outputDirectory,
          scenario,
          trackWorkspace: (workspace) => {
            binding.cleanupPaths.push(workspace);
          },
          configureStorage: async (root) => {
            await setSiteConfig({ localStorageRoot: root }, identity.ownerId);
            invalidateServerInfra();
          },
          failCleanup: async (workspace) => {
            const original = `${workspace}-original`;
            binding.cleanupPaths.push(workspace, original);
            await rename(workspace, original);
            await mkdir(workspace, { mode: 0o700 });
          },
          loseCommit: (id) => {
            binding.loseCommit = id;
          },
        });
    } finally {
      if (rejectFingerprint)
        await instance.database.$executeRawUnsafe(
          'ALTER TABLE "AudioFingerprint" DROP CONSTRAINT reject_fingerprint'
        );
    }
  });
  it.each(['none', 'rollback', 'lost-response'])(
    'records oversized audio failure durably (%s)',
    async (fault) => {
      const item = await fixture(true);
      await processSegmentRegeneration(item.job);
      const pending = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).listIncomplete()
      );
      const stitchId = pending.jobs[0]!.id;
      await deliverSottoJob({
        database: instance.database,
        queue: audioStitchingQueue,
        operationId: stitchId,
        version: 1,
      });
      stitchJobs.push(stitchId);
      const stitchJob = (await audioStitchingQueue.getJob(stitchId))! as Job;
      await writeFile(join(directory, 'ffprobe'), "#!/bin/sh\nprintf '3000\\n'\n", { mode: 0o755 });
      vi.stubEnv('PATH', `${directory}:${process.env.PATH}`);
      if (fault === 'rollback')
        await instance.database.$executeRawUnsafe(
          `ALTER TABLE "SidedoorState" ADD CONSTRAINT reject_failed_status CHECK (state->'job'->>'handler' IS DISTINCT FROM 'episode-status')`
        );
      if (fault === 'lost-response') binding.loseCommit = stitchId;
      try {
        if (fault === 'none') await processAudioStitching(stitchJob);
        else await expect(processAudioStitching(stitchJob)).rejects.toThrow();
        const current = await instance.database.episode.findUniqueOrThrow({
          where: { id: item.episode.id },
        });
        expect(current).toMatchObject({
          audioUrl: item.episode.audioUrl,
          currentVersion: 1,
          status: fault === 'rollback' ? 'STITCHING' : 'FAILED',
        });
        expect(await instance.database.episodeVersion.count()).toBe(1);
        expect(
          (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(stitchId)))
            ?.complete
        ).toBe(fault !== 'rollback');
        const remaining = await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).listIncomplete()
        );
        if (fault === 'rollback') {
          expect(remaining.jobs.map((job) => job.id)).toEqual([stitchId]);
          expect(current.failedAt).toBeNull();
        } else {
          expect(current).toMatchObject({
            failedAtStatus: 'STITCHING',
            failedAt: expect.any(Date),
            technicalError: 'Duration 3000s exceeded max 2640s',
          });
          expect(current.failureReason).toContain('shorter duration target');
          expect(remaining.jobs).toHaveLength(2);
          const effects = await sottoTransaction(instance.database, async (tx) => {
            const records = [];
            for (const job of remaining.jobs) records.push(await sottoJobOutbox(tx).read(job.id));
            return records;
          });
          expect(effects).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                job: expect.objectContaining({
                  handler: 'episode-status',
                  payload: expect.objectContaining({
                    status: 'FAILED',
                    parentOperationId: stitchId,
                  }),
                }),
              }),
              expect.objectContaining({
                job: expect.objectContaining({
                  handler: 'notifications',
                  payload: expect.objectContaining({
                    type: 'EPISODE_FAILED',
                    parentOperationId: stitchId,
                  }),
                }),
              }),
            ])
          );
          await processAudioStitching(stitchJob);
          expect(
            (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete()))
              .jobs
          ).toEqual(remaining.jobs);
        }
      } finally {
        if (fault === 'rollback')
          await instance.database.$executeRawUnsafe(
            'ALTER TABLE "SidedoorState" DROP CONSTRAINT reject_failed_status'
          );
      }
    }
  );
  it('restores prior attribution when an application callback rejects a replacement', async () => {
    const item = await fixture(false, false);
    const ownership = await sottoTransaction(instance.database, (tx) =>
      captureEpisodeStorage(tx, item.episode.id)
    );
    const consumer = `episode:${item.episode.id}:audio`;
    const references = (tx: Prisma.TransactionClient) =>
      new StorageReferenceRegistry(
        {
          query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
    const write = (previousReference: string | null, reject: boolean) =>
      writeStorageReference({
        database: instance.database,
        signal: new AbortController().signal,
        prefix: `episodes/${item.episode.id}/audio`,
        extension: 'mp3',
        contentType: 'audio/mpeg',
        body: audio,
        captureAdmission: async (tx) => {
          await validateEpisodeStorage(tx, item.episode.id, ownership);
          return { ...ownership, consumer, snapshot: null };
        },
        validateAdmission: (tx) => validateEpisodeStorage(tx, item.episode.id, ownership),
        previousReference: () => previousReference,
        commit: async (tx, audioUrl) => {
          await tx.episode.update({ where: { id: item.episode.id }, data: { audioUrl } });
          const resolved = await references(tx).resolve({ consumer, reference: audioUrl });
          expect(resolved?.prepared.reference).toBe(audioUrl);
          if (reject) throw new Error('Application publication rejected');
        },
      });
    const original = await write(null, false);
    await expect(write(original, true)).rejects.toThrow('Application publication rejected');
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } }))
        .audioUrl
    ).toBe(original);
    await sottoTransaction(instance.database, async (tx) => {
      expect(
        (await references(tx).resolve({ consumer, reference: original }))?.prepared.reference
      ).toBe(original);
      expect((await references(tx).listAssets()).assets).toHaveLength(1);
      expect((await references(tx).listRetirements()).retirements).toHaveLength(0);
    });
  });
  it.each([false, true])(
    'commits current and historical audio references together (registry failure=%s)',
    async (reject) => {
      const item = await fixture(false, false);
      const ownership = await sottoTransaction(instance.database, (tx) =>
        captureEpisodeStorage(tx, item.episode.id)
      );
      const consumers = [`episode:${item.episode.id}:audio`, 'episode-version:fixed-version:audio'];
      if (reject)
        await instance.database.$executeRawUnsafe(
          `ALTER TABLE "SidedoorState" ADD CONSTRAINT reject_grouped CHECK (state->>'kind' != 'storage_asset' OR jsonb_array_length(state->'consumers') <= 1)`
        );
      try {
        const write = writeStorageReference({
          database: instance.database,
          signal: new AbortController().signal,
          prefix: `episodes/${item.episode.id}/audio`,
          extension: 'mp3',
          contentType: 'audio/mpeg',
          body: audio,
          captureAdmission: async (tx) => {
            await validateEpisodeStorage(tx, item.episode.id, ownership);
            return {
              ...ownership,
              consumer: consumers[0]!,
              additionalConsumers: [{ consumer: consumers[1]!, previousReference: null }],
              snapshot: null,
            };
          },
          validateAdmission: (tx) => validateEpisodeStorage(tx, item.episode.id, ownership),
          previousReference: () => null,
          commit: async (tx, audioUrl) => {
            await tx.episode.update({ where: { id: item.episode.id }, data: { audioUrl } });
            await tx.episodeVersion.create({
              data: {
                id: 'fixed-version',
                episodeId: item.episode.id,
                version: 1,
                audioUrl,
                changeType: 'incorporation',
              },
            });
          },
        });
        if (reject) {
          await expect(write).rejects.toThrow();
          expect(await instance.database.episodeVersion.count()).toBe(0);
          expect(
            (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } }))
              .audioUrl
          ).toBeNull();
          return;
        }
        const url = await write;
        expect(
          (
            await instance.database.episodeVersion.findUniqueOrThrow({
              where: { id: 'fixed-version' },
            })
          ).audioUrl
        ).toBe(url);
        expect(
          (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } }))
            .audioUrl
        ).toBe(url);
        const assets = await sottoTransaction(instance.database, (tx) =>
          new StorageReferenceRegistry(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            SIDEDOOR_STATE_ID
          ).listAssets()
        );
        expect(assets.assets).toHaveLength(1);
        expect(assets.assets[0]?.consumers).toEqual([...consumers].sort());
      } finally {
        if (reject)
          await instance.database.$executeRawUnsafe(
            'ALTER TABLE "SidedoorState" DROP CONSTRAINT reject_grouped'
          );
      }
    }
  );
});
