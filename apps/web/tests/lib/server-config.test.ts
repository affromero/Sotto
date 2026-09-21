/** Shared server configuration is the only runtime source after migration. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SiteConfigData } from '@/lib/site-config';

const mockGetSiteConfig = vi.fn();
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...a: unknown[]) => mockGetSiteConfig(...a),
}));

import { getServerInfra, infra, invalidateServerInfra } from '@/lib/server-config';

const EMPTY: SiteConfigData = {
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

function config(over: Partial<SiteConfigData>): SiteConfigData {
  return { ...EMPTY, ...over };
}

describe('server-config infra accessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSiteConfig.mockResolvedValue(EMPTY);
    invalidateServerInfra();
  });

  it('returns the shared configuration value', async () => {
    process.env.STT_PROVIDER = 'openai';
    mockGetSiteConfig.mockResolvedValue(config({ sttProvider: 'local' }));

    await getServerInfra();

    expect(infra('sttProvider')).toBe('local');
  });

  it('does not read environment configuration after migration', async () => {
    process.env.STT_PROVIDER = 'deepgram';
    mockGetSiteConfig.mockResolvedValue(config({ sttProvider: null }));

    await getServerInfra();

    expect(infra('sttProvider')).toBeUndefined();
  });

  it('returns undefined when neither DB config nor env is set (no fallback)', async () => {
    mockGetSiteConfig.mockResolvedValue(EMPTY);

    await getServerInfra();

    expect(infra('aiProvider')).toBeUndefined();
  });

  it('treats a blank shared value as unset', async () => {
    process.env.AI_MODEL = 'qwen3';
    mockGetSiteConfig.mockResolvedValue(config({ aiModel: '   ' }));

    await getServerInfra();

    expect(infra('aiModel')).toBeUndefined();
  });

  it('getServerInfra returns the full DB snapshot', async () => {
    mockGetSiteConfig.mockResolvedValue(
      config({ aiProvider: 'local', aiBaseUrl: 'http://localhost:11434/v1' })
    );

    const snap = await getServerInfra();

    expect(snap.aiProvider).toBe('local');
    expect(snap.aiBaseUrl).toBe('http://localhost:11434/v1');
    expect(snap.ttsProvider).toBeNull();
  });

  it('invalidate forces a re-read of changed DB config', async () => {
    mockGetSiteConfig.mockResolvedValue(config({ ttsProvider: 'kokoro' }));
    await getServerInfra();
    expect(infra('ttsProvider')).toBe('kokoro');

    // Owner clears the DB value; without invalidation the snapshot is still warm.
    mockGetSiteConfig.mockResolvedValue(EMPTY);
    invalidateServerInfra();
    await getServerInfra();

    expect(infra('ttsProvider')).toBeUndefined();
  });

  it('requires the async boundary to load configuration', () => {
    expect(() => infra('aiProvider')).toThrow(
      'Shared server configuration was not loaded before provider construction'
    );
  });
});
