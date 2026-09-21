// @vitest-environment node
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, describe, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated Redis 15');
    vi.stubEnv('REDIS_URL', configured);
  }
  return { redisUrl: configured };
});

import { createEpisodeStatusSubscriber } from '@/lib/redis';

describe.skipIf(!binding.redisUrl)('owned Redis subscribers', () => {
  const admin = new Redis(binding.redisUrl!, { maxRetriesPerRequest: 1 });
  afterAll(async () => admin.quit());

  it('delivers messages and reports connection loss without reconnecting', async () => {
    const episodeId = `${randomUUID()}-${randomUUID()}`;
    const subscriber = createEpisodeStatusSubscriber(episodeId);
    const controller = new AbortController();
    let received!: (message: string) => void;
    const message = new Promise<string>((resolve) => {
      received = resolve;
    });
    let reportLoss!: (error: Error) => void;
    const loss = new Promise<Error>((resolve) => {
      reportLoss = resolve;
    });
    await subscriber.subscribe(received, {
      signal: controller.signal,
      onLoss: reportLoss,
    });
    await admin.publish(subscriber.channel, '{"kind":"ready"}');
    await expect(message).resolves.toBe('{"kind":"ready"}');

    const clients = String(await admin.client('LIST'));
    const name = `sse-pod-${episodeId.slice(0, 8)}`;
    const line = clients.split('\n').find((value) => value.includes(`name=${name}`));
    const id = line?.match(/(?:^| )id=(\d+)/)?.[1];
    expect(id).toBeDefined();
    await admin.client('KILL', 'ID', id!);

    await expect(loss).resolves.toMatchObject({ message: expect.any(String) });
    await expect(subscriber.cleanup()).resolves.toBeUndefined();
    await expect
      .poll(async () => String(await admin.client('LIST')).includes(`name=${name}`))
      .toBe(false);
  });
});
