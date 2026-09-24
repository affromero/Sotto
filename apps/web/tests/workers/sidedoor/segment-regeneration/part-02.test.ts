// @vitest-environment node
import type { PrismaClient } from '@/generated/prisma/client';
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
import { setSiteConfig } from '@/lib/site-config';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import { processSegmentRegeneration } from '@/workers/segment-regeneration.worker';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegenerationSource } from '../../../helpers/runtime/regeneration-source';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

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
  it('publishes one immutable segment and queues exact stitching inputs in the same commit', async () => {
    const item = await fixture();
    await processSegmentRegeneration(item.job);
    const segments = await instance.database.segment.findMany({
      where: { episodeId: item.episode.id },
      orderBy: { order: 'asc' },
    });
    expect(segments.map((segment) => [segment.order, segment.text])).toEqual([
      [0, 'Before'],
      [1, 'An explanation'],
      [2, 'After'],
    ]);
    const inserted = segments[1]!;
    expect(inserted.duration).toBeCloseTo(1);
    expect(
      await readFile(join(directory, inserted.audioUrl!.replace(/^\/api\/v1\/storage\//, '')))
    ).toEqual(audio);
    expect(requests).toEqual([expect.objectContaining({ model: 'chosen-model', language: 'es' })]);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(item.record.job.id)
    );
    expect(record).toMatchObject({ complete: true });
    const incomplete = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).listIncomplete()
    );
    expect(incomplete.jobs).toHaveLength(1);
    const stitching = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(incomplete.jobs[0]!.id)
    );
    expect(stitching).toMatchObject({
      job: {
        handler: 'audio-stitching',
        scopes: item.record.job.scopes,
        payload: {
          parentOperationId: item.record.job.id,
          previousAudio: {
            audioUrl: item.episode.audioUrl,
            currentVersion: item.episode.currentVersion,
            lastCompletedStitchKey: item.episode.lastCompletedStitchKey,
          },
          skipSfx: true,
          segmentIds: segments.map((segment) => segment.id),
          segmentVersions: [1, 1, 1],
          segmentAudioUrls: segments.map((segment) => segment.audioUrl),
        },
      },
    });
    expect(
      await instance.database.interaction.findUniqueOrThrow({ where: { id: item.interaction.id } })
    ).toMatchObject({ incorporated: true, status: 'INCORPORATED' });
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
    ).toMatchObject({ status: 'STITCHING' });
    await processSegmentRegeneration(item.job);
    expect(requests).toHaveLength(1);
    expect(await instance.database.segment.count({ where: { episodeId: item.episode.id } })).toBe(
      3
    );
  });
  it('rejects a queued stitch when a segment voice changes before processing', async () => {
    const item = await fixture(true);
    await processSegmentRegeneration(item.job);
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
    await instance.database.segment.updateMany({
      where: { episodeId: item.episode.id, order: 0 },
      data: { ttsVoiceId: 'changed-voice' },
    });
    const job = (await audioStitchingQueue.getJob(stitchId))! as Job;
    await expect(processAudioStitching(job)).rejects.toThrow(
      'Stitching inputs or ownership changed'
    );
    expect(await instance.database.episodeVersion.count()).toBe(1);
    expect(
      await instance.database.episode.findUniqueOrThrow({
        where: { id: item.episode.id },
      })
    ).toMatchObject({ status: 'STITCHING', audioUrl: item.episode.audioUrl });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(stitchId))
    ).toMatchObject({ complete: false });
  });
  it('requires explicit imported attribution before processing unowned work', async () => {
    const item = await fixture(false, false);
    await expect(processSegmentRegeneration(item.job)).rejects.toThrow(
      'explicit imported attribution'
    );
    expect(requests).toEqual([]);
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
    ).toMatchObject({ status: 'UPDATING' });
    expect(
      await instance.database.interaction.findUniqueOrThrow({ where: { id: item.interaction.id } })
    ).toMatchObject({ status: 'INCORPORATING', incorporated: false });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(item.record.job.id))
    ).toMatchObject({ complete: false });
  });
  it('rejects a queued stitch when its source consumer has been retired', async () => {
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
    const segment = await instance.database.segment.findFirstOrThrow({
      where: { episodeId: item.episode.id },
      orderBy: { order: 'asc' },
    });
    await sottoTransaction(instance.database, (tx) =>
      new StorageReferenceRegistry(
        {
          query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).retire({
        consumer: `segment:${segment.id}:audio`,
        previousReference: segment.audioUrl!,
        operationId: randomUUID(),
      })
    );
    const job = (await audioStitchingQueue.getJob(stitchId))! as Job;
    await expect(processAudioStitching(job)).rejects.toThrow('does not belong to this consumer');
    expect(await instance.database.episodeVersion.count()).toBe(1);
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
    ).toMatchObject({ status: 'STITCHING', audioUrl: item.episode.audioUrl });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(stitchId))
    ).toMatchObject({ complete: false });
  });
  it('discards generated speech when the source changes before publication', async () => {
    const item = await fixture();
    duringSpeech = async () => {
      await instance.database.interaction.update({
        where: { id: item.interaction.id },
        data: { answer: 'Changed answer' },
      });
    };
    await expect(processSegmentRegeneration(item.job)).rejects.toMatchObject({ status: 409 });
    expect(await instance.database.segment.count({ where: { episodeId: item.episode.id } })).toBe(
      2
    );
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(item.record.job.id))
    ).toMatchObject({ complete: false });
  });
  it.each(['network failure', 'cancellation'] as const)(
    'retains the execution workspace after provider %s following dispatch',
    async (fault) => {
      const item = await fixture();
      const controller = new AbortController();
      const failure = new Error(
        fault === 'cancellation' ? 'Worker cancelled' : 'Provider disconnected'
      );
      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
        const request = new Request(url, init);
        requests.push(await request.json());
        if (fault === 'cancellation') controller.abort(failure);
        throw failure;
      });
      await expect(processSegmentRegeneration(item.job, controller.signal)).rejects.toThrow();
      const rows = await instance.database.$queryRawUnsafe<
        Array<{
          state: {
            status: string;
            workspace?: { directory?: { root?: string } };
          };
        }>
      >(
        `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'job_execution' AND state->>'parentId' = $1`,
        item.record.job.id
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state.status).toBe('cleanup-unconfirmed');
      const workspace = rows[0]?.state.workspace?.directory?.root;
      expect(workspace).toBeDefined();
      await expect(lstat(workspace!)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      binding.cleanupPaths.push(workspace!);
      expect(requests).toHaveLength(1);
      expect(await instance.database.segment.count({ where: { episodeId: item.episode.id } })).toBe(
        2
      );
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(item.record.job.id)
        )
      ).toMatchObject({ complete: false });
    }
  );
  it('rolls back insertion, reordering and completion if the final status write fails', async () => {
    const item = await fixture();
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "Episode" ADD CONSTRAINT reject_stitching CHECK (status != 'STITCHING')`
    );
    try {
      await expect(processSegmentRegeneration(item.job)).rejects.toThrow();
      expect(
        (
          await instance.database.segment.findMany({
            where: { episodeId: item.episode.id },
            orderBy: { order: 'asc' },
          })
        ).map((segment) => [segment.order, segment.text])
      ).toEqual([
        [0, 'Before'],
        [1, 'After'],
      ]);
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(item.record.job.id)
        )
      ).toMatchObject({ complete: false });
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete()))
          .jobs
      ).toHaveLength(1);
      expect(
        await instance.database.interaction.findUniqueOrThrow({
          where: { id: item.interaction.id },
        })
      ).toMatchObject({ status: 'INCORPORATING', incorporated: false });
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "Episode" DROP CONSTRAINT reject_stitching'
      );
    }
  });
  it('preserves audio completion when optional voice persistence is rejected', async () => {
    const item = await fixture();
    await instance.database.$executeRawUnsafe(
      'ALTER TABLE "EpisodeVoice" ADD CONSTRAINT reject_voice CHECK (false)'
    );
    try {
      await processSegmentRegeneration(item.job);
      expect(await instance.database.episodeVoice.count()).toBe(0);
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(item.record.job.id)
        )
      ).toMatchObject({ complete: true });
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "EpisodeVoice" DROP CONSTRAINT reject_voice'
      );
    }
  });
  it('recovers a lost final commit response by verifying the segment and downstream job', async () => {
    const item = await fixture();
    binding.loseCommit = item.record.job.id;
    await processSegmentRegeneration(item.job);
    expect(binding.loseCommit).toBeNull();
    expect(requests).toHaveLength(1);
    expect(await instance.database.segment.count({ where: { episodeId: item.episode.id } })).toBe(
      3
    );
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())).jobs
    ).toHaveLength(1);
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(item.record.job.id))
    ).toMatchObject({ complete: true });
    expect((await segmentRegenerationQueue.getJob(item.record.job.id))?.progress).toBe(100);
  });
  it('retries the complete reference transaction when voice persistence reports a serialization conflict', async () => {
    const item = await fixture();
    await instance.database.$executeRawUnsafe('CREATE SEQUENCE voice_conflict_attempt');
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION conflict_first_voice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('voice_conflict_attempt') = 1 THEN RAISE EXCEPTION 'Concurrent voice update' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER conflict_voice BEFORE INSERT ON "EpisodeVoice" FOR EACH ROW EXECUTE FUNCTION conflict_first_voice()'
    );
    try {
      await processSegmentRegeneration(item.job);
      expect(requests).toHaveLength(1);
      expect(
        await instance.database.episodeVoice.findFirst({ where: { episodeId: item.episode.id } })
      ).toMatchObject({ provider: 'local' });
      expect(await instance.database.segment.count({ where: { episodeId: item.episode.id } })).toBe(
        3
      );
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(item.record.job.id)
        )
      ).toMatchObject({ complete: true });
    } finally {
      await instance.database.$executeRawUnsafe('DROP TRIGGER conflict_voice ON "EpisodeVoice"');
      await instance.database.$executeRawUnsafe('DROP FUNCTION conflict_first_voice()');
      await instance.database.$executeRawUnsafe('DROP SEQUENCE voice_conflict_attempt');
    }
  });
  it('coalesces duplicate deliveries while speech is active', async () => {
    const item = await fixture();
    const finishSpeech = Promise.withResolvers<void>();
    duringSpeech = () => finishSpeech.promise;
    const first = processSegmentRegeneration(item.job);
    await expect.poll(() => requests.length, { timeout: 5_000 }).toBe(1);
    const duplicate = processSegmentRegeneration(item.job);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toHaveLength(1);
    finishSpeech.resolve();
    await Promise.all([first, duplicate]);
    expect(requests).toHaveLength(1);
    expect(await instance.database.segment.count({ where: { episodeId: item.episode.id } })).toBe(
      3
    );
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())).jobs
    ).toHaveLength(1);
    const writes = await instance.database.$queryRawUnsafe<
      Array<{ outcome: string; status: string }>
    >(
      `SELECT state->>'outcome' AS outcome, state->>'status' AS status FROM "SidedoorState" WHERE state->>'kind' = 'write'`
    );
    const receipts = await instance.database.$queryRawUnsafe<Array<{ outcome: string }>>(
      `SELECT state->>'outcome' AS outcome FROM "SidedoorState" WHERE state->>'kind' = 'write_receipt'`
    );
    expect(receipts.filter((receipt) => receipt.outcome === 'referenced')).toHaveLength(3);
    expect(
      writes.every((write) => write.status === 'settled' && write.outcome === 'unreferenced')
    ).toBe(true);
  });
});
