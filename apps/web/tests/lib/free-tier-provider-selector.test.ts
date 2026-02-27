import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGetFreeTierConfig = vi.fn();
const mockResolveAutoModel = vi.fn();

vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: (...args: unknown[]) => mockGetFreeTierConfig(...args),
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: (...args: unknown[]) => mockResolveAutoModel(...args),
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn().mockReturnValue({ qualityTier: 'best' }),
  compareQuality: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: vi.fn().mockReturnValue({ models: [] }),
}));

const mockFreeProviderUsageFindMany = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    freeProviderUsage: {
      findMany: (...args: unknown[]) => mockFreeProviderUsageFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// ---- Import under test ----

import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';

// ---- Helpers ----

const autoModelDefaults = {
  aiProvider: 'groq',
  aiModel: 'llama-3.1-8b-instant',
  ttsProvider: 'kittentts',
  ttsModel: 'kitten-tts-mini-0.8',
  sttProvider: 'groq',
  sttModel: 'whisper-large-v3-turbo',
};

const baseFreeTierConfig = {
  generationLimit: 3,
  ttsAllocations: [],
  aiAllocations: [],
};

// ---- Tests ----

describe('selectFreeTierProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAutoModel.mockResolvedValue(autoModelDefaults);
    mockGetFreeTierConfig.mockResolvedValue(baseFreeTierConfig);
    mockFreeProviderUsageFindMany.mockResolvedValue([]);
  });

  describe('empty allocations — falls back to auto model config', () => {
    it('returns auto model providers with freeTierConfig quotas when no allocations', async () => {
      const result = await selectFreeTierProviders('user-001');

      expect(result).toEqual({
        aiProvider: 'groq',
        aiModel: 'llama-3.1-8b-instant',
        aiQuota: 3,
        ttsProvider: 'kittentts',
        ttsModel: 'kitten-tts-mini-0.8',
        ttsQuota: 3,
      });
    });

    it('does not query per-provider usage when no allocations exist', async () => {
      await selectFreeTierProviders('user-001');

      expect(mockFreeProviderUsageFindMany).not.toHaveBeenCalled();
    });

    it('uses resolveAutoModel FREE tier', async () => {
      await selectFreeTierProviders('user-001');

      expect(mockResolveAutoModel).toHaveBeenCalledWith('FREE');
    });
  });

  describe('TTS allocation exhausted — falls back to auto model', () => {
    it('falls back to auto model ttsProvider when all TTS allocations exhausted', async () => {
      mockGetFreeTierConfig.mockResolvedValue({
        ...baseFreeTierConfig,
        ttsAllocations: [{ provider: 'elevenlabs', model: 'eleven_v3', quota: 5 }],
      });
      // User has used all 5 elevenlabs quota
      mockFreeProviderUsageFindMany.mockResolvedValue([
        { category: 'tts', provider: 'elevenlabs', used: 5 },
      ]);

      const result = await selectFreeTierProviders('user-001');

      expect(result.ttsProvider).toBe('kittentts');
      expect(result.ttsModel).toBe('kitten-tts-mini-0.8');
    });
  });

  describe('AI allocation exhausted — falls back to auto model', () => {
    it('falls back to auto model aiProvider when all AI allocations exhausted', async () => {
      mockGetFreeTierConfig.mockResolvedValue({
        ...baseFreeTierConfig,
        aiAllocations: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', quota: 10 }],
      });
      // User has used all 10 anthropic quota
      mockFreeProviderUsageFindMany.mockResolvedValue([
        { category: 'ai', provider: 'anthropic', used: 10 },
      ]);

      const result = await selectFreeTierProviders('user-001');

      expect(result.aiProvider).toBe('groq');
      expect(result.aiModel).toBe('llama-3.1-8b-instant');
    });
  });
});
