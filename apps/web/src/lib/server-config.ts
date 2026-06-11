import { getSiteConfig, type ServerInfraConfig } from './site-config';

/**
 * Owner-set server infrastructure, read DB-first then env, threaded into every
 * provider/resolver env-read site so the onboarding wizard can configure the
 * stack in-app without redeploying.
 *
 * Design: `getSiteConfig()` is async (a DB read), but several env-read sites are
 * synchronous (provider constructors, `getConfiguredSttProviderId`, storage type
 * resolution). To avoid rippling `async` through every signature, we keep a
 * module-level snapshot that `getServerInfra()` refreshes (TTL-cached), and a
 * synchronous `infra()` accessor that reads `snapshot[key] ?? env`. The snapshot
 * is warmed by any async caller and self-refreshes in the background when stale,
 * so sync sites converge to the DB value. Before the first warm-up the snapshot
 * is empty, so sync sites correctly fall back to env.
 *
 * NO secrets pass through here — only non-secret selection (provider ids, base
 * URLs, model names, bucket/region). Provider keys and R2/S3 credentials stay in
 * env or the encrypted BYOK store. The DB value is always treated as an EXPLICIT
 * selection: `config ?? env`, never an availability-based fallback. If neither
 * yields a value, the caller throws exactly as before.
 */

type InfraKey = keyof ServerInfraConfig;

const EMPTY: ServerInfraConfig = {
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

const TTL_MS = 30_000;

let snapshot: ServerInfraConfig = EMPTY;
let cachedAt = 0;
let refreshing: Promise<void> | null = null;

function isStale(): boolean {
  return Date.now() - cachedAt > TTL_MS;
}

async function refresh(): Promise<void> {
  const cfg = await getSiteConfig();
  snapshot = {
    aiProvider: cfg.aiProvider,
    aiModel: cfg.aiModel,
    aiBaseUrl: cfg.aiBaseUrl,
    sttProvider: cfg.sttProvider,
    sttBaseUrl: cfg.sttBaseUrl,
    sttModel: cfg.sttModel,
    ttsProvider: cfg.ttsProvider,
    ttsBaseUrl: cfg.ttsBaseUrl,
    storageProvider: cfg.storageProvider,
    s3Bucket: cfg.s3Bucket,
    s3Region: cfg.s3Region,
  };
  cachedAt = Date.now();
}

function startBackgroundRefresh(): void {
  if (refreshing) return;
  refreshing = refresh()
    .catch(() => {
      // getSiteConfig already swallows + logs DB errors and returns defaults;
      // keep the previous snapshot if anything else throws.
    })
    .finally(() => {
      refreshing = null;
    });
}

/**
 * Async: ensure the snapshot is fresh, then return it. Awaited by async sites
 * (e.g. `resolveLearningAi`, `LocalProvider.getClient`) that want a guaranteed
 * read-through before resolving.
 */
export async function getServerInfra(): Promise<ServerInfraConfig> {
  if (isStale()) {
    startBackgroundRefresh();
    if (refreshing) await refreshing;
  }
  return snapshot;
}

/**
 * Sync: DB snapshot (warmed by `getServerInfra`) then env. Returns `undefined`
 * when neither yields a non-empty value — the caller decides whether that is an
 * error, preserving the existing no-fallback behavior. Triggers a background
 * refresh when the snapshot is stale so sync sites converge to the DB value.
 */
export function infra(key: InfraKey, envName: string): string | undefined {
  if (isStale()) startBackgroundRefresh();
  const fromDb = snapshot[key];
  if (fromDb && fromDb.trim().length > 0) return fromDb;
  const fromEnv = process.env[envName];
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv : undefined;
}

/** Force the next read to hit the DB. Called after the owner writes infra config. */
export function invalidateServerInfra(): void {
  cachedAt = 0;
}
