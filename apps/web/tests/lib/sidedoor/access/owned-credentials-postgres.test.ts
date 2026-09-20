// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OwnedCredentials } from 'thesidedoor-core/configuration/owned-credentials';
import { CredentialSharing } from 'thesidedoor-core/configuration/credential-sharing';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('personal credentials with PostgreSQL JSONB', () => {
  let database: PrismaClient;
  const schema = `credential_test_${randomUUID().replaceAll('-', '')}`;
  const instanceId = randomUUID();
  const encryptionKey = randomBytes(32);
  const target = {
    owner: { subjectId: 'learner', generation: 1 },
    modality: 'ai',
    provider: 'test',
  };
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Credential tests require the isolated local sidedoor_test database');
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
  });
  afterAll(async () => {
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.$disconnect();
  });
  function store(tx: Prisma.TransactionClient) {
    return new OwnedCredentials(
      { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
      'postgres',
      {
        namespace: 'credential-test',
        instanceId,
        encryptionKey,
        descriptors: () => [
          {
            id: 'test',
            label: 'Test',
            transport: 'api',
            capabilities: ['text'],
            models: [],
            fields: [{ id: 'apiKey', label: 'Key', secret: true, required: true, kind: 'string' }],
          },
        ],
      }
    );
  }
  function transaction<T>(operation: (credentials: OwnedCredentials) => Promise<T>) {
    return sottoTransaction(database, async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      return operation(store(tx));
    });
  }
  it('preserves replacement replay and verification after JSONB serialization', async () => {
    const prepared = store(database).prepareReplacement(target, {
      expectedHeadRevision: null,
      credentialRevision: randomUUID(),
      values: { apiKey: 'personal-test-secret' },
      binding: { protocol: 'test', endpoint: 'https://example.com/v1' },
      availability: 'enabled',
      label: 'Personal',
      metadata: { createdAt: 1, updatedAt: 2, lastUsedAt: null },
    });
    await transaction((credentials) => credentials.replace(prepared));
    const ticket = await transaction((credentials) =>
      credentials.beginVerification(target, prepared.record.credentialRevision)
    );
    await transaction((credentials) =>
      credentials.finishVerification(ticket!, {
        status: 'valid',
        readiness: { code: 'ready', authentication: 'verified', checkedAt: 100 },
      })
    );
    expect(await transaction((credentials) => credentials.replace(prepared))).toBe('replayed');
    const resolved = await transaction((credentials) => credentials.resolve(target));
    expect(resolved?.values.apiKey).toBe('personal-test-secret');
    expect(resolved?.verification.lastConfirmed?.status).toBe('verified');
    await transaction((credentials) =>
      credentials.recordUse(target, prepared.record.credentialRevision, 101)
    );
    expect(await transaction((credentials) => credentials.replace(prepared))).toBe('replayed');
    expect(
      (await transaction((credentials) => credentials.head(target))).credential?.metadata.lastUsedAt
    ).toBe(101);
    expect((await transaction((credentials) => credentials.list())).items).toHaveLength(1);
    const removal = randomUUID();
    await transaction((credentials) =>
      credentials.remove(target, prepared.record.credentialRevision, removal)
    );
    expect(
      await transaction((credentials) =>
        credentials.remove(target, prepared.record.credentialRevision, removal)
      )
    ).toBe('replayed');
    expect(await transaction((credentials) => credentials.resolve(target))).toBeNull();
  });

  it('persists revocation across JSONB reads without allowing a stale grant to return', async () => {
    const slot = { modality: 'tts', provider: 'test' };
    const policy = {
      owner: target.owner,
      audience: 'household' as const,
      excludedRecipients: [],
      source: 'explicit' as const,
    };
    function sharing<T>(operation: (grants: CredentialSharing) => Promise<T>) {
      return sottoTransaction(database, async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        return operation(
          new CredentialSharing(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            'credential-test',
            instanceId
          )
        );
      });
    }
    await sharing((grants) => grants.set(slot, null, policy));
    expect((await sharing((grants) => grants.head(slot))).policy).toEqual(policy);
    await sharing((grants) => grants.remove(slot, 0));
    await expect(sharing((grants) => grants.set(slot, null, policy))).rejects.toThrow(/changed/);
    expect(await sharing((grants) => grants.head(slot))).toEqual({ revision: 1, policy: null });
    expect((await sharing((grants) => grants.list())).items).toEqual([]);
  });
});
