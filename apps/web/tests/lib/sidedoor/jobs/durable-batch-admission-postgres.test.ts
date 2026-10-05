// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  admitDurableQueueBatch,
  durableQueueOperationId,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import { linkPreparationAudio } from '../../../helpers/runtime/preparation-audio';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;

suite('atomic episode child admission against PostgreSQL and Redis', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let queue: Queue;
  let afterQuery: ((args: readonly unknown[]) => Promise<void>) | undefined;

  beforeAll(async () => {
    instance = await createSharedTestInstance('durable_batch');
    boundary.database = instance.database.$extends({
      query: {
        async $queryRawUnsafe({ args, query }) {
          const result = await query(args);
          await afterQuery?.(args);
          return result;
        },
      },
    }) as unknown as PrismaClient;
  });
  beforeEach(async () => {
    afterQuery = undefined;
    identity = await instance.reset();
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated local Redis database 15');
    queue = new Queue(`admission-${randomUUID()}`, {
      connection: {
        host: url.hostname,
        port: Number(url.port),
        db: 15,
        maxRetriesPerRequest: null,
      },
    });
  });
  afterEach(async () => {
    afterQuery = undefined;
    vi.restoreAllMocks();
    await queue?.obliterate({ force: true });
    await queue?.close();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  const episode = (userId = identity.ownerId) =>
    instance.database.episode.create({
      data: { userId, title: 'Audio fixture', topic: 'Greetings', status: 'SCRIPT_READY' },
    });
  const child = (payload: Record<string, unknown>) => ({
    queue,
    type: 'audio-fixture',
    payload,
    jobId: randomUUID(),
  });
  const authorize = async () => ({ userId: identity.ownerId });
  const jobs = () =>
    sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete(null));
  function insertedChild(args: readonly unknown[], operationId: string) {
    if (typeof args[0] !== 'string' || !args[0].startsWith('INSERT INTO "SidedoorState"'))
      return false;
    return args.some((value) => {
      if (typeof value !== 'string' || !value.startsWith('{')) return false;
      const record = JSON.parse(value) as { kind?: string; job?: { id?: string } };
      return record.kind === 'outbox_job' && record.job?.id === operationId;
    });
  }

  it('keeps distinct episode, recipient and generation identities in each durable child', async () => {
    const other = await identity.household('Another learner');
    const first = await episode();
    const second = await episode();
    const children = [
      child({ episodeId: first.id }),
      child({ episodeId: first.id, audioGenerationKey: 'first-key' }),
      child({ episodeId: first.id, audioGenerationKey: 'second-key' }),
      child({ episodeId: first.id, audioGenerationKey: '' }),
      child({ episodeId: first.id, userId: other.id }),
      child({ episodeId: second.id }),
    ];
    await admitDurableQueueBatch({ prepare: async () => children });
    const stored = await sottoTransaction(instance.database, async (tx) => {
      const outbox = sottoJobOutbox(tx);
      return Promise.all(
        children.map((item) => outbox.read(durableQueueOperationId(queue.name, item.jobId)))
      );
    });
    expect(
      stored.map((item) => (item!.job.payload as { authority: unknown }).authority)
    ).toMatchObject([
      { episodeId: first.id, userId: identity.ownerId },
      { episodeId: first.id, preparationAudioGenerationKey: 'first-key' },
      { episodeId: first.id, preparationAudioGenerationKey: 'second-key' },
      { episodeId: first.id, preparationAudioGenerationKey: '' },
      { episodeId: first.id, userId: other.id },
      { episodeId: second.id, userId: identity.ownerId },
    ]);
    expect((stored[0]!.job.payload as { authority: object }).authority).not.toHaveProperty(
      'preparationAudioGenerationKey'
    );
    const recipient = stored[4]!.job.scopes;
    expect(recipient).toEqual(
      expect.arrayContaining([expect.objectContaining({ subjectId: `profile:${other.id}` })])
    );
    for (const record of stored)
      expect((await queue.getJob(record!.job.id))?.data).toEqual({
        operationId: record!.job.id,
        fingerprint: record!.fingerprint,
      });
  });

  it.each(['different owner', 'explicit recipient', 'empty recipient'])(
    'rolls back every child for a late %s mismatch',
    async (mismatch) => {
      const other = await identity.household('Another learner');
      const first = await episode();
      const second = mismatch === 'different owner' ? await episode(other.id) : first;
      const children = [
        child({ episodeId: first.id }),
        child({
          episodeId: second.id,
          ...(mismatch === 'explicit recipient'
            ? { userId: other.id }
            : mismatch === 'empty recipient'
              ? { userId: '' }
              : {}),
        }),
      ];
      await expect(
        admitDurableQueueBatch({
          authorize,
          prepare: async (tx) => {
            await tx.episode.update({
              where: { id: first.id },
              data: { title: 'Uncommitted replacement' },
            });
            return children;
          },
        })
      ).rejects.toThrow();
      expect((await jobs()).jobs).toEqual([]);
      expect(await queue.getJobCounts('wait', 'delayed')).toEqual({ wait: 0, delayed: 0 });
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: first.id } })).title
      ).toBe('Audio fixture');
    }
  );

  it('rolls back prepared segments and all children when the grant expires after the final child write', async () => {
    const original = await episode();
    const operation = await linkPreparationAudio(instance.database, identity.ownerId, original.id);
    const children = [
      child({ episodeId: original.id, audioGenerationKey: 'preparation-audio-fixture' }),
      child({ episodeId: original.id, audioGenerationKey: 'preparation-audio-fixture' }),
    ];
    let now = operation.createdAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let wroteChild = false;
    afterQuery = async (args) => {
      if (insertedChild(args, durableQueueOperationId(queue.name, children[1]!.jobId))) {
        wroteChild = true;
        now = operation.expiresAt;
      }
    };
    await expect(
      admitDurableQueueBatch({
        authorize,
        prepare: async (tx) => {
          await tx.episode.update({
            where: { id: original.id },
            data: { status: 'GENERATING_AUDIO' },
          });
          await tx.segment.create({
            data: { episodeId: original.id, order: 0, speaker: 'HOST', text: 'Hallo.' },
          });
          return children;
        },
      })
    ).rejects.toBeInstanceOf(PreparationConflictError);
    expect(wroteChild).toBe(true);
    expect((await jobs()).jobs).toEqual([]);
    expect(await instance.database.segment.count({ where: { episodeId: original.id } })).toBe(0);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: original.id } })).status
    ).toBe('SCRIPT_READY');
    expect(await queue.getJobCounts('wait', 'delayed')).toEqual({ wait: 0, delayed: 0 });
  });

  it('recaptures episode authority after a database serialization retry', async () => {
    const original = await episode();
    const children = [child({ episodeId: original.id }), child({ episodeId: original.id })];
    let conflicted = false;
    let changed = false;
    afterQuery = async (args) => {
      if (
        !conflicted &&
        insertedChild(args, durableQueueOperationId(queue.name, children[0]!.jobId))
      ) {
        conflicted = true;
        await instance.database.$executeRawUnsafe(
          "DO $$ BEGIN RAISE EXCEPTION 'Fixture serialization conflict' USING ERRCODE = '40001'; END $$"
        );
      }
    };
    await admitDurableQueueBatch({
      authorize: async () => {
        if (conflicted && !changed) {
          changed = true;
          await instance.database.episode.update({
            where: { id: original.id },
            data: { pipelineGeneration: 'fresh-generation' },
          });
        }
        return { userId: identity.ownerId };
      },
      prepare: async () => children,
    });
    expect(conflicted).toBe(true);
    expect(changed).toBe(true);
    for (const item of (await jobs()).jobs) {
      const record = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(item.id)
      );
      expect(record!.job.payload).toMatchObject({
        authority: { episodeId: original.id, pipelineGeneration: 'fresh-generation' },
      });
      expect((await queue.getJob(item.id))?.data).toEqual({
        operationId: item.id,
        fingerprint: record!.fingerprint,
      });
    }
    expect((await jobs()).jobs).toHaveLength(2);
  });
});
