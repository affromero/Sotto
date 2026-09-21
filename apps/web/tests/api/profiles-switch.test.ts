// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { POST, DELETE } from '@/app/api/v1/profiles/switch/route';
import { authenticateRequest } from '@/lib/api-keys';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Profile selection with persistent shared sessions', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('profile_switch');
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
  function request(token?: string, body?: unknown, method = 'POST') {
    return new NextRequest('http://localhost:3000/api/v1/profiles/switch', {
      method,
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        ...(token ? { cookie: `sotto_session=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  it('requires admission and validates the selection input', async () => {
    expect((await POST(request(undefined, { profileId: 'missing' }))).status).toBe(401);
    expect((await DELETE(request(undefined, undefined, 'DELETE'))).status).toBe(401);
    const admission = await identity.access.enterOpenHousehold();
    expect((await POST(request(admission, {}))).status).toBe(400);
  });
  it('selects learner content and restores its appearance from an admission session', async () => {
    const learner = await identity.household('Learner');
    await instance.database.user.update({
      where: { id: learner.id },
      data: { themeMode: 'dark', themePalette: 'paper', reducedMotion: true },
    });
    const admission = await identity.access.enterOpenHousehold();
    expect(await authenticateRequest(request(admission))).toBeNull();
    const response = await POST(request(admission, { profileId: learner.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, profileId: learner.id });
    expect(await authenticateRequest(request(admission))).toMatchObject({
      userId: learner.id,
      isOwner: false,
    });
    const theme = response.headers.getSetCookie().find((value) => value.startsWith('sotto_theme='));
    expect(theme).toBeDefined();
    const encoded = theme!.split(';')[0]!.slice('sotto_theme='.length);
    expect(JSON.parse(decodeURIComponent(encoded))).toMatchObject({
      mode: 'dark',
      palette: 'paper',
      reducedMotion: true,
    });
  });
  it('rejects private accounts and nonexistent profiles without changing selection', async () => {
    const learner = await identity.household('Learner');
    for (const id of [identity.ownerId, 'missing']) {
      expect((await POST(request(learner.token, { profileId: id }))).status).toBe(403);
      expect(await authenticateRequest(request(learner.token))).toMatchObject({
        userId: learner.id,
      });
    }
    expect((await POST(request(identity.ownerToken, { profileId: learner.id }))).status).toBe(403);
  });
  it('clears the session and profile cookies without restoring access', async () => {
    const learner = await identity.household('Learner');
    const response = await DELETE(request(learner.token, undefined, 'DELETE'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const forged = request(learner.token);
    forged.headers.set('cookie', `sotto_session=${learner.token}; sotto_profile=${learner.id}`);
    expect(await authenticateRequest(forged)).toBeNull();
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^sotto_theme=;.*Expires=Thu, 01 Jan 1970/),
        expect.stringMatching(/^sotto_profile=;.*Expires=Thu, 01 Jan 1970/),
      ])
    );
  });
  it('rejects cross-origin selection changes', async () => {
    const first = await identity.household('First learner');
    const second = await identity.household('Second learner');
    const forged = request(first.token, { profileId: second.id });
    forged.headers.set('origin', 'https://untrusted.example');
    expect((await POST(forged)).status).toBe(403);
    expect(await authenticateRequest(request(first.token))).toMatchObject({ userId: first.id });
  });
});
