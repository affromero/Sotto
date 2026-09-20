import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getTtsOptions } from '@/app/api/v1/tts-options/route';

const mockAuthenticateRequest = vi.fn();
const mockListByokProviders = vi.fn();
const mockUserFindUnique = vi.fn();
const mockGetAutoModelConfig = vi.fn();
const siteConfiguration = vi.hoisted(() => ({
  ttsProvider: null as string | null,
  ttsBaseUrl: null as string | null,
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/byok', () => ({
  listByokProviders: (...args: unknown[]) => mockListByokProviders(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => siteConfiguration,
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
  resolveTtsIncludedModels: () => ['openai:tts-1', 'local:local'],
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getAllProviderMeta: () => [
    {
      id: 'openai',
      displayName: 'OpenAI',
      models: [
        {
          id: 'tts-1',
          displayName: 'TTS 1',
          tier: 'standard',
          supportedLanguages: new Set(['en']),
        },
      ],
    },
    {
      id: 'local',
      displayName: 'Local TTS sidecar',
      models: [
        {
          id: 'local',
          displayName: 'Local TTS',
          tier: 'standard',
          supportedLanguages: new Set(['en', 'es']),
        },
      ],
    },
  ],
}));

describe('GET /api/v1/tts-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUserFindUnique.mockResolvedValue({ role: 'USER' });
    mockGetAutoModelConfig.mockResolvedValue({ includedTtsModels: ['openai:tts-1'] });
    siteConfiguration.ttsProvider = null;
    siteConfiguration.ttsBaseUrl = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns concrete BYOK options without an Auto placeholder', async () => {
    mockListByokProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);

    const request = new NextRequest('https://sotto.test/api/v1/tts-options');
    const response = await getTtsOptions(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasCredential).toBe(true);
    expect(body.options).toEqual([
      expect.objectContaining({
        id: 'openai:tts-1',
        displayName: 'OpenAI TTS 1',
      }),
    ]);
    expect(body.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'auto' })])
    );
  });

  it('includes local TTS sidecar options when shared configuration selects it', async () => {
    siteConfiguration.ttsProvider = 'local';
    siteConfiguration.ttsBaseUrl = 'http://localhost:8000';
    mockListByokProviders.mockResolvedValue([]);

    const request = new NextRequest('https://sotto.test/api/v1/tts-options');
    const response = await getTtsOptions(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.options).toEqual([
      expect.objectContaining({
        id: 'local:local',
        displayName: 'Local TTS sidecar Local TTS',
      }),
    ]);
  });
});
