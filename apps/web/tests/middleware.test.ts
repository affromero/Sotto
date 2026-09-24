// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccessService,
  HouseholdProfileManagement,
  HouseholdProfileService,
} from 'thesidedoor-core/access';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { proxy } from '@/proxy';

const connection = vi.hoisted(() => ({ database: null as PrismaClient | null, failed: false }));
vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    $transaction: (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: 'Serializable' }
    ) => {
      if (connection.failed || !connection.database) throw new Error('Database unavailable');
      return connection.database.$transaction(callback, options);
    },
  },
}));

function request(path: string, token?: string, authorization?: string) {
  const headers = new Headers();
  if (token) headers.set('cookie', `sotto_session=${token}`);
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new NextRequest(new URL(path, 'http://localhost:3000'), { headers });
}
function destination(response: Response) {
  const location = response.headers.get('location');
  return location ? new URL(location).pathname : null;
}
afterEach(() => {
  vi.unstubAllEnvs();
  connection.failed = false;
});

describe('public proxy routes without a database', () => {
  beforeEach(() => {
    connection.failed = true;
    vi.stubEnv('SELF_HOSTED', 'true');
  });
  it.each([
    '/_next/static/main.js',
    '/_next/image?url=test',
    '/fonts/font.woff2',
    '/avatars/fox.png',
    '/favicon.ico',
    '/icon.svg',
    '/apple-icon.png',
    '/sitemap.xml',
    '/robots.txt',
    '/access',
    '/api/version',
    '/api/v1/health',
    '/api/v1/auth/pair/redeem',
    '/api/v1/access/login',
  ])('preserves the public boundary for %s', async (path) => {
    expect((await proxy(request(path))).headers.get('x-middleware-next')).toBe('1');
  });
  it.each([
    '/access/security',
    '/api/v1/storage/recordings/private.wav',
    '/api/v1/onboarding/config',
    '/avatars-private',
    '/api/v1/accessibility/private',
  ])('does not exempt the protected path %s', async (path) => {
    const response = await proxy(request(path, 'opaque-candidate'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('keeps the managed showcase available when shared state is unavailable', async () => {
    vi.stubEnv('SELF_HOSTED', 'false');
    expect(destination(await proxy(request('/dashboard')))).toBe('/welcome');
    expect((await proxy(request('/welcome'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(request('/'))).headers.get('x-middleware-next')).toBe('1');
    expect(
      (await proxy(request('/api/v1/onboarding/config'))).headers.get('x-middleware-next')
    ).toBe('1');
    const demoSave = new NextRequest('http://localhost:3000/api/v1/onboarding/save', {
      method: 'POST',
    });
    expect((await proxy(demoSave)).headers.get('x-middleware-next')).toBe('1');
    expect(
      (
        await proxy(
          new NextRequest('http://localhost:3000/api/v1/onboarding/config', { method: 'POST' })
        )
      ).status
    ).toBe(503);
    expect(
      (await proxy(request('/api/v1/onboarding/check-storage', 'opaque-candidate'))).status
    ).toBe(503);
  });
});

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('proxy admission with real shared PostgreSQL sessions', () => {
  let database: PrismaClient;
  let access: AccessService;
  let ownerToken: string;
  const schema = `proxy_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, options: `-c search_path=${schema}` },
        { schema }
      ),
    });
    connection.database = database;
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const baseline = await readFile(
      'prisma/migrations/20260720021500_baseline/migration.sql',
      'utf8'
    );
    for (const match of baseline.matchAll(/CREATE TYPE [\s\S]*?;/g))
      await database.$executeRawUnsafe(match[0]);
    const users = baseline.match(/CREATE TABLE "User" \([\s\S]*?\n\);/);
    if (!users) throw new Error('Missing baseline User table');
    await database.$executeRawUnsafe(users[0]);
    await database.$executeRawUnsafe(
      await readFile('prisma/migrations/20260911222000_sidedoor_state/migration.sql', 'utf8')
    );
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    connection.failed = false;
    await database.$executeRawUnsafe('DELETE FROM "SidedoorState"');
    await database.$executeRawUnsafe('DELETE FROM "User"');
    await sottoTransaction(database, (tx) =>
      sidedoorStateStore(tx).transact((state) => {
        state.access.householdProfiles = [];
      })
    );
    access = new AccessService({
      store: new SottoAccessStore(database),
    });
    ownerToken = await access.claimOwner(
      await access.issueOperatorToken(),
      'Owner',
      'owner password for proxy tests',
      'household'
    );
    const ownerId = (await access.store.read()).principals.find(
      (principal) => principal.role === 'owner'
    )?.id;
    if (!ownerId) throw new Error('Owner fixture requires an Admin profile');
    await new HouseholdProfileService(access).select(ownerToken, ownerId);
  });
  afterAll(async () => {
    connection.database = null;
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.$disconnect();
  });
  it('requires shared admission even when no environment password is configured', async () => {
    expect(destination(await proxy(request('/dashboard')))).toBe('/access');
    const response = await proxy(request('/api/v1/episodes'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await proxy(request('/dashboard', ownerToken))).headers.get('x-middleware-next')).toBe(
      '1'
    );
  });
  it('rejects revoked sessions', async () => {
    await access.logout(ownerToken);
    expect(destination(await proxy(request('/dashboard', ownerToken)))).toBe('/access');
  });
  it.each(['Bearer sk_sotto_forged', 'Basic invalid', ''])(
    'never substitutes a valid browser session for supplied authorization %j',
    async (authorization) => {
      expect((await proxy(request('/api/v1/episodes', ownerToken, authorization))).status).toBe(
        401
      );
    }
  );
  it('allows household admission to reach profile selection without granting selected content', async () => {
    const household = await access.enterHousehold('owner password for proxy tests');
    expect((await proxy(request('/profiles', household))).headers.get('x-middleware-next')).toBe(
      '1'
    );
    expect(
      (await proxy(request('/access/security', household))).headers.get('x-middleware-next')
    ).toBe('1');
    expect(
      (await proxy(request('/api/v1/profiles', household))).headers.get('x-middleware-next')
    ).toBe('1');
    expect(
      (await proxy(request('/api/v1/profiles/switch', household))).headers.get('x-middleware-next')
    ).toBe('1');
    expect(destination(await proxy(request('/dashboard', household)))).toBe('/profiles');
    const manager = new HouseholdProfileManagement(access, { allowHouseholdManagement: true });
    const prepared = manager.prepareCreate('Learner');
    const profileId = await access.store.transact((state) =>
      prepared.apply(state, { kind: 'session', token: ownerToken })
    );
    const { HouseholdProfileService } = await import('thesidedoor-core/access');
    await new HouseholdProfileService(access).select(household, profileId);
    expect((await proxy(request('/dashboard', household))).headers.get('x-middleware-next')).toBe(
      '1'
    );
  });
  it('keeps access management and stored media protected when shared configuration becomes unavailable', async () => {
    connection.failed = true;
    for (const path of ['/access/security', '/api/v1/storage/private.wav']) {
      const response = await proxy(request(path, ownerToken));
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });
});
