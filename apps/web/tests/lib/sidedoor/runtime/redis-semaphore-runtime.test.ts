// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { SemaphoreCleanupError } from 'thesidedoor-core/runtime/semaphore';
import { openSottoSemaphore } from '@/lib/sidedoor/jobs/core/redis-semaphore';

const redisUrl = process.env.SIDEDOOR_TEST_REDIS_URL;
describe.skipIf(!redisUrl)('Sotto Redis semaphore sessions', () => {
  const admin = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
  afterAll(async () => admin.quit());

  it('enforces capacity and releases only the owning token', async () => {
    const resource = `test:${randomUUID()}`;
    const owner = await openSottoSemaphore({ resource, limit: 1, ttlMs: 5_000, redisUrl });
    const contender = await openSottoSemaphore({ resource, limit: 1, ttlMs: 5_000, redisUrl });
    expect(await owner.acquire()).toBe(true);
    expect(await contender.acquire()).toBe(false);
    await contender.release();
    expect(await owner.inspect()).not.toBeNull();
    await owner.release();
    const replacement = await openSottoSemaphore({ resource, limit: 1, ttlMs: 5_000, redisUrl });
    expect(await replacement.acquire()).toBe(true);
    await replacement.release();
  });

  it('fails closed after its non-replaying connection is killed and expires the orphaned token', async () => {
    const resource = `test:${randomUUID()}`;
    const session = await openSottoSemaphore({ resource, limit: 1, ttlMs: 100, redisUrl });
    expect(await session.acquire()).toBe(true);
    const resourceId = createHash('sha256').update(resource).digest('hex').slice(0, 12);
    const clients = String(await admin.client('LIST'));
    const line = clients
      .split('\n')
      .find((value) => value.includes(`name=sotto-sidedoor-semaphore:${resourceId}`));
    expect(line).toBeDefined();
    const id = line?.match(/(?:^| )id=(\d+)/)?.[1];
    expect(id).toBeDefined();
    await admin.client('KILL', 'ID', id!);
    await expect
      .poll(async () =>
        session.inspect().then(
          () => false,
          () => true
        )
      )
      .toBe(true);
    await expect(session.release()).rejects.toBeInstanceOf(SemaphoreCleanupError);

    const blocked = await openSottoSemaphore({ resource, limit: 1, ttlMs: 5_000, redisUrl });
    expect(await blocked.acquire()).toBe(false);
    await blocked.release();
    await delay(120);
    const replacement = await openSottoSemaphore({ resource, limit: 1, ttlMs: 5_000, redisUrl });
    expect(await replacement.acquire()).toBe(true);
    await replacement.release();
  });
});
