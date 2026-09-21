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
import { GET } from '@/app/api/v1/onboarding/config/route';
import { resetAgentStatusCache } from '@/lib/agent-availability';
import { setSiteConfig } from '@/lib/site-config';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    queueMicrotask(() => child.emit('error', new Error('CLI is not installed in the test host')));
    return child;
  },
}));
const config = {
  aiProvider: 'local',
  aiModel: 'test-model',
  aiBaseUrl: 'http://localhost:11434',
  sttProvider: 'local',
  sttBaseUrl: 'http://localhost:8001/v1',
  sttModel: 'test-stt',
  ttsProvider: 'kokoro',
  ttsBaseUrl: 'http://localhost:8000',
  storageProvider: 'local',
  localStorageRoot: '.sotto/storage',
  objectStorageEndpoint: null,
  objectStorageBucket: null,
  objectStorageRegion: null,
  objectStoragePublicUrl: null,
};
function request(token?: string) {
  return new NextRequest('http://localhost:3000/api/v1/onboarding/config', {
    headers: token ? { cookie: `sotto_session=${token}` } : {},
  });
}
describe('Managed onboarding configuration', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('returns the static showcase without a database or account', async () => {
    vi.stubEnv('SELF_HOSTED', 'false');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      selfHosted: false,
      isOwner: false,
      infra: null,
    });
  });
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Onboarding configuration with shared authority', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('onboarding_config');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('SOTTO_CREDENTIAL_SYNC_DIR', '');
    vi.stubEnv('CLAUDE_CODE_SSH_HOST', '');
    vi.stubEnv('CODEX_SSH_HOST', '');
    for (const name of [
      'CARTESIA_API_KEY',
      'ANTHROPIC_API_KEY',
      'ASSEMBLYAI_API_KEY',
      'R2_ACCOUNT_ID',
    ])
      vi.stubEnv(name, '');
    resetAgentStatusCache();
    identity = await instance.reset();
    await setSiteConfig(config, identity.ownerId);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAgentStatusCache();
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  it('rejects anonymous and revoked sessions', async () => {
    expect((await GET(request())).status).toBe(401);
    await identity.access.logout(identity.ownerToken);
    expect((await GET(request(identity.ownerToken))).status).toBe(401);
  });
  it('hides server configuration from household learners and private members', async () => {
    const household = await identity.household('Learner');
    await identity.access.addMember(identity.ownerToken, 'Member', 'private member password');
    const member = await identity.access.login('Member', 'private member password');
    for (const token of [household.token, member]) {
      const response = await GET(request(token));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        selfHosted: true,
        isOwner: false,
        infra: null,
      });
    }
  });
  it('returns persisted non-secret owner configuration and actual CLI readiness', async () => {
    const response = await GET(request(identity.ownerToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      selfHosted: true,
      isOwner: true,
      infra: config,
      agentStatuses: {
        'claude-code': { readiness: 'not_installed', version: null },
        codex: { readiness: 'not_installed', version: null },
      },
    });
  });
});
