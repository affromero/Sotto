// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET, POST, PATCH } from '@/app/api/v1/admin/material-recognition-capabilities/route';
import {
  MATERIAL_RECOGNITION_CAPABILITIES_ID,
  materialRecognitionCapabilitiesStateSchema,
  materialRecognitionCapabilityHash,
  findMaterialRecognitionCapability,
  readMaterialRecognitionCapabilities,
  validateMaterialRecognitionCapability,
} from '@/lib/course-materials/recognition/capabilities';
import { materialRecognitionCapabilitySchema } from '@/lib/course-materials/recognition/protocol';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const endpoint = 'http://localhost:3000/api/v1/admin/material-recognition-capabilities';
const documentationUrl = 'https://docs.example.invalid/reviewed-vision#handwriting';
const capability = (model = 'explicit-fixture-model', revision = '1') =>
  materialRecognitionCapabilitySchema.parse({
    schemaVersion: 1,
    source: 'REVIEWED_MODEL_CAPABILITY',
    reviewId: `operator-review-${model}`,
    revision,
    provider: 'explicit-fixture-provider',
    model,
    endpoint: 'https://vision.example.invalid/v1',
    vision: true,
    handwriting: true,
    maxImages: 2,
    maxDecodedBytes: 100000,
    minimumDpi: 144,
    maxOutputTokens: 2048,
  });

suite('owner-reviewed material recognition capabilities', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('recognition_capability');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  function request(
    method = 'GET',
    body?: unknown,
    token: string | null = identity.ownerToken,
    origin = 'http://localhost:3000'
  ) {
    return new NextRequest(endpoint, {
      method,
      headers: {
        ...(token ? { cookie: `sotto_session=${token}` } : {}),
        origin,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const review = (expectedRevision = 0, proposed = capability()) => ({
    expectedRevision,
    operatorConfirmed: true as const,
    capability: proposed,
    documentationUrl,
  });
  const revoke = (expectedRevision = 1, proposed = capability()) => ({
    expectedRevision,
    reviewId: proposed.reviewId,
    revision: proposed.revision,
    active: false as const,
  });
  async function state() {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return materialRecognitionCapabilitiesStateSchema.parse(await response.json());
  }

  it('reads an empty registry without creating configuration or changing provider defaults', async () => {
    const before = await instance.database.sidedoorState.findMany({
      orderBy: { id: 'asc' },
    });
    expect(await state()).toEqual({ revision: 0, capabilities: [] });
    expect(
      await instance.database.sidedoorState.findMany({
        orderBy: { id: 'asc' },
      })
    ).toEqual(before);
  });

  it.each(['GET', 'POST', 'PATCH'] as const)(
    'denies ordinary profiles access to %s',
    async (method) => {
      const other = await identity.household('Ordinary learner');
      const response =
        method === 'GET'
          ? await GET(request(method, undefined, other.token))
          : method === 'POST'
            ? await POST(request(method, review(), other.token))
            : await PATCH(request(method, revoke(), other.token));
      expect(response.status).toBe(403);
      expect((await state()).capabilities).toEqual([]);
    }
  );

  it.each(['GET', 'POST', 'PATCH'] as const)('requires authentication for %s', async (method) => {
    const input = method === 'POST' ? review() : method === 'PATCH' ? revoke() : undefined;
    const req = request(method, input, null);
    expect((await { GET, POST, PATCH }[method](req)).status).toBe(401);
  });

  it.each(['POST', 'PATCH'] as const)(
    'requires a trusted browser origin for %s',
    async (method) => {
      const response =
        method === 'POST'
          ? await POST(request(method, review(), identity.ownerToken, 'https://untrusted.invalid'))
          : await PATCH(
              request(method, revoke(), identity.ownerToken, 'https://untrusted.invalid')
            );
      expect(response.status).toBe(403);
      expect(await state()).toEqual({ revision: 0, capabilities: [] });
    }
  );

  it('publishes an exact confirmed review, resolves only its configured selection and validates its frozen hash', async () => {
    const input = review();
    expect((await POST(request('POST', input))).status).toBe(200);
    expect(await state()).toEqual({
      revision: 1,
      capabilities: [{ capability: input.capability, documentationUrl, active: true }],
    });
    const selected = await sottoTransaction(instance.database, (database) =>
      findMaterialRecognitionCapability(database, input.capability)
    );
    expect(selected).toEqual({
      capability: input.capability,
      record: { capability: input.capability, documentationUrl, active: true },
      capabilitySha256: materialRecognitionCapabilityHash(input.capability),
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateMaterialRecognitionCapability(database, input.capability)
      )
    ).resolves.toEqual(selected);
    for (const changed of [
      { ...input.capability, provider: 'different-provider' },
      { ...input.capability, model: 'different-model' },
      { ...input.capability, endpoint: 'https://different.invalid/v1' },
    ])
      expect(
        await sottoTransaction(instance.database, (database) =>
          findMaterialRecognitionCapability(database, changed)
        )
      ).toBeNull();
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateMaterialRecognitionCapability(database, {
          ...input.capability,
          maxDecodedBytes: 99999,
        })
      )
    ).rejects.toThrow();
  });

  it('requires explicit operator confirmation and matches absent endpoints exactly', async () => {
    expect((await POST(request('POST', { ...review(), operatorConfirmed: false }))).status).toBe(
      400
    );
    const missingConfirmation = {
      expectedRevision: 0,
      capability: capability(),
      documentationUrl,
    };
    expect((await POST(request('POST', missingConfirmation))).status).toBe(400);
    expect(await state()).toEqual({ revision: 0, capabilities: [] });
    const input = review(0, { ...capability(), endpoint: null });
    expect((await POST(request('POST', input))).status).toBe(200);
    expect(
      await sottoTransaction(instance.database, (database) =>
        findMaterialRecognitionCapability(database, {
          provider: input.capability.provider,
          model: input.capability.model,
        })
      )
    ).not.toBeNull();
    expect(
      await sottoTransaction(instance.database, (database) =>
        findMaterialRecognitionCapability(database, capability())
      )
    ).toBeNull();
  });

  it('replays immutable review identities without incrementing the logical registry revision', async () => {
    const input = review();
    expect((await POST(request('POST', input))).status).toBe(200);
    const before = await state();
    expect((await POST(request('POST', input))).status).toBe(200);
    expect(await state()).toEqual(before);
    for (const changed of [
      { ...input, capability: { ...input.capability, maxImages: 1 } },
      { ...input, documentationUrl: 'https://docs.example.invalid/different' },
      {
        ...input,
        capability: { ...input.capability, provider: 'different-provider' },
      },
    ])
      expect((await POST(request('POST', changed))).status).toBe(409);
    expect(await state()).toEqual(before);
  });

  it('allows only one of two different concurrent reviews at the same expected revision', async () => {
    const inputs = [review(0, capability('first-model')), review(0, capability('second-model'))];
    const responses = await Promise.all(inputs.map((input) => POST(request('POST', input))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await state();
    expect(saved.revision).toBe(1);
    expect(saved.capabilities).toHaveLength(1);
    const winner = inputs[responses.findIndex((response) => response.status === 200)]!;
    expect(saved.capabilities[0]?.capability).toEqual(winner.capability);
  });

  it('replays simultaneous identical reviews as one immutable version', async () => {
    const input = review();
    const responses = await Promise.all([
      POST(request('POST', input)),
      POST(request('POST', input)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await state()).toEqual({
      revision: 1,
      capabilities: [{ capability: input.capability, documentationUrl, active: true }],
    });
  });

  it('retains revoked versions, blocks captured hashes and requires an explicit new review before reuse', async () => {
    const input = review();
    expect((await POST(request('POST', input))).status).toBe(200);
    const replacement = review(1, capability(input.capability.model, '2'));
    expect((await POST(request('POST', replacement))).status).toBe(409);
    expect((await PATCH(request('PATCH', revoke(0)))).status).toBe(409);
    expect((await PATCH(request('PATCH', revoke()))).status).toBe(200);
    const retired = await state();
    expect(retired).toEqual({
      revision: 2,
      capabilities: [{ capability: input.capability, documentationUrl, active: false }],
    });
    expect((await PATCH(request('PATCH', revoke()))).status).toBe(200);
    expect((await POST(request('POST', input))).status).toBe(200);
    expect(await state()).toEqual(retired);
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateMaterialRecognitionCapability(database, input.capability)
      )
    ).rejects.toThrow();
    expect((await PATCH(request('PATCH', { ...revoke(2), active: true }))).status).toBe(400);
    expect((await POST(request('POST', { ...replacement, expectedRevision: 2 }))).status).toBe(200);
    const latest = await state();
    expect(latest.revision).toBe(3);
    expect(latest.capabilities.map((record) => record.active)).toEqual([false, true]);
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateMaterialRecognitionCapability(database, input.capability)
      )
    ).rejects.toThrow();
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          findMaterialRecognitionCapability(database, input.capability)
        )
      )?.capability.revision
    ).toBe('2');
  });

  it('rechecks a revoked owner session after authenticating and reading the request body', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(review()));
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          await identity.access.logout(identity.ownerToken);
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const req = new NextRequest(endpoint, {
      method: 'POST',
      body,
      headers: {
        cookie: `sotto_session=${identity.ownerToken}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
    });
    expect((await POST(req)).status).toBe(401);
    expect(await sottoTransaction(instance.database, readMaterialRecognitionCapabilities)).toEqual({
      revision: 0,
      capabilities: [],
    });
  });

  it('rechecks owner role changes before publishing an already-authenticated review', async () => {
    await identity.access.setMode(identity.ownerToken, 'individual');
    const ownerToken = await identity.access.login('Owner', 'owner password for integration tests');
    const secondId = await identity.access.addMember(
      ownerToken,
      'Second owner',
      'second owner integration password'
    );
    await identity.access.setRole(ownerToken, secondId, 'owner');
    const secondToken = await identity.access.login(
      'Second owner',
      'second owner integration password'
    );
    const bytes = new TextEncoder().encode(JSON.stringify(review()));
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          await identity.access.setRole(secondToken, identity.ownerId, 'member');
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const req = new NextRequest(endpoint, {
      method: 'POST',
      body,
      headers: {
        cookie: `sotto_session=${ownerToken}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
    });
    expect((await POST(req)).status).toBe(401);
    expect(await sottoTransaction(instance.database, readMaterialRecognitionCapabilities)).toEqual({
      revision: 0,
      capabilities: [],
    });
  });

  it('rejects secret-bearing URLs and unknown credential fields without echoing their contents', async () => {
    const secret = 'DO_NOT_ECHO_PROVIDER_SECRET';
    const input = review();
    for (const changed of [
      { ...input, capability: { ...input.capability, apiKey: secret } },
      { ...input, credentials: { apiKey: secret } },
      { ...input, capability: { ...input.capability, model: 'invalid\u0000model' } },
      {
        ...input,
        capability: {
          ...input.capability,
          endpoint: `https://user:${secret}@vision.example.invalid/v1`,
        },
      },
      {
        ...input,
        capability: {
          ...input.capability,
          endpoint: `https://vision.example.invalid/v1?api_key=${secret}`,
        },
      },
      {
        ...input,
        documentationUrl: `https://docs.example.invalid/review?token=${secret}`,
      },
      { ...input, documentationUrl: 'http://docs.example.invalid/review' },
    ]) {
      const response = await POST(request('POST', changed));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(secret);
    }
    await instance.database.sidedoorState.create({
      data: {
        id: 'unrelated-private-credential-fixture',
        revision: randomUUID(),
        state: { apiKey: secret },
      },
    });
    expect(await (await GET(request())).text()).not.toContain(secret);
    expect(await state()).toEqual({ revision: 0, capabilities: [] });
  });

  it('retains the bounded 100-review history instead of dropping old reviews to admit another', async () => {
    const saved = materialRecognitionCapabilitiesStateSchema.parse({
      revision: 100,
      capabilities: Array.from({ length: 100 }, (_, index) => ({
        capability: capability(`retired-model-${index}`),
        documentationUrl,
        active: false,
      })),
    });
    await instance.database.sidedoorState.create({
      data: {
        id: MATERIAL_RECOGNITION_CAPABILITIES_ID,
        revision: randomUUID(),
        state: saved,
      },
    });
    expect((await POST(request('POST', review(100)))).status).toBe(409);
    expect(await state()).toEqual(saved);
  });

  it('bounds request bytes and rejects unknown mutation fields before storing a review', async () => {
    expect((await POST(request('POST', { ...review(), large: 'x'.repeat(33000) }))).status).toBe(
      413
    );
    expect((await PATCH(request('PATCH', { ...revoke(), capability: capability() }))).status).toBe(
      400
    );
    expect(await state()).toEqual({ revision: 0, capabilities: [] });
  });
});
