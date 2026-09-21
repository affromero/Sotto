// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { StorageCleanupJournal, StorageWriteJournal } from 'thesidedoor-core/storage';
import { prepareJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { checkSottoJobStorage } from '@/lib/sidedoor/storage/migration/storage-job-probe';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { POST } from '@/app/api/v1/onboarding/check-storage/route';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { setSiteConfig } from '@/lib/site-config';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  endpoint: '',
  clients: [] as (() => void)[],
  afterStorageClose: null as (() => Promise<void>) | null,
  afterTransaction: null as (() => Promise<void>) | null,
  terminateStorage: null as (() => Promise<void>) | null,
}));
vi.mock('pg', async (importOriginal) => {
  const pg = await importOriginal<typeof import('pg')>();
  return {
    ...pg,
    Client: class extends pg.Client {
      private readonly storageSession: boolean;
      constructor(options: ConstructorParameters<typeof pg.Client>[0]) {
        super(options);
        this.storageSession =
          typeof options === 'object' && options?.application_name === 'sotto-storage-cleanup';
        if (this.storageSession)
          boundary.terminateStorage = async () => {
            const pid = (await this.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
              .rows[0]?.pid;
            if (!pid || !boundary.database) throw new Error('Missing owned test connection');
            const lost = new Promise<void>((resolve) => this.once('error', () => resolve()));
            await boundary.database.$queryRawUnsafe('SELECT pg_terminate_backend($1)', pid);
            await lost;
          };
      }
      override async end(): Promise<void> {
        await super.end();
        if (this.storageSession) await boundary.afterStorageClose?.();
      }
    },
  };
});
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class extends sdk.S3Client {
      constructor(options: ConstructorParameters<typeof sdk.S3Client>[0]) {
        super({ ...options, endpoint: boundary.endpoint, forcePathStyle: true, maxAttempts: 1 });
        boundary.clients.push(() => this.destroy());
      }
    },
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(boundary), {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property !== '$transaction') return value;
      const transaction = value as (...args: unknown[]) => Promise<unknown>;
      return async (...args: unknown[]) => {
        const result = await transaction(...args);
        await boundary.afterTransaction?.();
        return result;
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});
suite('journaled onboarding storage checks', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('storage_probe');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'sotto-storage-probe-test-key');
    directory = await mkdtemp(join(tmpdir(), 'sotto-probe-'));
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    await setSiteConfig(
      { storageProvider: 'local', localStorageRoot: directory },
      identity.ownerId
    );
  });
  afterEach(async () => {
    boundary.afterStorageClose = null;
    boundary.afterTransaction = null;
    boundary.terminateStorage = null;
    for (const close of boundary.clients.splice(0)) close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await instance?.close();
  });
  function request(authenticated = true, signal?: AbortSignal, provider: 'local' | 'r2' = 'local') {
    const objectStorage =
      provider === 'r2'
        ? {
            endpoint: boundary.endpoint,
            bucket: 'media',
            region: 'auto',
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
          }
        : {};
    return new NextRequest('http://localhost/api/v1/onboarding/check-storage', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` } : {}),
      },
      body: JSON.stringify({ provider, localStorageRoot: directory, ...objectStorage }),
    });
  }
  async function jobs() {
    return new StorageCleanupJournal(
      {
        query: (sql, values) =>
          instance.database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    ).listJobs();
  }
  it('returns readiness only after the probe is deleted and cleanup is recorded complete', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, provider: 'local' });
    expect((await jobs()).jobs).toEqual([expect.objectContaining({ phase: 'complete' })]);
    expect(
      (await readdir(directory, { recursive: true })).filter((name) => name.endsWith('.txt'))
    ).toEqual([]);
    const again = await POST(request());
    expect(again.status).toBe(200);
    expect((await jobs()).jobs).toHaveLength(2);
  });
  it('rejects unauthenticated requests without admitting a probe', async () => {
    expect((await POST(request(false))).status).toBe(401);
    expect((await jobs()).jobs).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });
  it('rejects readiness when storage configuration changes during lock release', async () => {
    boundary.afterStorageClose = async () => {
      await setSiteConfig({ storageProvider: 'r2' }, identity.ownerId);
    };
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Storage configuration changed during the check',
    });
    expect((await jobs()).jobs[0]).toMatchObject({ phase: 'complete' });
  });
  it('returns cancellation without admitting an already cancelled request', async () => {
    const response = await POST(request(true, AbortSignal.abort()));
    expect(response.status).toBe(499);
    expect((await jobs()).jobs).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });
  it.each(['logout', 'cancel'] as const)(
    'rejects readiness after %s during confirmed lock release',
    async (mode) => {
      const controller = new AbortController();
      boundary.afterStorageClose = async () => {
        if (mode === 'logout') await identity.access.logout(identity.ownerToken);
        else controller.abort(new Error('Caller cancelled during lock release'));
      };
      const response = await POST(request(true, controller.signal));
      expect(response.status).toBe(mode === 'logout' ? 401 : 499);
      expect((await jobs()).jobs).toEqual([expect.objectContaining({ phase: 'complete' })]);
      expect(
        (await readdir(directory, { recursive: true })).filter((name) => name.endsWith('.txt'))
      ).toEqual([]);
    }
  );
  it('does not upload when its lock connection is terminated immediately after admission', async () => {
    let terminated = false;
    boundary.afterTransaction = async () => {
      if ((await jobs()).jobs.length !== 1) return;
      boundary.afterTransaction = null;
      if (!boundary.terminateStorage) throw new Error('Missing storage connection');
      await boundary.terminateStorage();
      terminated = true;
    };
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(terminated).toBe(true);
    expect((await jobs()).jobs).toHaveLength(1);
    expect((await jobs()).jobs[0]).not.toMatchObject({ phase: 'complete' });
    expect(
      (await readdir(directory, { recursive: true })).filter((name) => name.endsWith('.txt'))
    ).toEqual([]);
    const writes = new StorageWriteJournal(
      {
        query: (sql, values) =>
          instance.database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    expect((await writes.list(`profile:${identity.ownerId}`)).intents).toEqual([]);
    const retry = await POST(request());
    expect(retry.status).toBe(422);
    expect(await retry.json()).toMatchObject({
      detail: expect.stringContaining('unresolved cleanup execution'),
    });
    expect((await jobs()).jobs).toHaveLength(1);
    expect((await jobs()).jobs[0]).not.toMatchObject({ phase: 'complete' });
    expect(
      (await readdir(directory, { recursive: true })).filter((name) => name.endsWith('.txt'))
    ).toEqual([]);
  });
  it.each(['timeout', 'logout', 'cancel', 'job-cancel', 'job-complete'] as const)(
    'preserves cleanup and authority after storage %s',
    async (mode) => {
      const objects = new Set<string>();
      const controller = new AbortController();
      let parent: OutboxJob | undefined;
      let finishDelete: (() => void) | undefined;
      const server = createServer((incoming, response) => {
        incoming.resume();
        const url = new URL(incoming.url!, 'http://storage.test');
        const key = decodeURIComponent(url.pathname.replace(/^\/media\//, ''));
        if (incoming.method === 'PUT') {
          objects.add(key);
          const complete = () => {
            response.writeHead(200, { ETag: '"probe"' });
            response.end();
          };
          if (mode === 'logout') {
            void identity.access
              .logout(identity.ownerToken)
              .then(complete, (error) => response.destroy(error));
          } else complete();
          return;
        }
        if (incoming.method === 'DELETE') {
          if (mode === 'job-cancel' || mode === 'job-complete') {
            const pendingParent = parent;
            if (!pendingParent) {
              response.destroy(new Error('Missing probe parent'));
              return;
            }
            if (mode === 'job-cancel')
              controller.abort(new Error('Caller cancelled while deletion was pending'));
            const completion =
              mode === 'job-complete'
                ? sottoTransaction(instance.database, (tx) =>
                    sottoJobOutbox(tx).complete(pendingParent.job.id, pendingParent.fingerprint)
                  )
                : Promise.resolve();
            void completion.then(
              () => {
                objects.delete(key);
                response.writeHead(204);
                response.end();
              },
              (error) => response.destroy(error)
            );
            return;
          }
          if (mode !== 'timeout') {
            objects.delete(key);
            response.writeHead(204);
            response.end();
            if (mode === 'cancel') controller.abort(new Error('Caller cancelled after deletion'));
            return;
          }
          let finished = false;
          finishDelete = () => {
            if (finished) return;
            finished = true;
            objects.delete(key);
            response.writeHead(204);
            response.end();
          };
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        if (url.searchParams.has('uploads')) {
          response.end(
            '<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>'
          );
          return;
        }
        response.end(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects]
            .map((entry) => `<Contents><Key>${entry}</Key></Contents>`)
            .join('')}</ListBucketResult>`
        );
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing storage test endpoint');
      boundary.endpoint = `http://127.0.0.1:${address.port}`;
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      if (mode === 'timeout')
        vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
          timeout(ms === 30_000 ? 250 : ms)
        );
      try {
        if (mode === 'job-cancel' || mode === 'job-complete') {
          await setSiteConfig(
            {
              storageProvider: 'r2',
              objectStorageEndpoint: boundary.endpoint,
              objectStorageBucket: 'media',
              objectStorageRegion: 'auto',
            },
            identity.ownerId
          );
          await instance.seedStorageCredential('r2', boundary.endpoint, 'test-key', 'test-secret');
          const current = await sottoTransaction(instance.database, (tx) =>
            sottoStorageInstance(tx).read()
          );
          const owner = await instance.database.user.findUniqueOrThrow({
            where: { id: identity.ownerId },
          });
          const scopes = [
            { subjectId: current.subjectId, generation: current.generation },
            { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() },
          ];
          parent = await sottoTransaction(instance.database, (tx) =>
            sottoJobOutbox(tx).enqueue(
              prepareJob({
                namespace: SIDEDOOR_STATE_ID,
                handler: 'probe-test',
                version: 1,
                payload: { userId: owner.id },
                scopes,
                delivery: { attempts: 1, priority: 0, availableAt: 0 },
              })
            )
          );
          const admitted = parent;
          await expect(
            checkSottoJobStorage({
              database: instance.database,
              signal: controller.signal,
              operationId: admitted.job.id,
              fingerprint: admitted.fingerprint,
              handler: 'probe-test',
              version: 1,
              instanceId: current.instanceId,
              scopes,
              validatePending: async (tx) => {
                const value = await sottoJobOutbox(tx).read(admitted.job.id);
                return (
                  !!value &&
                  !value.complete &&
                  typeof value.job.payload === 'object' &&
                  value.job.payload !== null &&
                  'userId' in value.job.payload &&
                  value.job.payload.userId === owner.id
                );
              },
            })
          ).rejects.toThrow(
            mode === 'job-cancel'
              ? 'Caller cancelled while deletion was pending'
              : 'Storage probe parent is no longer pending'
          );
          expect(objects.size).toBe(0);
          expect((await jobs()).jobs).toEqual([
            expect.objectContaining({ phase: 'complete', pending: 0 }),
          ]);
          return;
        }
        const failed = await POST(request(true, controller.signal, 'r2'));
        if (mode !== 'timeout') {
          expect(failed.status).toBe(mode === 'logout' ? 401 : 499);
          expect(objects.size).toBe(0);
          expect((await jobs()).jobs).toEqual([
            expect.objectContaining({ phase: 'complete', pending: 0 }),
          ]);
          return;
        }
        expect(failed.status).toBe(422);
        expect(finishDelete).toBeTypeOf('function');
        expect(objects.size).toBe(1);
        expect((await jobs()).jobs).toEqual([
          expect.objectContaining({ phase: 'deleting', pending: 1 }),
        ]);
        const blocked = await POST(request(true, undefined, 'r2'));
        expect(blocked.status).toBe(422);
        expect(await blocked.json()).toMatchObject({
          detail: expect.stringContaining('unresolved cleanup execution'),
        });
        finishDelete!();
        expect(objects.size).toBe(0);
        const stillBlocked = await POST(request(true, undefined, 'r2'));
        expect(stillBlocked.status).toBe(422);
        expect(await stillBlocked.json()).toMatchObject({
          detail: expect.stringContaining('unresolved cleanup execution'),
        });
        expect((await jobs()).jobs).toEqual([
          expect.objectContaining({ phase: 'deleting', pending: 1 }),
        ]);
      } finally {
        finishDelete?.();
        for (const close of boundary.clients.splice(0)) close();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  );
});
