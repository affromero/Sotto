// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { HouseholdProfileService } from 'thesidedoor-core/access';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as reserve } from '@/app/api/v1/materials/uploads/route';
import { GET as resume } from '@/app/api/v1/materials/uploads/[uploadId]/route';
import { POST as analyze } from '@/app/api/v1/placement/from-notes/route';
import { GET as analysisStatus } from '@/app/api/v1/material-analyses/[analysisId]/route';
import { GET as me } from '@/app/api/v1/users/me/route';
import { getServerInfra } from '@/lib/server-config';
import { closeRedis } from '@/lib/redis';
import { materialAnalysisQueue } from '@/lib/queue';
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
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const expectedHeader = 'x-sotto-expected-profile-id';

suite('captured browser profile at owned material admission', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let otherId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('expected_profile');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    otherId = (await identity.household('Second learner')).id;
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiProvider: 'local',
      aiModel: 'local:expected-profile-fixture',
      aiBaseUrl: 'http://127.0.0.1:9/v1',
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await materialAnalysisQueue.close();
    await closeRedis();
    await instance?.close();
    boundary.database = null;
  });
  function request(path: string, body?: unknown, expected?: string, token = identity.ownerToken) {
    return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie: `sotto_session=${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        ...(expected === undefined ? {} : { [expectedHeader]: expected }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const files = () => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    files: [{ clientId: randomUUID(), name: 'private.txt', mimeType: 'text/plain', byteSize: 5 }],
  });
  const source = () => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    native: 'en',
    target: 'de',
    content: 'Ich habe gestern gearbeitet.',
  });
  async function switchProfile() {
    expect(await (await me(request('users/me'))).json()).toMatchObject({ id: identity.ownerId });
    await new HouseholdProfileService(identity.access).select(identity.ownerToken, otherId);
    expect(await (await me(request('users/me'))).json()).toMatchObject({ id: otherId });
  }
  async function journal() {
    return instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
  }

  it('rejects a cookie profile switch before the first batch without reserving or storing either learner originals', async () => {
    await switchProfile();
    const before = await journal();
    const response = await reserve(request('materials/uploads', files(), identity.ownerId));
    expect(response.status).toBe(409);
    expect(await instance.database.materialUploadBatch.count()).toBe(0);
    expect(await instance.database.materialUpload.count()).toBe(0);
    expect(await instance.database.courseMaterial.count()).toBe(0);
    expect(
      await instance.database.courseMaterial.count({
        where: { userId: otherId, originalUrl: { not: null } },
      })
    ).toBe(0);
    expect(await journal()).toEqual(before);
  });

  it('rejects new source admission after the same cookie switches without an analysis, outbox or provider grant', async () => {
    await switchProfile();
    const before = await journal();
    const response = await analyze(request('placement/from-notes', source(), identity.ownerId));
    expect(response.status).toBe(409);
    expect(await instance.database.materialAnalysis.count()).toBe(0);
    expect(await instance.database.materialAnalysisRequest.count()).toBe(0);
    expect(await instance.database.materialAnalysisUnit.count()).toBe(0);
    expect(await journal()).toEqual(before);
  });

  it('rejects a foreign assertion on owned read receipts and the current-profile recheck', async () => {
    const batchResponse = await reserve(request('materials/uploads', files(), identity.ownerId));
    expect(batchResponse.status).toBe(201);
    const batch = (await batchResponse.json()) as { uploads: { uploadId: string }[] };
    expect(
      (
        await resume(
          request(`materials/uploads/${batch.uploads[0]!.uploadId}`, undefined, otherId),
          {
            params: Promise.resolve({ uploadId: batch.uploads[0]!.uploadId }),
          }
        )
      ).status
    ).toBe(409);
    expect((await me(request('users/me', undefined, otherId))).status).toBe(409);
    const admission = await analyze(request('placement/from-notes', source(), identity.ownerId));
    expect(admission.status).toBe(202);
    const saved = (await admission.json()) as { analysisId: string };
    expect(
      (
        await analysisStatus(request(`material-analyses/${saved.analysisId}`, undefined, otherId), {
          params: Promise.resolve({ analysisId: saved.analysisId }),
        })
      ).status
    ).toBe(409);
    expect(
      (
        await analysisStatus(
          request(`material-analyses/${saved.analysisId}`, undefined, identity.ownerId),
          {
            params: Promise.resolve({ analysisId: saved.analysisId }),
          }
        )
      ).status
    ).toBe(200);
    expect(await instance.database.materialAnalysisUnit.count()).toBe(0);
  });

  it('preserves matching assertions and legacy requests without allowing the header to select a profile', async () => {
    await switchProfile();
    expect((await reserve(request('materials/uploads', files(), otherId))).status).toBe(201);
    expect((await reserve(request('materials/uploads', files()))).status).toBe(201);
    expect(await instance.database.materialUploadBatch.count({ where: { userId: otherId } })).toBe(
      2
    );
    expect(
      await instance.database.materialUploadBatch.count({ where: { userId: identity.ownerId } })
    ).toBe(0);
    expect(
      (await me(request('users/me', undefined, identity.ownerId, 'invalid-session'))).status
    ).toBe(401);
  });
});
