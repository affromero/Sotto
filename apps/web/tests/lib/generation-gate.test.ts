import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

const mockUser = vi.fn();
const mockFreeProviderUsageFindMany = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUser(...args),
    },
    freeProviderUsage: {
      findMany: (...args: unknown[]) => mockFreeProviderUsageFindMany(...args),
    },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockHasByokKey = vi.fn();
vi.mock('@/lib/byok', () => ({
  hasByokKey: (...args: unknown[]) => mockHasByokKey(...args),
}));

const mockGetFreeTierConfig = vi.fn();
vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: (...args: unknown[]) => mockGetFreeTierConfig(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----
import { checkGenerationGate, tryIncrementFreeGeneration, getFreeTierStatus } from '@/lib/generation-gate';

// ---- Helpers ----

const baseConfig = {
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5-20251001',
  ttsProvider: 'elevenlabs',
  ttsModel: 'eleven_v3',
  sttProvider: 'openai',
  sttModel: 'whisper-1',
  generationLimit: 5,
  aiAllocations: [],
  ttsAllocations: [],
};

// ---- Tests ----

describe('checkGenerationGate', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows BYOK users without checking quotas', async () => {
    mockHasByokKey.mockResolvedValue(true);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 10, role: 'USER' });

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.isByokUser).toBe(true);
  });

  it('blocks free-tier users when total limit exhausted', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 5, role: 'USER' });

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('free_tier_exhausted');
  });

  it('allows free-tier users with remaining quota', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER' });

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('blocks when all TTS allocations are exhausted', async () => {
    const config = {
      ...baseConfig,
      ttsAllocations: [
        { provider: 'elevenlabs', model: 'eleven_v3', quota: 2 },
        { provider: 'openai', model: 'tts-1-hd', quota: 3 },
      ],
    };
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 3, role: 'USER' });
    mockFreeProviderUsageFindMany.mockResolvedValue([
      { category: 'tts', provider: 'elevenlabs', used: 2 },
      { category: 'tts', provider: 'openai', used: 3 },
    ]);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('free_tier_exhausted');
    expect(result.ttsQuotas).toEqual([
      { provider: 'elevenlabs', model: 'eleven_v3', quota: 2, used: 2, remaining: 0 },
      { provider: 'openai', model: 'tts-1-hd', quota: 3, used: 3, remaining: 0 },
    ]);
  });

  it('allows when at least one TTS allocation has remaining quota', async () => {
    const config = {
      ...baseConfig,
      ttsAllocations: [
        { provider: 'elevenlabs', model: 'eleven_v3', quota: 2 },
        { provider: 'openai', model: 'tts-1-hd', quota: 3 },
      ],
    };
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 3, role: 'USER' });
    mockFreeProviderUsageFindMany.mockResolvedValue([
      { category: 'tts', provider: 'elevenlabs', used: 2 },
      { category: 'tts', provider: 'openai', used: 1 },
    ]);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.ttsQuotas).toEqual([
      { provider: 'elevenlabs', model: 'eleven_v3', quota: 2, used: 2, remaining: 0 },
      { provider: 'openai', model: 'tts-1-hd', quota: 3, used: 1, remaining: 2 },
    ]);
  });

  it('returns AI quota breakdowns when allocations exist', async () => {
    const config = {
      ...baseConfig,
      aiAllocations: [
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', quota: 3 },
        { provider: 'openai', model: 'gpt-4o-mini', quota: 2 },
      ],
    };
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 1, role: 'USER' });
    mockFreeProviderUsageFindMany.mockResolvedValue([
      { category: 'ai', provider: 'anthropic', used: 1 },
    ]);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.aiQuotas).toEqual([
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', quota: 3, used: 1, remaining: 2 },
      { provider: 'openai', model: 'gpt-4o-mini', quota: 2, used: 0, remaining: 2 },
    ]);
  });
});

describe('tryIncrementFreeGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when total counter already at limit', async () => {
    mockExecuteRaw.mockResolvedValue(0);

    const result = await tryIncrementFreeGeneration('user-1', 5);

    expect(result).toBe(false);
  });

  it('returns true and increments total counter', async () => {
    mockExecuteRaw.mockResolvedValue(1);

    const result = await tryIncrementFreeGeneration('user-1', 5);

    expect(result).toBe(true);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('increments per-provider counters when providerUsage provided', async () => {
    mockExecuteRaw.mockResolvedValue(1);

    const result = await tryIncrementFreeGeneration('user-1', 5, {
      ai: { provider: 'anthropic', quota: 3 },
      tts: { provider: 'elevenlabs', quota: 2 },
    });

    expect(result).toBe(true);
    // Total + TTS + AI = 3 calls
    expect(mockExecuteRaw).toHaveBeenCalledTimes(3);
  });

  it('skips per-provider increment when total fails', async () => {
    mockExecuteRaw.mockResolvedValue(0);

    const result = await tryIncrementFreeGeneration('user-1', 5, {
      tts: { provider: 'elevenlabs', quota: 2 },
    });

    expect(result).toBe(false);
    // Only total counter was attempted
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });
});

describe('getFreeTierStatus', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns basic status without quotas when no allocations', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER' });

    const result = await getFreeTierStatus('user-1');

    expect(result.freeGenerationsUsed).toBe(2);
    expect(result.freeGenerationsLimit).toBe(5);
    expect(result.freeGenerationsRemaining).toBe(3);
    expect(result.isByokUser).toBe(false);
    expect(result.aiQuotas).toBeUndefined();
    expect(result.ttsQuotas).toBeUndefined();
  });

  it('includes quota breakdowns when allocations exist', async () => {
    const config = {
      ...baseConfig,
      ttsAllocations: [
        { provider: 'elevenlabs', model: 'eleven_v3', quota: 3 },
      ],
    };
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 1, role: 'USER' });
    mockFreeProviderUsageFindMany.mockResolvedValue([
      { category: 'tts', provider: 'elevenlabs', used: 1 },
    ]);

    const result = await getFreeTierStatus('user-1');

    expect(result.ttsQuotas).toEqual([
      { provider: 'elevenlabs', model: 'eleven_v3', quota: 3, used: 1, remaining: 2 },
    ]);
  });

  it('skips quota fetch for BYOK users', async () => {
    const config = {
      ...baseConfig,
      ttsAllocations: [
        { provider: 'elevenlabs', model: 'eleven_v3', quota: 3 },
      ],
    };
    mockHasByokKey.mockResolvedValue(true);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER' });

    const result = await getFreeTierStatus('user-1');

    expect(result.isByokUser).toBe(true);
    expect(result.ttsQuotas).toBeUndefined();
    expect(mockFreeProviderUsageFindMany).not.toHaveBeenCalled();
  });
});
