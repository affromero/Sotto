// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../helpers/setup/shared-instance';
import { POST as start } from '@/app/api/v1/placement/from-notes/route';
import { POST as upload } from '@/app/api/v1/placement/from-notes/upload/route';
import { POST as confirm } from '@/app/api/v1/placement/from-notes/confirm/route';
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('exact source-analysis placement entries', () => {
  let instance: SharedTestInstance, owner: Awaited<ReturnType<SharedTestInstance['reset']>>;
  const origin = 'https://selfhost.example.com';
  beforeAll(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'a'.repeat(64));
    instance = await createSharedTestInstance('source_placement_http');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    owner = await instance.reset();
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'local:owned-quiz-fixture',
      aiBaseUrl: 'http://127.0.0.1:9999/v1',
    });
    await instance.database.user.update({
      where: { id: owner.ownerId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:owned-quiz-fixture' },
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('Source admission must not invoke a paid or external provider');
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    vi.unstubAllEnvs();
  });
  const input = () => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    native: 'en',
    target: 'de',
    content: 'Owned source class',
  });
  function request(
    path: string,
    body: unknown,
    token: string | null = owner.ownerToken,
    requestOrigin = origin
  ) {
    return new NextRequest(`${origin}/api/v1/placement/from-notes${path}`, {
      method: 'POST',
      headers: {
        ...(token ? { cookie: `sotto_session=${token}` } : {}),
        origin: requestOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
  it('retains exact pasted Unicode and queues complete source analysis instead of deducing from a language-pair cache', async () => {
    const value = { ...input(), content: '\uFEFF😀 source\0' + 'x'.repeat(19980) };
    const response = await start(request('', value)),
      body = await response.json();
    expect(response.status).toBe(202);
    expect(body.status).toBe('WAITING_SOURCE');
    expect(body).not.toHaveProperty('deducedLevel');
    const stored = await instance.database.materialAnalysis.findUniqueOrThrow({
      where: { id: body.analysisId },
      include: { sources: true },
    });
    expect(Buffer.from(stored.sources[0]!.snapshotBytes!).toString('utf8')).toBe(value.content);
    expect(await (await start(request('', value))).json()).toEqual(body);
    expect((await start(request('', { ...value, content: 'Different exact source' }))).status).toBe(
      409
    );
    expect(await instance.database.course.count()).toBe(0);
  });
  it('shares the retained-material JSON entry and explicitly rejects legacy multipart extraction', async () => {
    const response = await upload(request('/upload', input()));
    expect(response.status).toBe(202);
    const legacy = new NextRequest(`${origin}/api/v1/placement/from-notes/upload`, {
      method: 'POST',
      headers: {
        cookie: `sotto_session=${owner.ownerToken}`,
        origin,
        'content-type': 'multipart/form-data; boundary=owned',
      },
      body: '--owned--',
    });
    expect((await upload(legacy)).status).toBe(415);
  });
  it('requires the exact completed result receipt and never confirms the most recent pair result', async () => {
    expect((await confirm(request('/confirm', { native: 'en', target: 'de' }))).status).toBe(400);
    const started = await (await start(request('', input()))).json();
    expect(
      (
        await confirm(
          request('/confirm', {
            schemaVersion: 1,
            requestId: randomUUID(),
            native: 'en',
            target: 'de',
            analysisId: started.analysisId,
            analysisRevision: 1,
            resultDigest: 'a'.repeat(64),
            acceptPartial: false,
          })
        )
      ).status
    ).toBe(409);
    expect(await instance.database.course.count()).toBe(0);
  });
  it('enforces authenticated ownership and CSRF before source admission', async () => {
    expect((await start(request('', input(), null))).status).toBe(401);
    expect(
      (await start(request('', input(), owner.ownerToken, 'https://untrusted.invalid'))).status
    ).toBe(403);
    expect(await instance.database.materialAnalysis.count()).toBe(0);
  });
});
