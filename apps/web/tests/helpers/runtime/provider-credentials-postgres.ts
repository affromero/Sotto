import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { AccessService, HouseholdProfileService } from 'thesidedoor-core/access';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;

/** Real disposable PostgreSQL schema with canonical access and credential ownership. */
export function useProviderCredentialDatabase() {
  let database: PrismaClient;
  const schema = `provider_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Requires isolated local sidedoor_test database');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'provider-storage-test-secret');
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, options: `-c search_path=${schema}` },
        { schema }
      ),
    });
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await database.$executeRawUnsafe(
      `CREATE TABLE "${schema}"."SidedoorState" (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state JSONB NOT NULL)`
    );
    const baseline = await readFile(
      'prisma/migrations/20260720021500_baseline/migration.sql',
      'utf8'
    );
    await transaction(async (tx) => {
      for (const match of baseline.matchAll(/CREATE TYPE [\s\S]*?;/g))
        await tx.$executeRawUnsafe(match[0]);
      const statement = baseline.match(/CREATE TABLE "User" \([\s\S]*?\n\);/);
      if (!statement) throw new Error('Missing baseline User table');
      await tx.$executeRawUnsafe(statement[0]);
    });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.$disconnect();
  });
  afterEach(() => vi.unstubAllGlobals());
  function transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    timeoutMs?: number
  ) {
    return sottoTransaction(
      database,
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        return operation(tx);
      },
      { timeoutMs }
    );
  }
  beforeEach(async () => {
    await transaction(async (tx) => {
      await tx.$executeRawUnsafe('DELETE FROM "SidedoorState"');
      await tx.$executeRawUnsafe('DELETE FROM "User"');
      for (const id of ['alice', 'bob'])
        await tx.$executeRawUnsafe(
          'INSERT INTO "User" (id, email, "createdAt", "updatedAt") VALUES ($1, $1, $2, $2)',
          id,
          new Date(1000)
        );
      await sottoStorageInstance(tx).initialize(randomUUID());
      await sidedoorStateStore(tx).transact((state) => {
        state.access.principals = ['alice', 'bob'].map((id) => ({
          id,
          name: id,
          role: 'member',
          passwordHash: null,
          epoch: 0,
          createdAt: 1000,
        }));
        state.access.householdProfiles = ['alice', 'bob'].map((id) => ({ id, name: id, epoch: 0 }));
      });
      const access = new AccessService({ store: await sottoAccessStore(tx) });
      await access.claimOwner(
        await access.issueOperatorToken(),
        'Owner',
        'owner fixture password phrase',
        'household'
      );
    });
  });
  async function admission(tx: Prisma.TransactionClient, userId = 'alice') {
    const access = new AccessService({
      store: await sottoAccessStore(tx),
      allowOpenHousehold: true,
    });
    const token = await access.enterHousehold('owner fixture password phrase');
    await new HouseholdProfileService(access).select(token, userId);
    const request = new Request('http://localhost/api/v1/settings/ai-keys', {
      headers: { cookie: `sotto_session=${token}` },
    });
    const identity = await resolveSottoRequest(tx, request);
    if (!identity || identity.kind !== 'content') throw new Error('Fixture admission failed');
    return { request, identity };
  }
  return {
    get database() {
      return database;
    },
    transaction,
    admission,
  };
}
