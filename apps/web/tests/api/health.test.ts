// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { GET } from '@/app/api/v1/health/route';
import { resetAgentStatusCache } from '@/lib/agent-availability';
import { createSottoKey } from '@/lib/sidedoor/access/core/pairing';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { closeRedis } from '@/lib/redis';
const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  databaseFailure: false,
  redisFailure: false,
  failedJobs: 0,
  storageFailure: false,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(boundary), {
    get(...parameters) {
      if (parameters[1] === '$queryRaw' && boundary.databaseFailure)
        return async () => {
          throw new Error('Private database connection failure');
        };
      return Reflect.get(...parameters);
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('ioredis', () => ({
  default: class HealthRedis extends EventEmitter {
    async ping() {
      if (boundary.redisFailure) throw new Error('Private Redis connection failure');
      return 'PONG';
    }
    async llen() {
      return 0;
    }
    async zcard() {
      return boundary.failedJobs;
    }
    async quit() {
      return 'OK';
    }
  },
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class HealthStorage {
    async send() {
      if (boundary.storageFailure) throw new Error('Private storage credential failure');
      return {};
    }
    destroy() {}
  },
}));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    queueMicrotask(() => child.emit('error', new Error('CLI unavailable in test host')));
    return child;
  },
}));
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Health with shared authority and infrastructure boundaries', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('health_routes');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    boundary.databaseFailure = false;
    boundary.redisFailure = false;
    boundary.storageFailure = false;
    boundary.failedJobs = 0;
    for (const name of [
      'SOTTO_CREDENTIAL_SYNC_DIR',
      'CLAUDE_CODE_SSH_HOST',
      'CODEX_SSH_HOST',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'ELEVENLABS_API_KEY',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
    ])
      vi.stubEnv(name, '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    resetAgentStatusCache();
    identity = await instance.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetAgentStatusCache();
  });
  afterAll(async () => {
    await closeRedis();
    boundary.database = null;
    if (instance) await instance.close();
  });
  function request(token?: string, bearer?: string) {
    return new NextRequest('http://localhost:3000/api/v1/health', {
      headers: {
        ...(token ? { cookie: `sotto_session=${token}` } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
    });
  }
  function publicPayload(body: Record<string, unknown>) {
    expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'version']);
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body.version).toEqual(expect.any(String));
  }
  it('returns the minimal public liveness response', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    publicPayload(body);
    expect(body.status).toBe('healthy');
  });
  it('does not send provider requests for public probes', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'private-test-provider-key');
    const outgoing = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', outgoing);
    publicPayload(await (await GET(request())).json());
    expect(outgoing).not.toHaveBeenCalled();
  });
  it('keeps details private from household learners, members, revoked and invalid credentials', async () => {
    const household = await identity.household('Learner');
    await identity.access.addMember(identity.ownerToken, 'Member', 'private member password');
    const member = await identity.access.login('Member', 'private member password');
    for (const current of [
      request(household.token),
      request(member),
      request(identity.ownerToken, 'forged'),
    ])
      publicPayload(await (await GET(current)).json());
    await identity.access.logout(identity.ownerToken);
    publicPayload(await (await GET(request(identity.ownerToken))).json());
  });
  it('returns detailed infrastructure status to owner browsers and delegated owner devices', async () => {
    const key = await sottoTransaction(instance.database, (database) =>
      createSottoKey(database, identity.ownerToken, 'Owner device')
    );
    for (const current of [request(identity.ownerToken), request(undefined, key.key)]) {
      const response = await GET(current);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = await response.json();
      expect(body.checks).toMatchObject({
        database: { status: 'ok' },
        redis: { status: 'ok' },
        storage: { status: 'ok', detail: 'local' },
        queues: { status: 'ok' },
      });
      expect(body.vapid).toBe(false);
      expect(Object.keys(body.env).sort()).toEqual(['DATABASE_URL', 'REDIS_URL']);
    }
  });
  it.each(['database', 'redis'] as const)(
    'reports %s failure without leaking connection details',
    async (failure) => {
      boundary.databaseFailure = failure === 'database';
      boundary.redisFailure = failure === 'redis';
      const owner = await GET(request(identity.ownerToken));
      expect(owner.status).toBe(503);
      const detailed = await owner.json();
      expect(detailed.checks[failure].status).toBe('error');
      expect(JSON.stringify(detailed)).not.toContain('Private');
      const anonymous = await GET(request());
      expect(anonymous.status).toBe(503);
      publicPayload(await anonymous.json());
    }
  );
  it('reports storage reachability and failures without exposing credentials', async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'health-test-encryption-key');
    await instance.configureInfrastructure({
      storageProvider: 'r2',
      objectStorageEndpoint: 'https://test.r2.cloudflarestorage.com',
      objectStorageBucket: 'private',
      objectStorageRegion: 'auto',
    });
    await instance.seedStorageCredential(
      'r2',
      'https://test.r2.cloudflarestorage.com',
      'private-storage-key',
      'private-storage-secret'
    );
    expect((await (await GET(request(identity.ownerToken))).json()).checks.storage.status).toBe(
      'ok'
    );
    boundary.storageFailure = true;
    const body = await (await GET(request(identity.ownerToken))).json();
    expect(body.checks.storage.status).toBe('error');
    expect(JSON.stringify(body)).not.toContain('private-storage-secret');
  });
  it('reports excessive failed jobs to the owner', async () => {
    boundary.failedJobs = 51;
    const body = await (await GET(request(identity.ownerToken))).json();
    expect(body.checks.queues.status).toBe('degraded');
  });
});
