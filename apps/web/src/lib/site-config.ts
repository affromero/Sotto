import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Non-secret server infrastructure selection the owner sets in the onboarding
 * wizard. `null` on any field means "fall back to the matching env var". Secrets
 * (provider keys, R2/S3 credentials) are NEVER stored here — they live in env or
 * the encrypted BYOK store.
 */
export interface ServerInfraConfig {
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
}

export interface SiteConfigData extends ServerInfraConfig {
  openSignup: boolean;
  /** Local profile sign-in. null = default (on for self-hosted, no ADMIN_EMAILS). */
  localAuth: boolean | null;
}

const EMPTY_INFRA: ServerInfraConfig = {
  aiProvider: null,
  aiModel: null,
  aiBaseUrl: null,
  sttProvider: null,
  sttBaseUrl: null,
  sttModel: null,
  ttsProvider: null,
  ttsBaseUrl: null,
  storageProvider: null,
  s3Bucket: null,
  s3Region: null,
};

const DEFAULTS: SiteConfigData = {
  openSignup: false,
  localAuth: null,
  ...EMPTY_INFRA,
};

export const INFRA_KEYS: (keyof ServerInfraConfig)[] = [
  'aiProvider',
  'aiModel',
  'aiBaseUrl',
  'sttProvider',
  'sttBaseUrl',
  'sttModel',
  'ttsProvider',
  'ttsBaseUrl',
  'storageProvider',
  's3Bucket',
  's3Region',
];

export async function getSiteConfig(): Promise<SiteConfigData> {
  try {
    const row = await prisma.siteConfig.findUnique({
      where: { id: 'singleton' },
    });
    if (!row) return DEFAULTS;
    return {
      openSignup: row.openSignup,
      localAuth: row.localAuth,
      aiProvider: row.aiProvider,
      aiModel: row.aiModel,
      aiBaseUrl: row.aiBaseUrl,
      sttProvider: row.sttProvider,
      sttBaseUrl: row.sttBaseUrl,
      sttModel: row.sttModel,
      ttsProvider: row.ttsProvider,
      ttsBaseUrl: row.ttsBaseUrl,
      storageProvider: row.storageProvider,
      s3Bucket: row.s3Bucket,
      s3Region: row.s3Region,
    };
  } catch (err) {
    logger.warn('Failed to read site config', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULTS;
  }
}

/**
 * Normalize an infra field: trim, and treat empty string as "unset" (null) so the
 * resolver falls back to env rather than to a blank explicit selection.
 */
function normalizeInfra(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function setSiteConfig(
  data: Partial<SiteConfigData>,
  adminId: string
): Promise<void> {
  const infra: Record<string, string | null> = {};
  for (const key of INFRA_KEYS) {
    const normalized = normalizeInfra(data[key]);
    if (normalized !== undefined) infra[key] = normalized;
  }

  await prisma.siteConfig.upsert({
    where: { id: 'singleton' },
    update: {
      ...(data.openSignup !== undefined && { openSignup: data.openSignup }),
      ...(data.localAuth !== undefined && { localAuth: data.localAuth }),
      ...infra,
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      openSignup: data.openSignup ?? DEFAULTS.openSignup,
      ...(data.localAuth !== undefined && { localAuth: data.localAuth }),
      ...infra,
      updatedBy: adminId,
    },
  });
}

export async function isOpenSignup(): Promise<boolean> {
  const config = await getSiteConfig();
  return config.openSignup;
}
