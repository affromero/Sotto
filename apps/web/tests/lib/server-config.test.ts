/**
 * server-config: owner-set infra read DB-first then env, threaded into the
 * provider resolvers. The DB value is an EXPLICIT selection (config ?? env) —
 * never an availability-based fallback. When neither is set, `infra()` returns
 * undefined and the caller throws exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SiteConfigData } from '@/lib/site-config';

const mockGetSiteConfig = vi.fn();
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...a: unknown[]) => mockGetSiteConfig(...a),
}));

import {
  getServerInfra,
  infra,
  invalidateServerInfra,
} from '@/lib/server-config';

const EMPTY: SiteConfigData = {
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

function config(over: Partial<SiteConfigData>): SiteConfigData {
  return { ...EMPTY, ...over };
}

const ENV_KEYS = ['AI_PROVIDER', 'AI_MODEL', 'STT_PROVIDER', 'TTS_PROVIDER', 'TTS_BASE_URL'];
const savedEnv: Record<string, string | undefined> = {};

describe('server-config infra accessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    mockGetSiteConfig.mockResolvedValue(EMPTY);
    invalidateServerInfra();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('returns the DB config value over the env var (config wins)', async () => {
    process.env.STT_PROVIDER = 'openai';
    mockGetSiteConfig.mockResolvedValue(config({ sttProvider: 'local' }));

    await getServerInfra(); // warm the snapshot

    expect(infra('sttProvider', 'STT_PROVIDER')).toBe('local');
  });

  it('falls back to the env var when the DB config field is null', async () => {
    process.env.STT_PROVIDER = 'deepgram';
    mockGetSiteConfig.mockResolvedValue(config({ sttProvider: null }));

    await getServerInfra();

    expect(infra('sttProvider', 'STT_PROVIDER')).toBe('deepgram');
  });

  it('returns undefined when neither DB config nor env is set (no fallback)', async () => {
    mockGetSiteConfig.mockResolvedValue(EMPTY);

    await getServerInfra();

    expect(infra('aiProvider', 'AI_PROVIDER')).toBeUndefined();
  });

  it('treats a blank DB value as unset and falls back to env', async () => {
    process.env.AI_MODEL = 'qwen3';
    mockGetSiteConfig.mockResolvedValue(config({ aiModel: '   ' }));

    await getServerInfra();

    expect(infra('aiModel', 'AI_MODEL')).toBe('qwen3');
  });

  it('getServerInfra returns the full DB snapshot', async () => {
    mockGetSiteConfig.mockResolvedValue(
      config({ aiProvider: 'local', aiBaseUrl: 'http://localhost:11434/v1' }),
    );

    const snap = await getServerInfra();

    expect(snap.aiProvider).toBe('local');
    expect(snap.aiBaseUrl).toBe('http://localhost:11434/v1');
    expect(snap.ttsProvider).toBeNull();
  });

  it('invalidate forces a re-read of changed DB config', async () => {
    mockGetSiteConfig.mockResolvedValue(config({ ttsProvider: 'kokoro' }));
    await getServerInfra();
    expect(infra('ttsProvider', 'TTS_PROVIDER')).toBe('kokoro');

    // Owner clears the DB value; without invalidation the snapshot is still warm.
    mockGetSiteConfig.mockResolvedValue(EMPTY);
    invalidateServerInfra();
    await getServerInfra();

    expect(infra('ttsProvider', 'TTS_PROVIDER')).toBeUndefined();
  });
});
