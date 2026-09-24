import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccessService,
  HouseholdProfileManagement,
  HouseholdProfileService,
} from 'thesidedoor-core/access';
import { PrismaClient } from '@/generated/prisma/client';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import {
  captureSottoCredentialOwner,
  setSottoInstanceStorageCredential,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { captureSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { sharedConfigurationValueSchema } from '@/lib/sidedoor/access/state/state';
import type { ServerInfraConfig } from '@/lib/site-config';

const initialInfrastructure: ServerInfraConfig = {
  aiProvider: null,
  aiModel: null,
  aiBaseUrl: null,
  liveModel: null,
  sttProvider: null,
  sttBaseUrl: null,
  sttModel: null,
  ttsProvider: null,
  ttsBaseUrl: null,
  ttsVoices: null,
  storageProvider: null,
  localStorageRoot: null,
  objectStorageEndpoint: null,
  objectStorageBucket: null,
  objectStorageRegion: null,
  objectStoragePublicUrl: null,
};
const initialModels = {
  model: {
    aiProvider: 'anthropic',
    aiModel: 'claude-sonnet-4-6',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  },
  platform: { aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001' },
  includedModels: null,
  includedTtsModels: null,
  includedSttModels: null,
};

/** Tests use their own initialized schema, never application or production tables. */
export async function createSharedTestInstance(label: string) {
  const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
  if (!databaseUrl || !/^[a-z_]{1,24}$/.test(label))
    throw new Error('Use a named isolated test instance');
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
    throw new Error('Use the isolated local sidedoor_test database');
  const schema = `${label}_${randomUUID().replaceAll('-', '')}`;
  const connection = new Client({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
  });
  await connection.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(7429012)');
    await connection.query('CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA public');
    await connection.query('COMMIT');
    await connection.query(`CREATE SCHEMA "${schema}"`);
    const directory = 'prisma/migrations';
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      await connection.query(await readFile(join(directory, entry.name, 'migration.sql'), 'utf8'));
    }
  } catch (error) {
    await connection.query('ROLLBACK');
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    throw error;
  } finally {
    await connection.end();
  }
  const database = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},public` },
      { schema }
    ),
  });
  const storageRoot = await mkdtemp(join(tmpdir(), `sotto-${label}-`));
  async function reset() {
    await database.$executeRawUnsafe(`TRUNCATE "${schema}"."User" CASCADE`);
    await database.$executeRawUnsafe(`TRUNCATE "${schema}"."SidedoorState"`);
    const instanceId = randomUUID();
    await sottoTransaction(database, async (tx) => {
      await sottoStorageInstance(tx).initialize(instanceId);
      await sidedoorStateStore(tx).transact((state) => {
        state.access.householdProfiles = [];
        state.configuration.site = sharedConfigurationValueSchema.parse({
          ...initialInfrastructure,
          storageProvider: 'local',
          localStorageRoot: storageRoot,
        });
        state.configuration.automaticModels = sharedConfigurationValueSchema.parse(initialModels);
        state.revision++;
      });
    });
    const access = new AccessService({
      store: new SottoAccessStore(database),
    });
    const ownerToken = await access.claimOwner(
      await access.issueOperatorToken(),
      'Owner',
      'owner password for integration tests',
      'household'
    );
    const ownerId = (await access.store.read()).principals.find(
      (principal) => principal.role === 'owner'
    )?.id;
    if (!ownerId) throw new Error('Owner fixture requires an Admin profile');
    await new HouseholdProfileService(access).select(ownerToken, ownerId);
    async function household(name: string) {
      const management = new HouseholdProfileManagement(access, { allowHouseholdManagement: true });
      const prepared = management.prepareCreate(name);
      const id = await access.store.transact((state) =>
        prepared.apply(state, { kind: 'session', token: ownerToken })
      );
      const token = await access.enterHousehold('owner password for integration tests');
      await new HouseholdProfileService(access).select(token, id);
      return { id, token };
    }
    return { access, ownerToken, ownerId, household };
  }
  async function close() {
    try {
      await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await Promise.all([
        database.$disconnect(),
        rm(storageRoot, { recursive: true, force: true }),
      ]);
    }
  }
  async function seedProfileCredential(
    userId: string,
    scope: 'ai' | 'tts' | 'music',
    provider: string,
    values: Record<string, string>
  ) {
    await sottoTransaction(database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, scope, provider);
      const owner = await captureSottoCredentialOwner(tx, userId);
      const probe = captureSottoCredentialProbe(scope, provider, values);
      if (probe.kind === 'unsupported') throw new Error('Fixture requires a supported provider');
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: null,
            credentialRevision: randomUUID(),
            values,
            binding: probe.binding,
            availability: 'enabled',
            label: provider,
            metadata: { createdAt: Date.now(), updatedAt: Date.now(), lastUsedAt: null },
          }
        )
      );
    });
  }
  async function seedAiCredential(userId: string, provider: string, apiKey: string) {
    await seedProfileCredential(userId, 'ai', provider, { apiKey });
  }
  async function seedStorageCredential(
    provider: 'r2' | 's3',
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string
  ) {
    await sottoTransaction(database, (tx) =>
      setSottoInstanceStorageCredential(tx, provider, { accessKeyId, secretAccessKey }, endpoint)
    );
  }
  async function configureInfrastructure(overrides: Partial<typeof initialInfrastructure>) {
    await sottoTransaction(database, (tx) =>
      sidedoorStateStore(tx).transact((state) => {
        state.configuration.site = sharedConfigurationValueSchema.parse({
          ...initialInfrastructure,
          ...overrides,
        });
        state.revision++;
      })
    );
  }
  return {
    database,
    schema,
    reset,
    close,
    seedAiCredential,
    seedProfileCredential,
    seedStorageCredential,
    configureInfrastructure,
  };
}

/** Prisma is the system boundary. The stable proxy lets module singletons use each test's isolated client. */
export function prismaTestBoundary(binding: { database: PrismaClient | null }) {
  return new Proxy(
    {},
    {
      get(...parameters) {
        const property = parameters[1];
        if (!binding.database) throw new Error('Test database is not initialized');
        const value = binding.database[property as keyof PrismaClient];
        return typeof value === 'function' ? value.bind(binding.database) : value;
      },
    }
  );
}

export type SharedTestInstance = Awaited<ReturnType<typeof createSharedTestInstance>>;
export type SharedTestIdentity = Awaited<ReturnType<SharedTestInstance['reset']>>;
