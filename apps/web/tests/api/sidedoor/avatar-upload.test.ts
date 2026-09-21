// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageWriteJournal, prepareStorageTombstone } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { POST } from '@/app/api/v1/users/me/avatar/route';
import { PATCH } from '@/app/api/v1/profiles/[id]/route';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const binding = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  ownerId: '',
  objects: new Map<string, string>(),
  duringWrite: null as (() => Promise<void>) | null,
  loseCommit: false,
  afterCommit: null as (() => Promise<void>) | null,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(binding), {
    get(...parameters) {
      if (parameters[1] !== '$transaction') return Reflect.get(...parameters);
      return async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }
      ) => {
        if (!binding.database) throw new Error('Database unavailable');
        let changed = false;
        const result = await binding.database.$transaction(async (tx) => {
          const before = await tx.user.findUnique({
            where: { id: binding.ownerId },
            select: { image: true },
          });
          const value = await operation(tx);
          const after = await tx.user.findUnique({
            where: { id: binding.ownerId },
            select: { image: true },
          });
          changed = before?.image !== after?.image;
          return value;
        }, options);
        if (changed && binding.loseCommit) {
          binding.loseCommit = false;
          await binding.afterCommit?.();
          throw new Error('Connection lost after database committed');
        }
        return result;
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@aws-sdk/client-s3', async (original) => {
  const sdk = await original<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class {
      async send(command: unknown) {
        if (!(command instanceof sdk.PutObjectCommand))
          throw new Error('Unexpected object operation');
        const { Key, Body, IfNoneMatch } = command.input;
        if (!Key || !(Body instanceof Uint8Array) || IfNoneMatch !== '*')
          throw new Error('Invalid object write');
        if (binding.objects.has(Key)) throw new Error('Object collision');
        binding.objects.set(Key, Buffer.from(Body).toString());
        await binding.duringWrite?.();
        return {};
      }
    },
  };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('avatar uploads with shared authority and durable storage writes', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const directories: string[] = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('avatar_upload');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'avatar-test-encryption-key');
    identity = await instance.reset();
    await instance.configureInfrastructure({
      storageProvider: 'r2',
      objectStorageEndpoint: 'https://test-account.r2.cloudflarestorage.com',
      objectStorageBucket: 'private',
      objectStorageRegion: 'auto',
      objectStoragePublicUrl: 'https://media.example',
    });
    await instance.seedStorageCredential(
      'r2',
      'https://test-account.r2.cloudflarestorage.com',
      'test-key',
      'test-secret'
    );
    binding.ownerId = identity.ownerId;
    binding.objects.clear();
    binding.duringWrite = null;
    binding.loseCommit = false;
    binding.afterCommit = null;
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { image: '/avatars/toucan.png' },
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    binding.database = null;
    await instance?.close();
  });
  it.each(['missing-instance', 'duplicate-scope', 'invalid-generation', 'long-consumer'])(
    'rejects %s admission before storage I/O and releases the input stream',
    async (invalid) => {
      const body = Readable.from(['unadmitted bytes']);
      await expect(
        writeStorageReference({
          database: instance.database,
          signal: new AbortController().signal,
          prefix: 'avatars',
          extension: 'png',
          contentType: 'image/png',
          body,
          captureAdmission: async (tx) => {
            const storage = await sottoStorageInstance(tx).read();
            const scope = { subjectId: storage.subjectId, generation: storage.generation };
            return {
              instanceId: storage.instanceId,
              consumer:
                invalid === 'long-consumer'
                  ? 'x'.repeat(201)
                  : `profile:${identity.ownerId}:avatar`,
              scopes:
                invalid === 'missing-instance'
                  ? [{ subjectId: 'unrelated', generation: 1 }]
                  : invalid === 'duplicate-scope'
                    ? [scope, scope]
                    : [
                        scope,
                        {
                          subjectId: `profile:${identity.ownerId}`,
                          generation: invalid === 'invalid-generation' ? -1 : 1,
                        },
                      ],
              snapshot: null,
            };
          },
          validateAdmission: async () => {},
          previousReference: () => null,
          commit: async (tx, url) => {
            await tx.user.update({ where: { id: identity.ownerId }, data: { image: url } });
          },
        })
      ).rejects.toThrow();
      expect(body.destroyed).toBe(true);
      expect(binding.objects.size).toBe(0);
      expect(await writes()).toEqual([]);
      expect(await image()).toBe('/avatars/toucan.png');
    }
  );
  it('keeps captured ownership and reference data isolated from admission callbacks', async () => {
    const storage = await sottoTransaction(instance.database, (tx) =>
      sottoStorageInstance(tx).read()
    );
    const user = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const consumer = `profile:${identity.ownerId}:avatar`;
    const captured = {
      instanceId: storage.instanceId,
      consumer,
      scopes: [
        { subjectId: storage.subjectId, generation: storage.generation },
        { subjectId: `profile:${identity.ownerId}`, generation: user.createdAt.getTime() },
      ],
      snapshot: { previous: user.image },
    };
    binding.duringWrite = async () => {
      captured.consumer = 'unrelated-consumer';
      captured.scopes[1].subjectId = 'unrelated-profile';
      captured.snapshot.previous = 'https://unrelated.example/asset';
    };
    const url = await writeStorageReference({
      database: instance.database,
      signal: new AbortController().signal,
      prefix: 'avatars',
      extension: 'png',
      contentType: 'image/png',
      body: Buffer.from('isolated upload'),
      captureAdmission: async () => captured,
      validateAdmission: async (tx, admission) => {
        expect((await sottoStorageInstance(tx).read()).instanceId).toBe(admission.instanceId);
        admission.snapshot.previous = 'https://callback.example/asset';
      },
      previousReference: (snapshot) => {
        expect(snapshot.previous).toBe('/avatars/toucan.png');
        return null;
      },
      commit: async (tx, next, snapshot) => {
        expect(snapshot.previous).toBe('/avatars/toucan.png');
        await tx.user.update({ where: { id: identity.ownerId }, data: { image: next } });
      },
    });
    expect(await image()).toBe(url);
    const assets = await instance.database.$queryRawUnsafe<{ consumers: string[] }[]>(
      `SELECT state->'consumers' AS consumers FROM "SidedoorState" WHERE state->>'kind' = 'storage_asset'`
    );
    expect(assets).toEqual([{ consumers: [consumer] }]);
  });
  function request(
    token = identity.ownerToken,
    origin = 'http://localhost:3000',
    file: File | string = new File(['avatar bytes'], 'avatar.png', { type: 'image/png' })
  ) {
    const body = new FormData();
    body.set('avatar', file);
    return new NextRequest('http://localhost:3000/api/v1/users/me/avatar', {
      method: 'POST',
      headers: { cookie: `sotto_session=${token}`, origin },
      body,
    });
  }
  async function image() {
    return (
      await instance.database.user.findUniqueOrThrow({
        where: { id: identity.ownerId },
        select: { image: true },
      })
    ).image;
  }
  async function writes() {
    return instance.database.$queryRawUnsafe<
      { subject: string; status: string; outcome: string }[]
    >(
      `SELECT state->>'subjectId' AS subject, state->>'status' AS status, state->>'outcome' AS outcome FROM "SidedoorState" WHERE state->>'kind' = 'write' ORDER BY id`
    );
  }
  function preset(avatarSlug: string) {
    return PATCH(
      new NextRequest(`http://localhost:3000/api/v1/profiles/${identity.ownerId}`, {
        method: 'PATCH',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ avatarSlug }),
      }),
      { params: Promise.resolve({ id: identity.ownerId }) }
    );
  }
  it('retires an uploaded avatar atomically when selecting a preset without treating bundled files as storage', async () => {
    const uploaded = await POST(request());
    expect(uploaded.status).toBe(200);
    const uploadedUrl = (await uploaded.json()).url;
    expect((await preset('jaguar')).status).toBe(200);
    expect(await image()).toBe('/avatars/jaguar.png');
    const retired = await instance.database.$queryRawUnsafe<{ state: Record<string, unknown> }[]>(
      `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'storage_reference_retirement'`
    );
    expect(retired).toEqual([
      {
        state: expect.objectContaining({
          previousReference: uploadedUrl,
          replacementAssetId: null,
          status: 'pending',
          attribution: expect.objectContaining({
            prepared: expect.objectContaining({ reference: uploadedUrl }),
          }),
        }),
      },
    ]);
    const assets = await instance.database.$queryRawUnsafe<{ consumers: string[] }[]>(
      `SELECT state->'consumers' AS consumers FROM "SidedoorState" WHERE state->>'kind' = 'storage_asset'`
    );
    expect(assets).toEqual([{ consumers: [] }]);
    expect((await preset('toucan')).status).toBe(200);
    expect((await preset('toucan')).status).toBe(200);
    const remaining = await instance.database.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM "SidedoorState" WHERE state->>'kind' = 'storage_reference_retirement'`
    );
    expect(remaining[0]?.count).toBe(1n);
    expect(binding.objects.size).toBe(1);
  });
  it('preserves the uploaded avatar and ownership if preset retirement cannot commit', async () => {
    const uploaded = await POST(request());
    expect(uploaded.status).toBe(200);
    const uploadedUrl = (await uploaded.json()).url;
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "SidedoorState" ADD CONSTRAINT preset_retirement_rejected CHECK (state->>'kind' <> 'storage_reference_retirement')`
    );
    try {
      expect((await preset('jaguar')).status).toBe(503);
      expect(await image()).toBe(uploadedUrl);
      const assets = await instance.database.$queryRawUnsafe<{ consumers: string[] }[]>(
        `SELECT state->'consumers' AS consumers FROM "SidedoorState" WHERE state->>'kind' = 'storage_asset'`
      );
      expect(assets).toEqual([{ consumers: [`profile:${identity.ownerId}:avatar`] }]);
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "SidedoorState" DROP CONSTRAINT preset_retirement_rejected'
      );
    }
  });
  it('retains unknown avatar-like paths for attribution instead of assuming they are bundled', async () => {
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { image: '/avatars/custom-upload.png' },
    });
    expect((await preset('jaguar')).status).toBe(200);
    expect(await image()).toBe('/avatars/jaguar.png');
    const retired = await instance.database.$queryRawUnsafe<{ state: Record<string, unknown> }[]>(
      `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'storage_reference_retirement'`
    );
    expect(retired).toEqual([
      {
        state: expect.objectContaining({
          previousReference: '/avatars/custom-upload.png',
          attribution: null,
          status: 'unresolved',
        }),
      },
    ]);
  });
  it('commits the avatar and every scope receipt together under a unique instance key', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const { url } = await response.json();
    expect(await image()).toBe(url);
    const scope = await sottoStorageInstance(instance.database).read();
    expect(url).toMatch(`https://media.example/avatars/${identity.ownerId}/${scope.instanceId}/`);
    expect([...binding.objects.values()]).toEqual(['avatar bytes']);
    expect(await writes()).toEqual([]);
    const receipts = await instance.database.$queryRawUnsafe<{ outcome: string }[]>(
      `SELECT state->>'outcome' AS outcome FROM "SidedoorState" WHERE state->>'kind' = 'write_receipt'`
    );
    expect(receipts).toEqual([{ outcome: 'referenced' }, { outcome: 'referenced' }]);
  });
  it('persists local avatar bytes and their exact attributed route', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-avatar-local-'));
    directories.push(directory);
    await instance.configureInfrastructure({
      storageProvider: 'local',
      localStorageRoot: directory,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const { url } = await response.json();
    expect(url).toMatch(/^\/api\/v1\/storage\/avatars\//);
    expect(await image()).toBe(url);
    const assets = await instance.database.$queryRawUnsafe<{ key: string }[]>(
      `SELECT state->'prepared'->'target'->>'key' AS key FROM "SidedoorState" WHERE state->>'kind' = 'storage_asset'`
    );
    expect(assets).toHaveLength(1);
    expect(await readFile(join(directory, assets[0]!.key), 'utf8')).toBe('avatar bytes');
    expect(await writes()).toEqual([]);
  });
  it('reconciles a lost commit response without repeating the upload or deleting its reference', async () => {
    binding.loseCommit = true;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await image()).toBe((await response.json()).url);
    expect(binding.objects.size).toBe(1);
    expect(await writes()).toEqual([]);
  });
  it('does not return a superseded avatar as current after a lost commit response', async () => {
    binding.loseCommit = true;
    binding.afterCommit = async () => {
      expect((await preset('jaguar')).status).toBe(200);
    };
    const response = await POST(request());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await image()).toBe('/avatars/jaguar.png');
    expect(binding.objects.size).toBe(1);
    expect(await writes()).toEqual([]);
    const retired = await instance.database.$queryRawUnsafe<{ state: Record<string, unknown> }[]>(
      `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'storage_reference_retirement'`
    );
    expect(retired).toHaveLength(1);
    expect(retired[0]?.state).toMatchObject({
      consumer: `profile:${identity.ownerId}:avatar`,
      status: 'pending',
    });
  });
  it('retains unresolved attribution and known replaced assets in the same avatar transaction', async () => {
    const unresolved = 'https://unattributed.example/outside-layout/avatar.png';
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { image: unresolved },
    });
    const first = await POST(request());
    expect(first.status).toBe(200);
    const previousUrl = (await first.json()).url;
    expect((await POST(request())).status).toBe(200);
    const records = await instance.database.$queryRawUnsafe<{ state: Record<string, unknown> }[]>(
      `SELECT state FROM "SidedoorState" WHERE state->>'kind' = 'storage_reference_retirement'`
    );
    expect(records.map((record) => record.state)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          previousReference: unresolved,
          status: 'unresolved',
          attribution: null,
        }),
        expect.objectContaining({
          previousReference: previousUrl,
          status: 'pending',
          attribution: expect.objectContaining({
            prepared: expect.objectContaining({
              reference: previousUrl,
              target: expect.objectContaining({
                backendId: expect.any(String),
                key: expect.any(String),
              }),
            }),
          }),
        }),
      ])
    );
    expect(records).toHaveLength(2);
  });
  it('rolls back the new avatar when durable retirement cannot be persisted', async () => {
    const previous = 'https://previous.example/avatar.png';
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { image: previous },
    });
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "SidedoorState" ADD CONSTRAINT avatar_retirement_rejected CHECK (state->>'kind' <> 'storage_reference_retirement')`
    );
    try {
      expect((await POST(request())).status).toBe(503);
      expect(await image()).toBe(previous);
      const assets = await instance.database.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "SidedoorState" WHERE state->>'kind' IN ('storage_asset','storage_reference_alias','write_receipt')`
      );
      expect(assets[0]?.count).toBe(0n);
      expect(await writes()).toHaveLength(2);
      expect((await writes()).every((write) => write.outcome === 'unreferenced')).toBe(true);
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "SidedoorState" DROP CONSTRAINT avatar_retirement_rejected'
      );
    }
  });
  it('bounds the whole multipart body even when an extra field exceeds the limit or Content-Length lies', async () => {
    const body = new FormData();
    body.set('avatar', new File(['small'], 'avatar.png', { type: 'image/png' }));
    body.set('extra', 'x'.repeat(3 * 1024 * 1024));
    const incoming = new NextRequest('http://localhost:3000/api/v1/users/me/avatar', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: `sotto_session=${identity.ownerToken}`,
        'content-length': '1',
      },
      body,
    });
    expect((await POST(incoming)).status).toBe(413);
    expect(await image()).toBe('/avatars/toucan.png');
    expect(binding.objects.size).toBe(0);
    expect(await writes()).toEqual([]);
  });
  it('keeps the existing avatar when the session is revoked during storage I/O', async () => {
    binding.duringWrite = () => identity.access.logout(identity.ownerToken);
    expect((await POST(request())).status).toBe(401);
    expect(await image()).toBe('/avatars/toucan.png');
    expect(await writes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: `profile:${identity.ownerId}`,
          status: 'settled',
          outcome: 'unreferenced',
        }),
        expect.objectContaining({ status: 'settled', outcome: 'unreferenced' }),
      ])
    );
    expect((await writes()).length).toBe(2);
  });
  it('preserves a newer avatar selected while an upload is running', async () => {
    binding.duringWrite = async () => {
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: { image: '/avatars/sloth.png' },
      });
    };
    expect((await POST(request())).status).toBe(409);
    expect(await image()).toBe('/avatars/sloth.png');
    expect((await writes()).every((write) => write.outcome === 'unreferenced')).toBe(true);
  });
  it('retains ambiguous remote writes and does not change the avatar', async () => {
    binding.duringWrite = async () => {
      throw new Error('Storage response lost after write');
    };
    expect((await POST(request())).status).toBe(503);
    expect(await image()).toBe('/avatars/toucan.png');
    expect(await writes()).toHaveLength(2);
    expect((await writes()).every((write) => write.status === 'uncertain')).toBe(true);
  });
  it('refuses the reference after instance erasure begins', async () => {
    const scope = await sottoStorageInstance(instance.database).read();
    const marker = prepareStorageTombstone({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: scope.subjectId,
      generation: 0,
      jobId: randomUUID(),
    });
    binding.duringWrite = () =>
      sottoTransaction(instance.database, async (tx) => {
        await new StorageWriteJournal(
          { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
          'postgres',
          SIDEDOOR_STATE_ID
        ).forbidWrites(marker);
      });
    expect((await POST(request())).status).toBe(503);
    expect(await image()).toBe('/avatars/toucan.png');
    expect(await writes()).toHaveLength(2);
  });
  it('rejects missing authority, cross-origin requests, and invalid uploads before storage I/O', async () => {
    expect((await POST(request('invalid'))).status).toBe(401);
    expect((await POST(request(identity.ownerToken, 'https://other.example'))).status).toBe(403);
    expect((await POST(request(identity.ownerToken, undefined, 'not a file'))).status).toBe(400);
    expect(
      (
        await POST(
          request(
            identity.ownerToken,
            undefined,
            new File(['text'], 'file.txt', { type: 'text/plain' })
          )
        )
      ).status
    ).toBe(400);
    expect(binding.objects.size).toBe(0);
    expect(await writes()).toEqual([]);
  });
});
