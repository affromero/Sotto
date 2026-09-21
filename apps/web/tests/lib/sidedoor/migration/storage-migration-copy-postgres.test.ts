// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import {
  admitSottoStorageCopy,
  executeSottoStorageCopy,
} from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import { readStorageMigrationAssetPage } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('storage copy publication with PostgreSQL and local files', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const roots: string[] = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('storage_migration_copy');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });
  async function backend() {
    const root = await mkdtemp(join(tmpdir(), 'sotto-copy-test-'));
    roots.push(root);
    return capturedLocalBackend(
      await LocalStorageCleanup.capture(root),
      root,
      LOCAL_STORAGE_URL_PREFIX,
      () => {}
    );
  }
  async function fixture(episodeId?: string) {
    const source = await backend();
    const target = await backend();
    const bytes = Buffer.from('A complete immutable avatar');
    const key = `${randomUUID()}.png`;
    const reference = await source.writeBuffer(key, bytes, 'image/png');
    await sottoTransaction(instance.database, async (tx) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const captured = prepareStorageBackend(SIDEDOOR_STATE_ID, source.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(captured);
      const current = await sottoStorageInstance(tx).read();
      const owner = await tx.user.findUniqueOrThrow({ where: { id: identity.ownerId } });
      const scopes = episodeId
        ? (await captureEpisodeStorage(tx, episodeId)).scopes
        : [
            { subjectId: current.subjectId, generation: current.generation },
            { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() },
          ];
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          {
            consumer: episodeId ? `episode:${episodeId}:audio` : `profile:${owner.id}:avatar`,
            previousReference: null,
          },
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
          target: { backendId: captured.id, binding: captured.binding, key },
          scopes,
        }),
      });
      if (episodeId)
        await tx.episode.update({ where: { id: episodeId }, data: { audioUrl: reference } });
      else await tx.user.update({ where: { id: owner.id }, data: { image: reference } });
    });
    const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!admission || admission.kind !== 'content') throw new Error('Missing owner admission');
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, request, admission })
    );
    const entry = page.entries[0];
    if (!entry || page.issues.length) throw new Error('Missing copy candidate');
    const operationId = randomUUID();
    const parent = await sottoTransaction(instance.database, (tx) =>
      admitSottoStorageCopy(tx, {
        request,
        admission,
        operationId,
        entry,
        target: target.descriptor,
        timeoutMs: 30_000,
      })
    );
    return {
      bytes,
      reference,
      target,
      options: {
        database: instance.database,
        request,
        admission,
        operationId,
        fingerprint: parent.fingerprint,
        target,
      },
    };
  }
  it('copies identical bytes and replays the sealed publication without storage I/O', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    expect(outcome.reference).not.toBe(test.reference);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(outcome.reference);
    const root = await mkdtemp(join(tmpdir(), 'sotto-copy-read-'));
    roots.push(root);
    const path = join(root, 'result');
    await test.target.downloadToFile(outcome.reference, path);
    expect(await readFile(path)).toEqual(test.bytes);
    const rejectIo = async (): Promise<never> => {
      throw new Error('Replay attempted storage I/O');
    };
    expect(
      await executeSottoStorageCopy({
        ...test.options,
        target: { ...test.target, writeStream: rejectIo, downloadToFile: rejectIo },
      })
    ).toEqual(outcome);
  });
  it('rejects a changed destination before copying and retains the original reference', async () => {
    const test = await fixture();
    await expect(
      executeSottoStorageCopy({ ...test.options, target: await backend() })
    ).rejects.toThrow('destination or requester changed');
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(test.reference);
  });
  it.each(['pending', 'completed'] as const)(
    'rejects %s copy replay after a parent change within the same course',
    async (state) => {
      const curriculum = await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
        create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
        update: {},
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'es',
        },
      });
      const episode = await instance.database.episode.create({
        data: { userId: identity.ownerId, title: 'Lesson', topic: 'Topic' },
      });
      const previous = await instance.database.practiceSession.create({
        data: {
          courseId: course.id,
          episodeId: episode.id,
          kind: 'LISTENING',
          items: [],
          seed: 'previous',
        },
      });
      const test = await fixture(episode.id);
      const before = await sottoTransaction(instance.database, (tx) =>
        captureEpisodeStorage(tx, episode.id)
      );
      const reference =
        state === 'completed'
          ? (await executeSottoStorageCopy(test.options)).reference
          : test.reference;
      await instance.database.practiceSession.update({
        where: { id: previous.id },
        data: { episodeId: null },
      });
      await instance.database.practiceSession.create({
        data: {
          courseId: course.id,
          episodeId: episode.id,
          kind: 'LISTENING',
          items: [],
          seed: 'replacement',
        },
      });
      const after = await sottoTransaction(instance.database, (tx) =>
        captureEpisodeStorage(tx, episode.id)
      );
      expect(after.scopes).toEqual(before.scopes);
      expect(after.associations).not.toEqual(before.associations);
      const replay = executeSottoStorageCopy(test.options);
      if (state === 'pending')
        await expect(replay).rejects.toMatchObject({
          errors: expect.arrayContaining([
            expect.objectContaining({ message: 'Storage copy consumer ownership changed' }),
          ]),
        });
      else await expect(replay).rejects.toThrow('Storage copy consumer ownership changed');
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).audioUrl
      ).toBe(reference);
    }
  );
  it('recovers an accepted publication after the database loses its commit response', async () => {
    const test = await fixture();
    let lostResponse = false;
    const database = new Proxy(instance.database, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: Parameters<PrismaClient['$transaction']>[1]
        ) => {
          const result = await target.$transaction(operation, options);
          if (!lostResponse) {
            const parent = await sottoTransaction(instance.database, (tx) =>
              sottoJobOutbox(tx).read(test.options.operationId)
            );
            if (parent?.complete) {
              lostResponse = true;
              throw new Error('Connection lost after publication COMMIT');
            }
          }
          return result;
        };
      },
    });
    const target = {
      ...test.target,
      writeStream: async (...args: Parameters<typeof test.target.writeStream>) => {
        if (lostResponse) throw new Error('Recovery attempted another upload');
        return test.target.writeStream(...args);
      },
      downloadToFile: async (...args: Parameters<typeof test.target.downloadToFile>) => {
        if (lostResponse) throw new Error('Recovery attempted another readback');
        return test.target.downloadToFile(...args);
      },
    };
    const outcome = await executeSottoStorageCopy({ ...test.options, database, target });
    expect(lostResponse).toBe(true);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(outcome.reference);
    expect(await executeSottoStorageCopy({ ...test.options, database, target })).toEqual(outcome);
  });
  it('rejects completed replay after the original owner logs out', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    await identity.access.logout(identity.ownerToken);
    await expect(executeSottoStorageCopy(test.options)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(outcome.reference);
  });
  it('verifies the original copy after the asset is relocated again', async () => {
    const test = await fixture();
    const first = await executeSottoStorageCopy(test.options);
    const { request, admission } = test.options;
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, request, admission })
    );
    const entry = page.entries[0];
    if (!entry || page.entries.length !== 1 || page.issues.length)
      throw new Error('Missing second copy candidate');
    const target = await backend();
    const operationId = randomUUID();
    const parent = await sottoTransaction(instance.database, (tx) =>
      admitSottoStorageCopy(tx, {
        request,
        admission,
        operationId,
        entry,
        target: target.descriptor,
        timeoutMs: 30_000,
      })
    );
    const second = await executeSottoStorageCopy({
      ...test.options,
      target,
      operationId,
      fingerprint: parent.fingerprint,
    });
    expect(second.reference).not.toBe(first.reference);
    expect(await executeSottoStorageCopy(test.options)).toEqual(first);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(second.reference);
  });
  it('rejects mismatched readback bytes without publishing the new reference', async () => {
    const test = await fixture();
    const target = {
      ...test.target,
      downloadToFile: async (...args: Parameters<typeof test.target.downloadToFile>) => {
        const content = await test.target.downloadToFile(...args);
        return { ...content, bytes: content.bytes + 1 };
      },
    };
    await expect(executeSottoStorageCopy({ ...test.options, target })).rejects.toThrow(
      'readback does not match source bytes'
    );
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(test.reference);
  });
});
