// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import { createSharedTestInstance } from '../helpers/setup/shared-instance';
import { GET } from '@/app/api/v1/notifications/route';
import { PATCH } from '@/app/api/v1/notifications/[notificationId]/route';
import { POST } from '@/app/api/v1/notifications/mark-all-read/route';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('notification routes with shared sessions', () => {
  let instance: Awaited<ReturnType<typeof createSharedTestInstance>>;
  let identity: Awaited<ReturnType<Awaited<ReturnType<typeof createSharedTestInstance>>['reset']>>;
  let other: { id: string; token: string };
  beforeAll(async () => {
    instance = await createSharedTestInstance('notifications');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    other = await identity.household('Other learner');
    await instance.database.notification.createMany({
      data: [
        {
          id: 'owned-new',
          userId: identity.ownerId,
          type: 'EPISODE_READY',
          title: 'Lesson ready',
          message: 'Listen now',
          data: { episodeId: 'lesson' },
          createdAt: new Date('2026-09-12T02:00:00Z'),
        },
        {
          id: 'owned-old',
          userId: identity.ownerId,
          type: 'SCRIPT_READY',
          title: 'Script ready',
          message: 'Review it',
          read: true,
          createdAt: new Date('2026-09-12T01:00:00Z'),
        },
        {
          id: 'other-private',
          userId: other.id,
          type: 'KEY_INVALID',
          title: 'Private key warning',
          message: 'Other learner only',
        },
      ],
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  function request(
    path = '/api/v1/notifications',
    token: string | null = identity.ownerToken,
    method = 'GET'
  ) {
    return new NextRequest(new URL(path, 'http://localhost:3000'), {
      method,
      headers: token ? { cookie: `sotto_session=${token}` } : {},
    });
  }
  it('rejects anonymous and revoked sessions before exposing notifications', async () => {
    expect((await GET(request(undefined, null))).status).toBe(401);
    await identity.access.logout(identity.ownerToken);
    expect((await GET(request())).status).toBe(401);
  });
  it('returns only the selected learner notifications with counts and pagination', async () => {
    const first = await GET(request('/api/v1/notifications?page=1&limit=1'));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      notifications: [{ id: 'owned-new', title: 'Lesson ready', data: { episodeId: 'lesson' } }],
      total: 2,
      unreadCount: 1,
      page: 1,
      limit: 1,
      hasMore: true,
    });
    const second = await GET(request('/api/v1/notifications?page=2&limit=1'));
    expect(await second.json()).toMatchObject({
      notifications: [{ id: 'owned-old' }],
      total: 2,
      hasMore: false,
    });
    const household = await GET(request(undefined, other.token));
    expect(await household.json()).toMatchObject({
      notifications: [{ id: 'other-private' }],
      total: 1,
      unreadCount: 1,
    });
  });
  it.each(['page=0', 'limit=51'])('rejects invalid pagination %s', async (query) => {
    expect((await GET(request(`/api/v1/notifications?${query}`))).status).toBe(400);
  });
  it('marks one owned notification read and preserves another learner notification', async () => {
    const response = await PATCH(
      request('/api/v1/notifications/owned-new', identity.ownerToken, 'PATCH'),
      { params: Promise.resolve({ notificationId: 'owned-new' }) }
    );
    expect(response.status).toBe(200);
    expect(
      (await instance.database.notification.findUniqueOrThrow({ where: { id: 'owned-new' } })).read
    ).toBe(true);
    const forbidden = await PATCH(
      request('/api/v1/notifications/other-private', identity.ownerToken, 'PATCH'),
      { params: Promise.resolve({ notificationId: 'other-private' }) }
    );
    expect(forbidden.status).toBe(403);
    expect(
      (await instance.database.notification.findUniqueOrThrow({ where: { id: 'other-private' } }))
        .read
    ).toBe(false);
  });
  it('reports a missing notification without modifying existing records', async () => {
    const response = await PATCH(
      request('/api/v1/notifications/missing', identity.ownerToken, 'PATCH'),
      { params: Promise.resolve({ notificationId: 'missing' }) }
    );
    expect(response.status).toBe(404);
    expect(await instance.database.notification.count({ where: { read: false } })).toBe(2);
  });
  it('marks all notifications for the selected learner and leaves other learners unread', async () => {
    const response = await POST(
      request('/api/v1/notifications/mark-all-read', identity.ownerToken, 'POST')
    );
    expect(response.status).toBe(200);
    expect(
      await instance.database.notification.count({
        where: { userId: identity.ownerId, read: false },
      })
    ).toBe(0);
    expect(
      await instance.database.notification.count({ where: { userId: other.id, read: false } })
    ).toBe(1);
    const repeated = await POST(
      request('/api/v1/notifications/mark-all-read', identity.ownerToken, 'POST')
    );
    expect(await repeated.json()).toMatchObject({ count: 0 });
  });
});
