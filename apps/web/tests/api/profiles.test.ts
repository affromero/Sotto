// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { GET, POST } from '@/app/api/v1/profiles/route';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Household profiles with shared authority', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('profile_routes');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  function request(method: string, token?: string, body?: unknown) {
    return new NextRequest('http://localhost:3000/api/v1/profiles', {
      method,
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        ...(token ? { cookie: `sotto_session=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  it('requires admission to list or create profiles', async () => {
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await POST(request('POST', undefined, { name: 'Learner' }))).status).toBe(401);
    expect(await instance.database.user.count()).toBe(1);
  });
  it('lists Admin and household profiles and identifies the selected learner', async () => {
    const first = await identity.household('First learner');
    const second = await identity.household('Second learner');
    const response = await GET(request('GET', first.token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profiles).toHaveLength(3);
    expect(body.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, isActive: true }),
        expect.objectContaining({ id: second.id, isActive: false }),
        expect.objectContaining({ id: identity.ownerId, isOwner: true, isActive: false }),
      ])
    );
  });
  it('creates the canonical household profile and its application avatar together', async () => {
    const response = await POST(
      request('POST', identity.ownerToken, { name: 'Learner', avatarSlug: 'toucan' })
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      name: 'Learner',
      avatarUrl: '/avatars/toucan.png',
      isOwner: false,
    });
    expect(
      await instance.database.user.findUniqueOrThrow({ where: { id: created.id } })
    ).toMatchObject({ name: 'Learner', image: '/avatars/toucan.png' });
    expect((await identity.access.store.read()).householdProfiles).toContainEqual(
      expect.objectContaining({ id: created.id, name: 'Learner' })
    );
  });
  it.each([
    { name: '   ' },
    { name: 'Learner', avatarSlug: 'unknown' },
    { name: 'Learner', role: 'ADMIN' },
  ])('rejects invalid profile input without changing authority', async (body) => {
    expect((await POST(request('POST', identity.ownerToken, body))).status).toBe(400);
    expect(await instance.database.user.count()).toBe(1);
    expect((await identity.access.store.read()).householdProfiles ?? []).toHaveLength(1);
  });
});
