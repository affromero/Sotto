import { expect } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { cache, createEpisodeStatusSubscriber } from '@/lib/redis';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox, deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { episodeStatusQueue } from '@/lib/queue';
import { processEpisodeStatus } from '@/workers/durable/status/episode-status.worker';

export async function exerciseEpisodeInvalidation(database: PrismaClient, episodeId: string) {
  const page = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).listIncomplete());
  const records = await Promise.all(
    page.jobs.map((reference) =>
      sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(reference.id))
    )
  );
  const record = records.find((entry) => entry?.job.handler === 'episode-status');
  if (!record) throw new Error('Missing episode invalidation effect');
  await deliverSottoJob({
    database,
    queue: episodeStatusQueue,
    operationId: record.job.id,
    version: 1,
    fingerprint: record.fingerprint,
  });
  const queued = await episodeStatusQueue.getJob(record.job.id);
  if (!queued) throw new Error('Episode invalidation was not delivered');
  const episode = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
  await database.episode.update({ where: { id: episodeId }, data: { status: 'STITCHING' } });
  await cache.set(`episode:public:${episodeId}`, { status: 'READY' }, 60);
  const subscriber = createEpisodeStatusSubscriber(episodeId);
  const messages: unknown[] = [];
  const controller = new AbortController();
  let subscriberLoss: Error | undefined;
  let received!: () => void;
  const arrival = new Promise<void>((resolve) => {
    received = resolve;
  });
  await subscriber.subscribe(
    (message) => {
      messages.push(JSON.parse(message));
      received();
    },
    {
      signal: controller.signal,
      onLoss: (error) => {
        subscriberLoss = error;
        received();
      },
    }
  );
  try {
    await processEpisodeStatus(queued);
    const timer = setTimeout(received, 1000);
    try {
      await arrival;
    } finally {
      clearTimeout(timer);
    }
    if (subscriberLoss) throw subscriberLoss;
    expect(messages).toEqual([
      { kind: 'episode-invalidated', episodeId, operationId: record.job.id },
    ]);
    expect(await cache.get(`episode:public:${episodeId}`)).toBeNull();
    expect((await database.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe(
      'STITCHING'
    );
    expect(
      (await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(record.job.id)))?.complete
    ).toBe(true);
    await cache.set(`episode:public:${episodeId}`, { status: 'STITCHING' }, 60);
    await processEpisodeStatus(queued);
    expect(await cache.get(`episode:public:${episodeId}`)).toEqual({ status: 'STITCHING' });
  } finally {
    await queued.remove();
    await subscriber.cleanup();
    await cache.delete(`episode:public:${episodeId}`);
    await database.episode.update({ where: { id: episodeId }, data: { status: episode.status } });
  }
}
