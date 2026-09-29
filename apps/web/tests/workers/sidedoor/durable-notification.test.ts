// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { prepareJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { StorageCleanupJournal, prepareStorageCleanup } from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { processDurableGenericNotification } from '@/workers/durable/notifications/durable-generic-notification';
import { processDurableNotification } from '@/workers/durable/notifications/durable-notification';
import { processDurableNotificationDelivery } from '@/workers/durable/notifications/durable-notification-delivery';
import { processDurableNotificationFanout } from '@/workers/durable/notifications/durable-notification-fanout';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => {
  if (process.env.SIDEDOOR_TEST_REDIS_URL)
    vi.stubEnv('REDIS_URL', process.env.SIDEDOOR_TEST_REDIS_URL);
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
  return { database: null as PrismaClient | null, send: vi.fn(), publish: vi.fn() };
});
vi.mock('@/lib/prisma', async () => {
  const database = new Proxy(
    {},
    {
      get(_target, property) {
        if (!boundary.database) throw new Error('Test database is not initialized');
        const value = boundary.database[property as keyof PrismaClient];
        return typeof value === 'function' ? value.bind(boundary.database) : value;
      },
    }
  );
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('web-push', () => ({ default: { sendNotification: boundary.send } }));
vi.mock('@/lib/redis', async (original) => ({
  ...(await original<typeof import('@/lib/redis')>()),
  publishNotification: boundary.publish,
}));
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('durable notification inbox and device receipts', () => {
  let instance: SharedTestInstance;
  let ownerId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('durable_notifications');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    ownerId = (await instance.reset()).ownerId;
    boundary.send.mockReset().mockResolvedValue(undefined);
    boundary.publish.mockReset().mockResolvedValue(undefined);
    await instance.database.user.update({
      where: { id: ownerId },
      data: { pushNotifications: true },
    });
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });
  const queued = (record: OutboxJob) => ({
    id: record.job.id,
    name: `notifications.v${record.job.version}`,
    data: { operationId: record.job.id, fingerprint: record.fingerprint },
  });
  async function fixture() {
    const episode = await instance.database.episode.create({
      data: {
        userId: ownerId,
        title: 'Lesson',
        topic: 'Spanish',
        language: 'es',
        status: 'READY',
      },
    });
    for (const id of ['first', 'second'])
      await instance.database.pushSubscription.create({
        data: {
          id,
          userId: ownerId,
          endpoint: `https://push.example.com/${id}`,
          p256dh: 'key',
          auth: 'auth',
        },
      });
    return sottoTransaction(instance.database, async (tx) => {
      const storage = await captureEpisodeStorage(tx, episode.id, [ownerId]);
      const outbox = sottoJobOutbox(tx);
      const parent = await outbox.enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'audio-stitching',
          version: 1,
          payload: { episodeId: episode.id, storage, contributorId: ownerId },
          scopes: storage.scopes,
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
      await outbox.complete(parent.job.id, parent.fingerprint);
      return outbox.enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'notifications',
          version: 1,
          payload: {
            userId: ownerId,
            type: 'EPISODE_READY',
            title: 'Ready',
            message: 'Lesson ready',
            data: { episodeId: episode.id },
            storage,
            contributorId: ownerId,
            parentOperationId: parent.job.id,
            parentFingerprint: parent.fingerprint,
          },
          scopes: storage.scopes,
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
    });
  }
  async function genericFixture(options: { notificationId?: string; episodeId?: string } = {}) {
    const notificationId = options.notificationId ?? randomUUID();
    return sottoTransaction(instance.database, async (tx) => {
      const profile = await tx.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { createdAt: true },
      });
      const storage = await sottoStorageInstance(tx).read();
      await tx.pushSubscription.createMany({
        skipDuplicates: true,
        data: ['generic-first', 'generic-second'].map((id) => ({
          id,
          userId: ownerId,
          endpoint: `https://push.example.com/${id}`,
          p256dh: 'key',
          auth: 'auth',
        })),
      });
      const message = {
        notificationId,
        userId: ownerId,
        type: 'PIPELINE_FAILURE',
        title: 'Generation failed',
        message: 'The generation could not be completed.',
        ...(options.episodeId ? { data: { episodeId: options.episodeId } } : {}),
      };
      return sottoJobOutbox(tx).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'notifications',
          version: 4,
          payload: {
            type: 'send_notification',
            payload: message,
            authority: {
              kind: 'profile',
              userId: ownerId,
              createdAt: profile.createdAt.getTime(),
              instanceId: storage.instanceId,
            },
          },
          scopes: [
            { subjectId: storage.subjectId, generation: storage.generation },
            { subjectId: `profile:${ownerId}`, generation: profile.createdAt.getTime() },
          ].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
    });
  }
  async function children() {
    while (true) {
      const pages = await instance.database.$queryRawUnsafe<Array<{ state: OutboxJob }>>(
        `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'version' = '3' AND state->>'complete' = 'false'`
      );
      if (!pages.length) break;
      for (const page of pages) await processDurableNotificationFanout(queued(page.state));
    }
    const rows = await instance.database.$queryRawUnsafe<Array<{ state: OutboxJob }>>(
      `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'version' = '2'`
    );
    return rows.map((row) => row.state);
  }
  async function eraseRecipient(parent: OutboxJob) {
    const scope = parent.job.scopes.find((item) => item.subjectId === `profile:${ownerId}`)!;
    const deletion = prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...scope });
    await sottoTransaction(instance.database, async (tx) => {
      const cleanup = new StorageCleanupJournal(
        {
          query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await cleanup.createJob(deletion);
      await tx.user.delete({ where: { id: ownerId } });
    });
  }

  it.skipIf(!process.env.SIDEDOOR_TEST_REDIS_URL)(
    'dispatches immutable v4 references through the real worker, including replay and erasure',
    async () => {
      const redisUrl = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
      if (!['localhost', '127.0.0.1'].includes(redisUrl.hostname) || redisUrl.pathname !== '/15')
        throw new Error('Use disposable local Redis database 15');
      vi.stubEnv('REDIS_URL', redisUrl.toString());
      const { createWorker } = await import('@/lib/queue');
      const { processNotification } = await import('@/workers/notification.worker');
      const { deliverSottoJob } = await import('@/lib/sidedoor/jobs/core/job-delivery');
      const connection = new Redis(redisUrl.toString(), { maxRetriesPerRequest: null });
      const queue = new Queue('notifications', { connection });
      const events = new QueueEvents('notifications', { connection });
      const worker = createWorker('notifications', processNotification, { concurrency: 1 });
      const ids: string[] = [];
      async function dispatch(record: OutboxJob) {
        ids.push(record.job.id);
        await deliverSottoJob({
          database: instance.database,
          queue,
          operationId: record.job.id,
          fingerprint: record.fingerprint,
          version: record.job.version,
        });
        const job = await queue.getJob(record.job.id);
        if (!job) throw new Error('Missing dispatched notification');
        await job.waitUntilFinished(events, 10000);
      }
      try {
        await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
        const parent = await genericFixture();
        await dispatch(parent);
        const first = await instance.database.notification.findMany();
        expect(first).toHaveLength(1);
        const job = await queue.getJob(parent.job.id);
        await job!.retry('completed');
        await job!.waitUntilFinished(events, 10000);
        expect(await instance.database.notification.findMany()).toEqual(first);
        for (const delivery of await children()) await dispatch(delivery);
        expect(boundary.send.mock.calls.map(([target]) => target.endpoint).sort()).toEqual([
          'https://push.example.com/generic-first',
          'https://push.example.com/generic-second',
        ]);
        expect(boundary.publish.mock.calls).toHaveLength(1);
        const revoked = await genericFixture();
        await eraseRecipient(parent);
        await expect(dispatch(revoked)).rejects.toThrow('Durable work recipient changed');
        expect(
          await sottoTransaction(instance.database, (database) =>
            sottoJobOutbox(database).receipt(revoked.job.id)
          )
        ).toMatchObject({ status: 'pending' });
        await job!.retry('completed');
        await job!.waitUntilFinished(events, 10000);
        expect(await instance.database.notification.count()).toBe(0);
        expect(boundary.send.mock.calls).toHaveLength(2);
      } finally {
        await worker.close();
        for (const id of ids) await (await queue.getJob(id))?.remove();
        await events.close();
        await queue.close();
        await connection.quit();
      }
    }
  );

  it('processes the generic v4 contract exactly once with its independent inbox identity', async () => {
    const notificationId = randomUUID();
    const parent = await genericFixture({ notificationId, episodeId: 'failed-episode' });
    await Promise.all(
      Array.from({ length: 3 }, () => processDurableGenericNotification(queued(parent)))
    );
    expect(await instance.database.notification.findMany()).toEqual([
      expect.objectContaining({
        id: notificationId,
        userId: ownerId,
        type: 'PIPELINE_FAILURE',
        data: { episodeId: 'failed-episode' },
      }),
    ]);
    const deliveries = await children();
    expect(deliveries).toHaveLength(3);
    expect(
      deliveries.every(
        (record) =>
          (record.job.payload as { notificationId: string; parentVersion: number })
            .notificationId === notificationId &&
          (record.job.payload as { notificationId: string; parentVersion: number })
            .parentVersion === 4
      )
    ).toBe(true);
  });

  it('retains a generic v4 SSE failure for retry and then completes it', async () => {
    const parent = await genericFixture();
    await processDurableGenericNotification(queued(parent));
    const delivery = (await children()).find(
      (record) => (record.job.payload as { channel: string }).channel === 'sse'
    )!;
    boundary.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(processDurableNotificationDelivery(queued(delivery))).rejects.toThrow(
      'Redis unavailable'
    );
    expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
      false
    );
    await processDurableNotificationDelivery(queued(delivery));
    expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
      true
    );
  });

  it('suppresses generic v4 delivery after proven recipient erasure', async () => {
    const parent = await genericFixture();
    await processDurableGenericNotification(queued(parent));
    const deliveries = await children();
    await eraseRecipient(parent);
    for (const delivery of deliveries) await processDurableNotificationDelivery(queued(delivery));
    expect(boundary.send.mock.calls).toEqual([]);
    expect(boundary.publish.mock.calls).toEqual([]);
    expect(await instance.database.notification.count()).toBe(0);
  });

  it.each(['admission', 'fanout', 'delivery', 'in-flight'])(
    'suppresses %s after proven recipient erasure',
    async (stage) => {
      const parent = await fixture();
      if (stage !== 'admission') await processDurableNotification(queued(parent));
      const deliveries = stage === 'delivery' || stage === 'in-flight' ? await children() : [];
      if (stage === 'in-flight') {
        boundary.send.mockImplementationOnce(async () => eraseRecipient(parent));
        const push = deliveries.find(
          (record) => (record.job.payload as { channel: string }).channel === 'push'
        )!;
        await processDurableNotificationDelivery(queued(push));
      } else await eraseRecipient(parent);
      if (stage === 'admission') await processDurableNotification(queued(parent));
      else if (stage === 'fanout') expect(await children()).toHaveLength(1);
      for (const delivery of deliveries) await processDurableNotificationDelivery(queued(delivery));
      expect(await instance.database.notification.count()).toBe(0);
      expect(await instance.database.user.findUnique({ where: { id: ownerId } })).toBeNull();
      if (stage !== 'in-flight') expect(boundary.send.mock.calls).toEqual([]);
      const remaining = await instance.database.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*) FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'handler' = 'notifications' AND state->>'complete' = 'false'`
      );
      // The SSE sibling of a suppressed fan-out remains its own independently cancellable job.
      if (stage === 'fanout') {
        for (const delivery of await children())
          await processDurableNotificationDelivery(queued(delivery));
      } else expect(Number(remaining[0]!.count)).toBe(0);
    }
  );

  it('cancels dependent deliveries after the parent payload has been erased', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    const deliveries = await children();
    await eraseRecipient(parent);
    const scope = parent.job.scopes.find((item) => item.subjectId === `profile:${ownerId}`)!;
    await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).erase(parent.job.id, parent.fingerprint, scope)
    );
    await processDurableNotification(queued(parent));
    for (const delivery of deliveries) await processDurableNotificationDelivery(queued(delivery));
    expect(boundary.send.mock.calls).toEqual([]);
    expect(boundary.publish.mock.calls).toEqual([]);
    expect((await children()).every((record) => record.complete)).toBe(true);
    const forged = queued(parent);
    forged.data.fingerprint = '0'.repeat(64);
    await expect(processDurableNotification(forged)).rejects.toThrow('does not match');
  });

  it('finishes an accepted request whose delivery receipt was concurrently erased', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    const delivery = (await children()).find(
      (record) => (record.job.payload as { channel: string }).channel === 'push'
    )!;
    boundary.send.mockImplementationOnce(async () => {
      await eraseRecipient(parent);
      const scope = parent.job.scopes.find((item) => item.subjectId === `profile:${ownerId}`)!;
      await sottoTransaction(instance.database, async (tx) => {
        const outbox = sottoJobOutbox(tx);
        await outbox.complete(delivery.job.id, delivery.fingerprint);
        await outbox.erase(delivery.job.id, delivery.fingerprint, scope);
      });
    });
    await processDurableNotificationDelivery(queued(delivery));
    expect(await instance.database.notification.count()).toBe(0);
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(delivery.job.id))
    ).toMatchObject({ status: 'erased' });
  });

  it('does not treat missing application data as proof of authorized erasure', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    const deliveries = await children();
    await instance.database.notification.deleteMany();
    await expect(processDurableNotificationDelivery(queued(deliveries[0]!))).rejects.toThrow();
    expect(boundary.send.mock.calls).toEqual([]);
  });

  it('commits one inbox and one delivery set during concurrent admission and fan-out', async () => {
    const parent = await fixture();
    await Promise.all(Array.from({ length: 3 }, () => processDurableNotification(queued(parent))));
    expect(await instance.database.notification.count()).toBe(1);
    const pages = await instance.database.$queryRawUnsafe<Array<{ state: OutboxJob }>>(
      `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'version' = '3'`
    );
    expect(pages).toHaveLength(1);
    await Promise.all(
      Array.from({ length: 3 }, () => processDurableNotificationFanout(queued(pages[0]!.state)))
    );
    const deliveries = await children();
    expect(deliveries).toHaveLength(3);
    expect(new Set(deliveries.map((record) => record.job.id)).size).toBe(3);
  });

  it('creates one inbox and retries only the device whose send failed', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    await processDurableNotification(queued(parent));
    expect(await instance.database.notification.count()).toBe(1);
    const deliveries = await children();
    expect(deliveries).toHaveLength(3);
    boundary.send.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith('/second')) throw { statusCode: 503 };
    });
    const results = await Promise.allSettled(
      deliveries.map((record) => processDurableNotificationDelivery(queued(record)))
    );
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await children()).filter((record) => record.complete)).toHaveLength(2);
    expect(
      await instance.database.notification.findUnique({ where: { id: parent.job.id } })
    ).toMatchObject({ pushed: true });
    boundary.send.mockClear().mockResolvedValue(undefined);
    await Promise.all(
      deliveries.map((record) => processDurableNotificationDelivery(queued(record)))
    );
    expect(boundary.send.mock.calls.map((call) => call[0].endpoint)).toEqual([
      'https://push.example.com/second',
    ]);
    expect((await children()).every((record) => record.complete)).toBe(true);
  });

  it.each([205, 2005])(
    'fans out %s extra devices across bounded pages without admitting later subscriptions',
    async (count) => {
      const parent = await fixture();
      await instance.database.pushSubscription.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          id: `bulk-${String(index).padStart(3, '0')}`,
          userId: ownerId,
          endpoint: `https://push.example.com/bulk-${index}`,
          p256dh: 'key',
          auth: 'auth',
        })),
      });
      await processDurableNotification(queued(parent));
      await instance.database.pushSubscription.create({
        data: {
          id: 'late',
          userId: ownerId,
          endpoint: 'https://push.example.com/late',
          p256dh: 'key',
          auth: 'auth',
        },
      });
      const deliveries = await children();
      const devices = deliveries.flatMap((record) => {
        const payload = record.job.payload as { channel: string; device?: { id: string } };
        return payload.device ? [payload.device.id] : [];
      });
      expect(devices).toHaveLength(count + 2);
      expect(new Set(devices).size).toBe(count + 2);
      expect(devices).not.toContain('late');
      const pages = await instance.database.$queryRawUnsafe<Array<{ state: OutboxJob }>>(
        `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'version' = '3'`
      );
      expect(pages).toHaveLength(Math.ceil((count + 2) / 100));
      for (const page of pages) await processDurableNotificationFanout(queued(page.state));
      expect(await children()).toHaveLength(count + 3);
    },
    60_000
  );
  it('suppresses replaced devices without sending to their new credentials', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    await instance.database.pushSubscription.updateMany({ data: { auth: 'replacement' } });
    for (const record of await children()) await processDurableNotificationDelivery(queued(record));
    expect(boundary.send.mock.calls).toEqual([]);
    expect((await children()).every((record) => record.complete)).toBe(true);
    expect(
      await instance.database.notification.findUnique({ where: { id: parent.job.id } })
    ).toMatchObject({ pushed: false });
  });

  it('records accepted push even when a concurrent execution completes opt-out suppression', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    const delivery = (await children()).find(
      (record) => (record.job.payload as { channel: string }).channel === 'push'
    )!;
    boundary.send.mockImplementationOnce(async () => {
      await instance.database.user.update({
        where: { id: ownerId },
        data: { pushNotifications: false },
      });
      await processDurableNotificationDelivery(queued(delivery));
    });
    await processDurableNotificationDelivery(queued(delivery));
    expect(
      await instance.database.notification.findUnique({ where: { id: parent.job.id } })
    ).toMatchObject({ pushed: true });
    expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
      true
    );
  });

  it.each([false, true])(
    'handles an expired device with in-flight credential replacement=%s',
    async (replace) => {
      const parent = await fixture();
      await processDurableNotification(queued(parent));
      const delivery = (await children()).find(
        (record) => (record.job.payload as { channel: string }).channel === 'push'
      )!;
      const deviceId = (delivery.job.payload as { device: { id: string } }).device.id;
      boundary.send.mockImplementationOnce(async () => {
        if (replace)
          await instance.database.pushSubscription.update({
            where: { id: deviceId },
            data: { auth: 'renewed' },
          });
        throw { statusCode: 410 };
      });
      await processDurableNotificationDelivery(queued(delivery));
      const device = await instance.database.pushSubscription.findUnique({
        where: { id: deviceId },
      });
      if (replace) expect(device).toMatchObject({ auth: 'renewed' });
      else expect(device).toBeNull();
      expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
        true
      );
      expect(
        await instance.database.notification.findUnique({ where: { id: parent.job.id } })
      ).toMatchObject({ pushed: false });
    }
  );

  it('rolls back the delivery receipt if persisting confirmed push fails', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    const delivery = (await children()).find(
      (record) => (record.job.payload as { channel: string }).channel === 'push'
    )!;
    await instance.database.$executeRawUnsafe(
      'ALTER TABLE "Notification" ADD CONSTRAINT reject_push CHECK (NOT pushed)'
    );
    try {
      await expect(processDurableNotificationDelivery(queued(delivery))).rejects.toThrow();
      expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
        false
      );
      expect(
        await instance.database.notification.findUnique({ where: { id: parent.job.id } })
      ).toMatchObject({ pushed: false });
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "Notification" DROP CONSTRAINT reject_push'
      );
    }
    await processDurableNotificationDelivery(queued(delivery));
    expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
      true
    );
    expect(
      await instance.database.notification.findUnique({ where: { id: parent.job.id } })
    ).toMatchObject({ pushed: true });
    expect(boundary.send.mock.calls.map((call) => JSON.parse(call[1]).notificationId)).toEqual([
      parent.job.id,
      parent.job.id,
    ]);
  });

  it('retains failed SSE work for retry without marking push success', async () => {
    const parent = await fixture();
    await processDurableNotification(queued(parent));
    const delivery = (await children()).find(
      (record) => (record.job.payload as { channel: string }).channel === 'sse'
    )!;
    boundary.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(processDurableNotificationDelivery(queued(delivery))).rejects.toThrow(
      'Redis unavailable'
    );
    expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
      false
    );
    await processDurableNotificationDelivery(queued(delivery));
    expect((await children()).find((record) => record.job.id === delivery.job.id)?.complete).toBe(
      true
    );
    expect(
      await instance.database.notification.findUnique({ where: { id: parent.job.id } })
    ).toMatchObject({ pushed: false });
  });
});
