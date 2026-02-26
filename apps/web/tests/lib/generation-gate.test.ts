import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

const mockUser = vi.fn();
const mockUserUpdate = vi.fn().mockResolvedValue({});
const mockFreeProviderUsageFindMany = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUser(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
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

const mockRedisGet = vi.fn();
const mockRedisTtl = vi.fn();
const mockRedisEval = vi.fn();

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    get: (...args: unknown[]) => mockRedisGet(...args),
    ttl: (...args: unknown[]) => mockRedisTtl(...args),
    eval: (...args: unknown[]) => mockRedisEval(...args),
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetActiveReferralCount = vi.fn().mockResolvedValue(0);
vi.mock('@/lib/referrals', () => ({
  getReferralBonus: (count: number) => Math.min(count, 5),
  getActiveReferralCount: (...args: unknown[]) => mockGetActiveReferralCount(...args),
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
  dailyGenerationLimit: 1,
  aiAllocations: [],
  ttsAllocations: [],
};

// ---- Tests ----

describe('checkGenerationGate', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: 'test-key' };
    mockRedisGet.mockResolvedValue('0');
    mockRedisTtl.mockResolvedValue(-1);
    mockGetActiveReferralCount.mockResolvedValue(0);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows BYOK users without checking the daily counter', async () => {
    mockHasByokKey.mockResolvedValue(true);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 10, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.isByokUser).toBe(true);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('allows PRO users without checking the daily counter', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 100, role: 'USER', plan: 'PRO', dailyGenerationOverride: null });

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.isProUser).toBe(true);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('allows admin users regardless of daily counter', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 999, role: 'ADMIN', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('999');

    const result = await checkGenerationGate('admin-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('blocks free-tier users when Redis daily counter equals the limit', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 5, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('1'); // dailyUsed === dailyLimit (1)
    mockRedisTtl.mockResolvedValue(3600);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit_reached');
    expect(result.dailyUsed).toBe(1);
    expect(result.resetInSeconds).toBe(3600);
  });

  it('allows free-tier users when daily counter is below the limit', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('0'); // dailyUsed = 0 < dailyLimit (1)
    mockRedisTtl.mockResolvedValue(-1);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.dailyUsed).toBe(0);
  });

  it('blocks when no platform TTS provider is configured', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.KITTENTTS_URL;

    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_provider');
  });

  it('uses 86400 as resetInSeconds when Redis key has no TTL', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 1, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('1');
    mockRedisTtl.mockResolvedValue(-1); // no TTL set yet

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit_reached');
    expect(result.resetInSeconds).toBe(86400);
  });

  it('allows free-tier users with dailyGenerationOverride=0 (unlimited)', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 100, role: 'USER', plan: 'FREE', dailyGenerationOverride: 0 });
    mockRedisGet.mockResolvedValue('999');

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.dailyLimit).toBe(0);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('uses custom dailyGenerationOverride instead of global config', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig); // global = 1/day
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER', plan: 'FREE', dailyGenerationOverride: 5 });
    mockRedisGet.mockResolvedValue('3'); // 3 < 5 custom limit
    mockRedisTtl.mockResolvedValue(-1);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.dailyLimit).toBe(5);
    expect(result.dailyUsed).toBe(3);
  });

  it('blocks when custom dailyGenerationOverride is exceeded', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 10, role: 'USER', plan: 'FREE', dailyGenerationOverride: 5 });
    mockRedisGet.mockResolvedValue('5'); // 5 >= 5 custom limit
    mockRedisTtl.mockResolvedValue(7200);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit_reached');
    expect(result.dailyLimit).toBe(5);
    expect(result.dailyUsed).toBe(5);
    expect(result.resetInSeconds).toBe(7200);
  });

  it('adds referral bonus to daily limit for free users', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig); // global = 1/day
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockGetActiveReferralCount.mockResolvedValue(3);
    mockRedisGet.mockResolvedValue('2'); // 2 < 4 (1 base + 3 referral bonus)
    mockRedisTtl.mockResolvedValue(-1);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.dailyLimit).toBe(4); // 1 base + 3 referral bonus
  });

  it('caps referral bonus at 5', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig); // global = 1/day
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockGetActiveReferralCount.mockResolvedValue(20);
    mockRedisGet.mockResolvedValue('0');
    mockRedisTtl.mockResolvedValue(-1);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.dailyLimit).toBe(6); // 1 base + 5 cap
  });

  it('falls through to global config when dailyGenerationOverride is null', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig); // global = 1/day
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('1'); // 1 >= 1 global limit
    mockRedisTtl.mockResolvedValue(3600);

    const result = await checkGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit_reached');
    expect(result.dailyLimit).toBe(1);
  });
});

describe('tryIncrementFreeGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpdate.mockResolvedValue({});
    mockExecuteRaw.mockResolvedValue(1);
  });

  it('returns false when Redis Lua returns -1 (counter at limit)', async () => {
    mockRedisEval.mockResolvedValue(-1);

    const result = await tryIncrementFreeGeneration('user-1', 1);

    expect(result).toBe(false);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('returns true when Redis Lua returns the new count', async () => {
    mockRedisEval.mockResolvedValue(1);

    const result = await tryIncrementFreeGeneration('user-1', 1);

    expect(result).toBe(true);
    expect(mockRedisEval).toHaveBeenCalledTimes(1);
  });

  it('increments per-provider SQL counters when providerUsage is given', async () => {
    mockRedisEval.mockResolvedValue(1);

    const result = await tryIncrementFreeGeneration('user-1', 5, {
      ai: { provider: 'anthropic', quota: 3 },
      tts: { provider: 'elevenlabs', quota: 2 },
    });

    expect(result).toBe(true);
    // One $executeRaw per provider (TTS + AI)
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
  });

  it('skips per-provider increment when Redis returns -1', async () => {
    mockRedisEval.mockResolvedValue(-1);

    const result = await tryIncrementFreeGeneration('user-1', 5, {
      tts: { provider: 'elevenlabs', quota: 2 },
    });

    expect(result).toBe(false);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

describe('getFreeTierStatus', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: 'test-key' };
    mockRedisGet.mockResolvedValue('0');
    mockRedisTtl.mockResolvedValue(-1);
    mockGetActiveReferralCount.mockResolvedValue(0);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns basic status including daily Redis fields', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('0');

    const result = await getFreeTierStatus('user-1');

    expect(result.freeGenerationsUsed).toBe(2);
    expect(result.freeGenerationsLimit).toBe(5);
    expect(result.freeGenerationsRemaining).toBe(3);
    expect(result.dailyUsed).toBe(0);
    expect(result.dailyLimit).toBe(1);
    expect(result.dailyRemaining).toBe(1);
    expect(result.isByokUser).toBe(false);
    expect(result.isProUser).toBe(false);
    expect(result.aiQuotas).toBeUndefined();
    expect(result.ttsQuotas).toBeUndefined();
  });

  it('includes ttsQuotas when TTS allocations are configured', async () => {
    const config = {
      ...baseConfig,
      ttsAllocations: [{ provider: 'elevenlabs', model: 'eleven_v3', quota: 3 }],
    };
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 1, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
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
      ttsAllocations: [{ provider: 'elevenlabs', model: 'eleven_v3', quota: 3 }],
    };
    mockHasByokKey.mockResolvedValue(true);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });

    const result = await getFreeTierStatus('user-1');

    expect(result.isByokUser).toBe(true);
    expect(result.ttsQuotas).toBeUndefined();
    expect(mockFreeProviderUsageFindMany).not.toHaveBeenCalled();
  });

  it('returns isProUser true for PRO plan users and skips quota fetch', async () => {
    const config = {
      ...baseConfig,
      ttsAllocations: [{ provider: 'elevenlabs', model: 'eleven_v3', quota: 3 }],
    };
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(config);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'PRO', dailyGenerationOverride: null });

    const result = await getFreeTierStatus('user-1');

    expect(result.isProUser).toBe(true);
    expect(result.ttsQuotas).toBeUndefined();
    expect(mockFreeProviderUsageFindMany).not.toHaveBeenCalled();
  });

  it('includes resetInSeconds when Redis TTL is set', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'FREE', dailyGenerationOverride: null });
    mockRedisGet.mockResolvedValue('1');
    mockRedisTtl.mockResolvedValue(7200);

    const result = await getFreeTierStatus('user-1');

    expect(result.resetInSeconds).toBe(7200);
    expect(result.dailyUsed).toBe(1);
    expect(result.dailyRemaining).toBe(0);
  });

  it('uses custom dailyGenerationOverride in status', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig); // global = 1/day
    mockUser.mockResolvedValue({ freeGenerationsUsed: 2, role: 'USER', plan: 'FREE', dailyGenerationOverride: 10 });
    mockRedisGet.mockResolvedValue('3');

    const result = await getFreeTierStatus('user-1');

    expect(result.dailyLimit).toBe(10);
    expect(result.dailyRemaining).toBe(7);
  });

  it('returns Infinity dailyRemaining for unlimited override', async () => {
    mockHasByokKey.mockResolvedValue(false);
    mockGetFreeTierConfig.mockResolvedValue(baseConfig);
    mockUser.mockResolvedValue({ freeGenerationsUsed: 0, role: 'USER', plan: 'FREE', dailyGenerationOverride: 0 });
    mockRedisGet.mockResolvedValue('50');

    const result = await getFreeTierStatus('user-1');

    expect(result.dailyLimit).toBe(0);
    expect(result.dailyRemaining).toBe(Infinity);
  });
});
