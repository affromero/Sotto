import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from './prisma';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export const serverInfraConfigSchema = z
  .object({
    aiProvider: z.string().nullable(),
    aiModel: z.string().nullable(),
    aiBaseUrl: z.string().nullable(),
    liveModel: z.string().nullable(),
    sttProvider: z.string().nullable(),
    sttBaseUrl: z.string().nullable(),
    sttModel: z.string().nullable(),
    ttsProvider: z.string().nullable(),
    ttsBaseUrl: z.string().nullable(),
    ttsVoices: z.string().nullable().default(null),
    storageProvider: z.string().nullable(),
    localStorageRoot: z.string().nullable(),
    objectStorageEndpoint: z.string().nullable(),
    objectStorageBucket: z.string().nullable(),
    objectStorageRegion: z.string().nullable(),
    objectStoragePublicUrl: z.string().nullable(),
  })
  .strict();

export type ServerInfraConfig = z.infer<typeof serverInfraConfigSchema>;
export type SiteConfigData = ServerInfraConfig;

export const EMPTY_INFRA: ServerInfraConfig = {
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

export const INFRA_KEYS = Object.keys(EMPTY_INFRA) as (keyof ServerInfraConfig)[];
type SharedDatabase = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

async function read(database: SharedDatabase): Promise<SiteConfigData> {
  const state = await sidedoorStateStore(database).read();
  if (state.configuration.site === null)
    throw new Error(
      'Initialize Sotto with `npm run access -- initialize` before starting the application'
    );
  return serverInfraConfigSchema.parse(state.configuration.site);
}

/** Read the single shared configuration source. Runtime never reads imported tables or env. */
export async function getSiteConfig(
  options: { database?: SharedDatabase; strict?: true } = {}
): Promise<SiteConfigData> {
  if (options.database) return read(options.database);
  return sottoTransaction(prismaUnfiltered, read);
}

function normalizeInfra(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function write(
  database: SharedDatabase,
  data: Partial<SiteConfigData>,
  _adminId: string
): Promise<void> {
  const store = sidedoorStateStore(database);
  await store.transact((state) => {
    if (state.configuration.site === null)
      throw new Error(
        'Initialize Sotto with `npm run access -- initialize` before changing configuration'
      );
    const current = serverInfraConfigSchema.parse(state.configuration.site);
    for (const key of INFRA_KEYS) {
      const normalized = normalizeInfra(data[key]);
      if (normalized !== undefined) current[key] = normalized;
    }
    state.configuration.site = current;
    state.revision++;
  });
}

export async function setSiteConfig(
  data: Partial<SiteConfigData>,
  adminId: string,
  transaction?: SharedDatabase
): Promise<void> {
  if (transaction) return write(transaction, data, adminId);
  await sottoTransaction(prismaUnfiltered, (database) => write(database, data, adminId));
}

export async function resetSiteConfig(adminId: string): Promise<void> {
  await setSiteConfig(EMPTY_INFRA, adminId);
}
