import { createDecipheriv, randomUUID, scryptSync } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ProviderDescriptor } from 'thesidedoor-core/ai/browser';
import { OwnedCredentials } from 'thesidedoor-core/configuration/owned-credentials';
import { CredentialSharing } from 'thesidedoor-core/configuration/credential-sharing';
import {
  providerCredentials,
  providerIdentity,
  type ProviderModality,
} from 'thesidedoor-core/providers/catalog';
import {
  providerServiceProtocol,
  serviceCredentialOrigin,
} from 'thesidedoor-core/providers/service-validation';
import type { Prisma } from '@/generated/prisma/client';
import { defaultAutoModelConfig } from '@/lib/auto-model-config';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';
import { captureApiEndpoint } from '@/lib/providers/shared/api-selection';
import { CARTESIA_TTS_API_VERSION } from '@/lib/providers/shared/speech-contracts';
import { EMPTY_INFRA, serverInfraConfigSchema } from '@/lib/site-config';
import {
  SIDEDOOR_STATE_ID,
  sidedoorStateStore,
  sottoStorageInstance,
} from '@/lib/sidedoor/access/state/store';
import {
  INSTALLED_PROFILE_INITIALIZATION,
  sharedConfigurationValueSchema,
} from '@/lib/sidedoor/access/state/state';

const SOURCE_TABLES = [
  'UserVisualCueKey',
  'UserAiKey',
  'UserTtsKey',
  'AutoModelConfig',
  'SiteConfig',
] as const;

type SourceCredential = {
  userId: string;
  provider: string;
  encryptedKey: string;
  extraData?: string | null;
  isValid: boolean;
  label: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SourceSite = {
  aiProvider: string | null;
  aiModel: string | null;
  aiBaseUrl: string | null;
  sttProvider: string | null;
  sttBaseUrl: string | null;
  sttModel: string | null;
  ttsProvider: string | null;
  ttsBaseUrl: string | null;
  storageProvider: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
};

type SourceModels = {
  aiProvider: string;
  aiModel: string;
  ttsProvider: string;
  ttsModel: string;
  sttProvider: string;
  sttModel: string;
  platformAiProvider: string;
  platformAiModel: string;
  includedModels: unknown;
  includedTtsModels: unknown;
  includedSttModels: unknown;
};

function encryptionKey(salt: Buffer): Buffer {
  const secret = process.env.BYOK_ENCRYPTION_KEY;
  if (!secret) throw new Error('BYOK_ENCRYPTION_KEY is required to convert stored credentials');
  return scryptSync(secret, salt, 32);
}

function decryptSourceValue(encoded: string): string {
  const payload = Buffer.from(encoded, 'base64');
  if (payload.length < 49) throw new Error('Stored credential envelope is invalid');
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 32);
  const tag = payload.subarray(32, 48);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(48)), decipher.final()]).toString('utf8');
}

async function tableExists(database: Prisma.TransactionClient, table: string): Promise<boolean> {
  const rows = await database.$queryRawUnsafe<{ name: string | null }[]>(
    'SELECT to_regclass($1)::text AS name',
    `public."${table}"`
  );
  return rows[0]?.name !== null;
}

async function sourceRows<T>(
  database: Prisma.TransactionClient,
  table: (typeof SOURCE_TABLES)[number]
): Promise<T[]> {
  if (!(await tableExists(database, table))) return [];
  return database.$queryRawUnsafe<T[]>(`SELECT * FROM "${table}"`);
}

function sourceSite(row: SourceSite | undefined) {
  return serverInfraConfigSchema.parse({
    ...EMPTY_INFRA,
    ...(row
      ? {
          aiProvider: row.aiProvider,
          aiModel: row.aiModel,
          aiBaseUrl: row.aiBaseUrl,
          sttProvider: row.sttProvider,
          sttBaseUrl: row.sttBaseUrl,
          sttModel: row.sttModel,
          ttsProvider: row.ttsProvider,
          ttsBaseUrl: row.ttsBaseUrl,
          storageProvider: row.storageProvider,
          objectStorageBucket: row.s3Bucket,
          objectStorageRegion: row.s3Region,
        }
      : {}),
  });
}

function stringList(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string'))
    throw new Error('Stored model selection is invalid');
  return value;
}

function sourceModels(row: SourceModels | undefined) {
  if (!row) return defaultAutoModelConfig();
  return {
    model: {
      aiProvider: row.aiProvider,
      aiModel: row.aiModel,
      ttsProvider: row.ttsProvider,
      ttsModel: row.ttsModel,
      sttProvider: row.sttProvider,
      sttModel: row.sttModel,
    },
    platform: {
      aiProvider: row.platformAiProvider,
      aiModel: row.platformAiModel,
    },
    includedModels: stringList(row.includedModels),
    includedTtsModels: stringList(row.includedTtsModels),
    includedSttModels: stringList(row.includedSttModels),
  };
}

type ConvertedScope = 'ai' | 'tts' | 'music' | 'visual';

function credentialModality(scope: ConvertedScope, provider: string): ProviderModality {
  if (scope === 'ai')
    return providerIdentity(provider).modalities.includes('text') ? 'text' : 'transcription';
  if (scope === 'tts') return 'speech';
  return scope;
}

function credentialDescriptor(scope: ConvertedScope, provider: string): ProviderDescriptor {
  const modality = credentialModality(scope, provider);
  const metadata = providerCredentials(provider, modality);
  return {
    id: provider,
    label: providerIdentity(provider).label,
    transport: 'api',
    models: [],
    capabilities: ['text', 'speech', 'transcription'].includes(modality) ? [modality] : [],
    fields: [...metadata.fields, ...metadata.configurationFields],
  } as ProviderDescriptor;
}

function credentialBinding(scope: ConvertedScope, provider: string) {
  const modality = credentialModality(scope, provider);
  const protocol = providerServiceProtocol(provider, modality);
  if (protocol && !(scope === 'ai' && modality === 'text')) {
    return {
      protocol: protocol === 'cartesia' ? `${protocol}:${CARTESIA_TTS_API_VERSION}` : protocol,
      endpoint: serviceCredentialOrigin(protocol),
    };
  }
  return {
    protocol:
      provider === 'anthropic' ? 'anthropic' : provider === 'openai' ? 'responses' : 'compatible',
    endpoint: captureApiEndpoint(provider),
  };
}

function credentialValues(row: SourceCredential, scope: ConvertedScope) {
  const descriptor = credentialDescriptor(scope, row.provider);
  const supplied: Record<string, string> = { apiKey: decryptSourceValue(row.encryptedKey) };
  if (row.extraData) {
    const parsed: unknown = JSON.parse(decryptSourceValue(row.extraData));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error(`Stored ${row.provider} credential settings are invalid`);
    for (const [field, value] of Object.entries(parsed)) {
      if (typeof value !== 'string')
        throw new Error(`Stored ${row.provider} credential setting ${field} is invalid`);
      supplied[field] = value;
    }
  }
  const allowed = new Set(descriptor.fields.map((field) => field.id));
  return Object.fromEntries(Object.entries(supplied).filter(([field]) => allowed.has(field)));
}

async function convertCredential(
  database: Prisma.TransactionClient,
  row: SourceCredential,
  scope: ConvertedScope,
  sharedOwnerId: string | null
): Promise<boolean> {
  const user = await database.user.findUnique({
    where: { id: row.userId },
    select: { id: true, createdAt: true },
  });
  if (!user) throw new Error(`Stored ${row.provider} credential owner is missing`);
  const values = credentialValues(row, scope);
  const descriptor = credentialDescriptor(scope, row.provider);
  const instance = await sottoStorageInstance(database).read();
  const executor = {
    query: (sql: string, parameters: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...parameters),
  };
  const storage = {
    slot: { modality: scope, provider: row.provider },
    owned: new OwnedCredentials(executor, 'postgres', {
      namespace: SIDEDOOR_STATE_ID,
      instanceId: instance.instanceId,
      encryptionKey: deriveOwnedCredentialKey,
      descriptors: () => [descriptor],
    }),
    sharing: new CredentialSharing(executor, 'postgres', SIDEDOOR_STATE_ID, instance.instanceId),
  };
  const owner = { subjectId: `profile:${user.id}`, generation: user.createdAt.getTime() };
  const target = { ...storage.slot, owner };
  const head = await storage.owned.head(target);
  let converted = false;
  if (head.credential) {
    const current = await storage.owned.readForEdit(target, head.revision!);
    if (!isDeepStrictEqual(current.values, values))
      throw new Error(`Canonical ${row.provider} credentials conflict with installed values`);
  } else {
    await storage.owned.replace(
      storage.owned.prepareReplacement(target, {
        expectedHeadRevision: head.revision,
        credentialRevision: randomUUID(),
        values,
        binding: credentialBinding(scope, row.provider),
        availability: row.isValid ? 'enabled' : 'disabled',
        label: row.label ?? descriptor.label,
        metadata: {
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
          lastUsedAt: row.lastUsedAt?.getTime() ?? null,
        },
      })
    );
    converted = true;
  }
  if (sharedOwnerId === user.id) {
    const sharing = await storage.sharing.head(storage.slot);
    if (sharing.policy && sharing.policy.owner.subjectId !== owner.subjectId)
      throw new Error(`Canonical ${row.provider} sharing already has another owner`);
    if (!sharing.policy)
      await storage.sharing.set(storage.slot, sharing.revision, {
        owner,
        audience: 'household',
        excludedRecipients: [],
        source: 'imported',
      });
  }
  return converted;
}

/** Atomically convert installed configuration while the active release keeps its source tables. */
export async function prepareInstalledPlatform(
  database: Prisma.TransactionClient,
  instanceId: string
): Promise<{ credentials: number; profiles: number }> {
  await sottoStorageInstance(database).initialize(instanceId);
  const users = await database.user.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  const site = (await sourceRows<SourceSite>(database, 'SiteConfig'))[0];
  const models = (await sourceRows<SourceModels>(database, 'AutoModelConfig'))[0];
  const store = sidedoorStateStore(database);
  await store.transact((state) => {
    let changed = false;
    if (state.configuration.site === null) {
      state.configuration.site = sharedConfigurationValueSchema.parse(sourceSite(site));
      changed = true;
    }
    if (state.configuration.automaticModels === null) {
      state.configuration.automaticModels = sharedConfigurationValueSchema.parse(
        sourceModels(models)
      );
      changed = true;
    }
    if (
      !state.access.principals.length &&
      !state.access.householdProfiles?.length &&
      users.length
    ) {
      state.access.householdProfiles = users.map((user) => ({
        id: user.id,
        name: user.name?.trim() || user.email,
        epoch: user.createdAt.getTime(),
      }));
      state.access.householdPasswordHash = null;
      state.access.householdEpoch++;
      if (!state.access.initializations.includes(INSTALLED_PROFILE_INITIALIZATION))
        state.access.initializations.push(INSTALLED_PROFILE_INITIALIZATION);
      changed = true;
    }
    if (changed) state.revision++;
  });

  const sharedOwnerId = users.find((user) => user.role === 'ADMIN')?.id ?? null;
  const groups: Array<{
    table: 'UserAiKey' | 'UserTtsKey' | 'UserVisualCueKey';
    scope: 'ai' | 'tts' | 'visual';
  }> = [
    { table: 'UserAiKey', scope: 'ai' },
    { table: 'UserTtsKey', scope: 'tts' },
    { table: 'UserVisualCueKey', scope: 'visual' },
  ];
  let credentials = 0;
  for (const group of groups) {
    for (const row of await sourceRows<SourceCredential>(database, group.table)) {
      if (
        await convertCredential(
          database,
          row,
          group.table === 'UserTtsKey' && row.provider === 'suno' ? 'music' : group.scope,
          sharedOwnerId
        )
      )
        credentials++;
    }
  }
  return { credentials, profiles: users.length };
}

/** Remove source tables only after the candidate has passed health checks. */
export async function finalizeInstalledPlatform(
  database: Prisma.TransactionClient
): Promise<{ removed: number }> {
  await sottoStorageInstance(database).read();
  const state = await sidedoorStateStore(database).read();
  if (state.configuration.site === null || state.configuration.automaticModels === null)
    throw new Error('Canonical platform configuration is incomplete');

  const groups: Array<{
    table: 'UserAiKey' | 'UserTtsKey' | 'UserVisualCueKey';
    scope: 'ai' | 'tts' | 'visual';
  }> = [
    { table: 'UserAiKey', scope: 'ai' },
    { table: 'UserTtsKey', scope: 'tts' },
    { table: 'UserVisualCueKey', scope: 'visual' },
  ];
  for (const group of groups) {
    for (const row of await sourceRows<SourceCredential>(database, group.table)) {
      const user = await database.user.findUnique({
        where: { id: row.userId },
        select: { id: true, createdAt: true },
      });
      if (!user) throw new Error(`Stored ${row.provider} credential owner is missing`);
      const scope = group.table === 'UserTtsKey' && row.provider === 'suno' ? 'music' : group.scope;
      const descriptor = credentialDescriptor(scope, row.provider);
      const instance = await sottoStorageInstance(database).read();
      const executor = {
        query: (sql: string, parameters: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...parameters),
      };
      const owned = new OwnedCredentials(executor, 'postgres', {
        namespace: SIDEDOOR_STATE_ID,
        instanceId: instance.instanceId,
        encryptionKey: deriveOwnedCredentialKey,
        descriptors: () => [descriptor],
      });
      const head = await owned.head({
        modality: scope,
        provider: row.provider,
        owner: { subjectId: `profile:${user.id}`, generation: user.createdAt.getTime() },
      });
      if (!head.credential)
        throw new Error(`Canonical ${row.provider} credentials were not verified`);
    }
  }

  let removed = 0;
  for (const table of SOURCE_TABLES) {
    if (!(await tableExists(database, table))) continue;
    await database.$executeRawUnsafe(`DROP TABLE "${table}"`);
    removed++;
  }
  return { removed };
}
