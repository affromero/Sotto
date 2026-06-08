import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getTtsOptions } from '@/app/api/tts-options/route';

const mockAuthenticateRequest = vi.fn();
const mockListByokProviders = vi.fn();
const mockUserFindUnique = vi.fn();
const mockGetAutoModelConfig = vi.fn();

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

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
  resolveTtsIncludedModels: () => ({
    freeTtsModels: ['openai:tts-1'],
    proTtsModels: ['openai:tts-1'],
  }),
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
  ],
}));

describe('GET /api/tts-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUserFindUnique.mockResolvedValue({ plan: 'FREE', role: 'USER' });
    mockGetAutoModelConfig.mockResolvedValue({ adminViewMode: 'FREE' });
  });

  it('omits Auto for BYOK users so creation submits a concrete provider', async () => {
    mockListByokProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);

    const request = new NextRequest('https://sotto.test/api/tts-options');
    const response = await getTtsOptions(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isByok).toBe(true);
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
});
