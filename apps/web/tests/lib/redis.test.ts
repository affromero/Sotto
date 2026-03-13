import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';

// Mock ioredis - use vi.hoisted to ensure it's available in the mock
const { MockRedis } = vi.hoisted(() => {
  const MockRedis = vi.fn(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      keys: vi.fn(),
      scan: vi.fn(),
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      zrange: vi.fn(),
      zadd: vi.fn(),
      expire: vi.fn(),
      quit: vi.fn(),
      on: vi.fn(),
    };
  });
  return { MockRedis };
});

vi.mock('ioredis', () => ({
  default: MockRedis,
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('redis.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';

    // Reset module to clear singleton
    vi.resetModules();
  });

  describe('getRedisClient', () => {
    it('returns a singleton Redis client', async () => {
      const { getRedisClient: getRedisClientReimport } = await import('@/lib/redis');

      const client1 = getRedisClientReimport();
      const client2 = getRedisClientReimport();

      expect(client1).toBe(client2);
      expect(MockRedis).toHaveBeenCalledTimes(1);
    });

  });

  describe('cache.get', () => {
    it('retrieves and parses cached value', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();
      const testData = { id: 123, name: 'Test' };

      (client.get as Mock).mockResolvedValue(JSON.stringify(testData));

      const result = await cacheReimport.get('test-key');

      expect(result).toEqual(testData);
      expect(client.get).toHaveBeenCalledWith('test-key');
    });

    it('returns null when key does not exist', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.get as Mock).mockResolvedValue(null);

      const result = await cacheReimport.get('nonexistent-key');

      expect(result).toBeNull();
    });

    it('parses complex nested objects', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();
      const complexData = {
        user: { id: 1, profile: { name: 'John', tags: ['admin', 'user'] } },
        metadata: { created: '2024-01-01' },
      };

      (client.get as Mock).mockResolvedValue(JSON.stringify(complexData));

      const result = await cacheReimport.get('complex-key');

      expect(result).toEqual(complexData);
    });
  });

  describe('cache.set', () => {
    it('sets value without TTL', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();
      const testData = { id: 456, value: 'test' };

      (client.set as Mock).mockResolvedValue('OK');

      await cacheReimport.set('test-key', testData);

      expect(client.set).toHaveBeenCalledWith('test-key', JSON.stringify(testData));
      expect(client.setex).not.toHaveBeenCalled();
    });

    it('sets value with TTL', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();
      const testData = { id: 789, value: 'cached' };

      (client.setex as Mock).mockResolvedValue('OK');

      await cacheReimport.set('test-key', testData, 3600);

      expect(client.setex).toHaveBeenCalledWith('test-key', 3600, JSON.stringify(testData));
      expect(client.set).not.toHaveBeenCalled();
    });

    it('serializes primitive values', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.set as Mock).mockResolvedValue('OK');

      await cacheReimport.set('string-key', 'hello');
      await cacheReimport.set('number-key', 42);
      await cacheReimport.set('boolean-key', true);

      expect(client.set).toHaveBeenCalledWith('string-key', '"hello"');
      expect(client.set).toHaveBeenCalledWith('number-key', '42');
      expect(client.set).toHaveBeenCalledWith('boolean-key', 'true');
    });
  });

  describe('cache.delete', () => {
    it('deletes a single key', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.del as Mock).mockResolvedValue(1);

      await cacheReimport.delete('test-key');

      expect(client.del).toHaveBeenCalledWith('test-key');
    });
  });

  describe('cache.deletePattern', () => {
    it('deletes all keys matching pattern using SCAN', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.scan as Mock)
        .mockResolvedValueOnce(['0', ['user:1', 'user:2', 'user:3']]);
      (client.del as Mock).mockResolvedValue(3);

      await cacheReimport.deletePattern('user:*');

      expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'user:*', 'COUNT', 100);
      expect(client.del).toHaveBeenCalledWith('user:1', 'user:2', 'user:3');
    });

    it('handles multi-page SCAN results', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.scan as Mock)
        .mockResolvedValueOnce(['42', ['user:1']])
        .mockResolvedValueOnce(['0', ['user:2']]);
      (client.del as Mock).mockResolvedValue(1);

      await cacheReimport.deletePattern('user:*');

      expect(client.scan).toHaveBeenCalledTimes(2);
      expect(client.del).toHaveBeenCalledTimes(2);
    });

    it('does not call del when no keys match', async () => {
      const { cache: cacheReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.scan as Mock).mockResolvedValueOnce(['0', []]);

      await cacheReimport.deletePattern('nonexistent:*');

      expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'nonexistent:*', 'COUNT', 100);
      expect(client.del).not.toHaveBeenCalled();
    });
  });

  describe('checkRateLimit', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('allows request when under limit', async () => {
      const { checkRateLimit: checkRateLimitReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.zremrangebyscore as Mock).mockResolvedValue(0);
      (client.zcard as Mock).mockResolvedValue(2);
      (client.zadd as Mock).mockResolvedValue(1);
      (client.expire as Mock).mockResolvedValue(1);

      const result = await checkRateLimitReimport('user:123', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
      expect(result.resetAt).toBeGreaterThan(Date.now());
      expect(client.zadd).toHaveBeenCalled();
    });

    it('blocks request when at limit', async () => {
      const { checkRateLimit: checkRateLimitReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.zremrangebyscore as Mock).mockResolvedValue(0);
      (client.zcard as Mock).mockResolvedValue(10);
      (client.zrange as Mock).mockResolvedValue(['1704067200000', '1704067200000']);

      const result = await checkRateLimitReimport('user:123', 10, 60);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(client.zadd).not.toHaveBeenCalled();
    });

    it('removes old entries from sliding window', async () => {
      const { checkRateLimit: checkRateLimitReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();
      const now = Date.now();
      const windowSeconds = 60;

      (client.zremrangebyscore as Mock).mockResolvedValue(3);
      (client.zcard as Mock).mockResolvedValue(5);
      (client.zadd as Mock).mockResolvedValue(1);
      (client.expire as Mock).mockResolvedValue(1);

      await checkRateLimitReimport('user:123', 10, windowSeconds);

      expect(client.zremrangebyscore).toHaveBeenCalledWith(
        'ratelimit:user:123',
        0,
        now - windowSeconds * 1000
      );
    });

    it('uses correct key prefix', async () => {
      const { checkRateLimit: checkRateLimitReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.zremrangebyscore as Mock).mockResolvedValue(0);
      (client.zcard as Mock).mockResolvedValue(0);
      (client.zadd as Mock).mockResolvedValue(1);
      (client.expire as Mock).mockResolvedValue(1);

      await checkRateLimitReimport('api:user-456', 100, 3600);

      expect(client.zremrangebyscore).toHaveBeenCalledWith(
        'ratelimit:api:user-456',
        expect.any(Number),
        expect.any(Number)
      );
    });

  });

  describe('closeRedis', () => {
    it('closes the Redis connection', async () => {
      const { closeRedis: closeRedisReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.quit as Mock).mockResolvedValue('OK');

      await closeRedisReimport();

      expect(client.quit).toHaveBeenCalled();
    });

    it('handles multiple close calls safely', async () => {
      const { closeRedis: closeRedisReimport, getRedisClient: getRedisClientReimport } =
        await import('@/lib/redis');
      const client = getRedisClientReimport();

      (client.quit as Mock).mockResolvedValue('OK');

      await closeRedisReimport();
      await closeRedisReimport();

      expect(client.quit).toHaveBeenCalledTimes(1);
    });
  });
});
