import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

const mockUserFindUniqueOrThrow = vi.fn();
const mockUserTtsKeyFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
    },
    userTtsKey: {
      findFirst: (...args: unknown[]) => mockUserTtsKeyFindFirst(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockGetAutoModelConfig = vi.fn();
vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
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

// ---- Import under test ----
import { checkMusicGenerationGate, tryIncrementMusicGeneration } from '@/lib/music-gate';

// ---- Helpers ----

const baseConfig = {
  dailyMusicLimit: 1,
  dailyMusicLimitPro: 3,
};

/**
 * hasMusicByokKey queries userTtsKey.findFirst for suno/elevenlabs.
 * This helper controls whether a BYOK key is "found".
 */
function mockByokKey(found: boolean) {
  mockUserTtsKeyFindFirst.mockResolvedValue(found ? { id: 'key-1' } : null);
}

// ---- Tests ----

describe('checkMusicGenerationGate', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, SUNO_API_KEY: 'test-suno-key' };
    mockRedisGet.mockResolvedValue('0');
    mockRedisTtl.mockResolvedValue(-1);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows BYOK users without checking Redis daily counter', async () => {
    mockByokKey(true);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.isByokUser).toBe(true);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('allows admin users regardless of daily counter', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'ADMIN', plan: 'FREE' });
    mockRedisGet.mockResolvedValue('999');

    const result = await checkMusicGenerationGate('admin-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('allows SYSTEM role users the same as admins', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'SYSTEM', plan: 'FREE' });

    const result = await checkMusicGenerationGate('system-1');

    expect(result.allowed).toBe(true);
    expect(result.isByokUser).toBe(true); // admin/system get isByokUser=true
  });

  it('blocks free-tier users when daily counter equals the limit', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });
    mockRedisGet.mockResolvedValue('1'); // dailyUsed === dailyMusicLimit (1)
    mockRedisTtl.mockResolvedValue(3600);

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit_reached');
    expect(result.dailyUsed).toBe(1);
    expect(result.dailyRemaining).toBe(0);
    expect(result.resetInSeconds).toBe(3600);
  });

  it('allows free-tier users when daily counter is below the limit', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });
    mockRedisGet.mockResolvedValue('0');

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.dailyUsed).toBe(0);
    expect(result.dailyRemaining).toBe(1);
  });

  it('uses PRO daily limit for PRO users', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'PRO' });
    mockRedisGet.mockResolvedValue('2'); // 2 < 3 (PRO limit)

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.isProUser).toBe(true);
    expect(result.dailyLimit).toBe(3);
    expect(result.dailyRemaining).toBe(1);
  });

  it('blocks PRO users when they hit the PRO daily limit', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'PRO' });
    mockRedisGet.mockResolvedValue('3'); // 3 >= 3 (PRO limit)
    mockRedisTtl.mockResolvedValue(5000);

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit_reached');
    expect(result.dailyLimit).toBe(3);
    expect(result.resetInSeconds).toBe(5000);
  });

  it('blocks when no music provider is available (no platform key, no BYOK)', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SUNO_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;

    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_music_provider');
  });

  it('allows when platform has ELEVENLABS_API_KEY even without SUNO_API_KEY', async () => {
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: 'test-el-key' };
    delete process.env.SUNO_API_KEY;

    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });
    mockRedisGet.mockResolvedValue('0');

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(true);
  });

  it('uses 86400 as resetInSeconds when Redis key has no TTL', async () => {
    mockByokKey(false);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });
    mockRedisGet.mockResolvedValue('1');
    mockRedisTtl.mockResolvedValue(-1); // no TTL set

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.resetInSeconds).toBe(86400);
  });

  it('BYOK user with no platform key is still allowed (uses own key)', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SUNO_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;

    mockByokKey(true);
    mockGetAutoModelConfig.mockResolvedValue(baseConfig);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'USER', plan: 'FREE' });

    const result = await checkMusicGenerationGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.isByokUser).toBe(true);
  });
});

describe('tryIncrementMusicGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when Redis Lua returns -1 (at limit)', async () => {
    mockRedisEval.mockResolvedValue(-1);

    const result = await tryIncrementMusicGeneration('user-1', 1);

    expect(result).toBe(false);
  });

  it('returns true when Redis Lua returns the new count', async () => {
    mockRedisEval.mockResolvedValue(1);

    const result = await tryIncrementMusicGeneration('user-1', 3);

    expect(result).toBe(true);
    expect(mockRedisEval).toHaveBeenCalledTimes(1);
  });

  it('passes the correct Redis key and limit to eval', async () => {
    mockRedisEval.mockResolvedValue(1);

    await tryIncrementMusicGeneration('user-42', 5);

    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1,
      'free:music:daily:user-42',
      '5',
    );
  });

  it('returns true for successive increments under limit', async () => {
    mockRedisEval.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const first = await tryIncrementMusicGeneration('user-1', 3);
    const second = await tryIncrementMusicGeneration('user-1', 3);

    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});
