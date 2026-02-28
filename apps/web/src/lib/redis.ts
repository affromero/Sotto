import Redis, { RedisOptions } from 'ioredis';
import { logger } from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Base Redis options shared across all connections
 */
function getBaseRedisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      if (times > 10) {
        logger.warn(`Redis connection retry attempt ${times}, reconnecting...`);
      }
      return delay;
    },
    reconnectOnError(err) {
      if (err.message.includes('READONLY')) {
        logger.warn('Redis in readonly mode, reconnecting...');
        return true;
      }
      return false;
    },
    connectTimeout: 10000,
    keepAlive: 30000,
    ...(REDIS_URL.startsWith('rediss://') && { tls: {} }),
  };
}

/**
 * Create a new Redis connection
 * BullMQ requires dedicated connections for workers
 */
export function createRedisConnection(name?: string): Redis {
  const client = new Redis(REDIS_URL, getBaseRedisOptions());
  const prefix = name ? `[${name}] ` : '';

  client.on('error', (error) => {
    logger.error(`${prefix}Redis client error`, { error: error.message });
  });

  client.on('connect', () => {
    logger.debug(`${prefix}Redis client connected`);
  });

  client.on('ready', () => {
    logger.info(`${prefix}Redis client ready`);
  });

  client.on('reconnecting', () => {
    logger.warn(`${prefix}Redis client reconnecting...`);
  });

  return client;
}

// Singleton for general-purpose operations
let generalRedisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!generalRedisClient) {
    generalRedisClient = createRedisConnection('general');
  }
  return generalRedisClient;
}

/**
 * Cache helpers
 */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const client = getRedisClient();
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  },

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const client = getRedisClient();
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, serialized);
    } else {
      await client.set(key, serialized);
    }
  },

  async delete(key: string): Promise<void> {
    const client = getRedisClient();
    await client.del(key);
  },

  async deletePattern(pattern: string): Promise<void> {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  },
};

/**
 * Redis-based semaphore for limiting concurrent operations per key.
 * Each slot is a Redis key with a TTL; acquiring increments a counter,
 * releasing decrements it. TTL acts as a safety net for leaked slots.
 */
export const semaphore = {
  async acquire(
    key: string,
    maxSlots: number,
    ttlSeconds: number = 120
  ): Promise<boolean> {
    const client = getRedisClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, ttlSeconds);
    }
    if (count > maxSlots) {
      await client.decr(key);
      return false;
    }
    return true;
  },

  async release(key: string): Promise<void> {
    const client = getRedisClient();
    const count = await client.decr(key);
    if (count <= 0) {
      await client.del(key);
    }
  },
};

/**
 * Simple Redis counter helpers for tracking metrics (e.g., cache hit/miss counts).
 * Keys auto-expire after the given TTL.
 */
export const counters = {
  async increment(key: string, ttlSeconds = 86400): Promise<void> {
    const client = getRedisClient();
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, ttlSeconds);
  },
  async get(key: string): Promise<number> {
    const client = getRedisClient();
    const val = await client.get(key);
    return val ? parseInt(val, 10) : 0;
  },
};

/**
 * Rate limiting with sliding window
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = getRedisClient();
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  await client.zremrangebyscore(key, 0, windowStart);
  const current = await client.zcard(key);

  if (current >= limit) {
    const oldestEntry = await client.zrange(key, 0, 0, 'WITHSCORES');
    const resetAt =
      oldestEntry.length > 0
        ? parseInt(oldestEntry[1]) + windowSeconds * 1000
        : now + windowSeconds * 1000;
    return { allowed: false, remaining: 0, resetAt };
  }

  await client.zadd(key, now, `${now}`);
  await client.expire(key, windowSeconds);

  return { allowed: true, remaining: limit - current - 1, resetAt: now + windowSeconds * 1000 };
}

/**
 * Inspire Me failure event log — stores recent failures with reasons for admin visibility.
 * Capped to 100 entries. Each entry is a JSON object with section, reason, timestamp, userId.
 */
export interface InspireFailureEvent {
  section: string;
  reason: string;
  userId?: string;
  timestamp: string;
}

export const inspireFailures = {
  async push(event: InspireFailureEvent): Promise<void> {
    const client = getRedisClient();
    const key = 'inspire:failure_log';
    await client.lpush(key, JSON.stringify(event));
    await client.ltrim(key, 0, 99); // keep last 100
    await client.expire(key, 7 * 86400); // 7 day TTL
  },

  async recent(count = 50): Promise<InspireFailureEvent[]> {
    const client = getRedisClient();
    const raw = await client.lrange('inspire:failure_log', 0, count - 1);
    return raw.map((r) => JSON.parse(r) as InspireFailureEvent);
  },

  async clear(): Promise<void> {
    const client = getRedisClient();
    await client.del('inspire:failure_log');
  },
};

export async function closeRedis(): Promise<void> {
  if (generalRedisClient) {
    await generalRedisClient.quit();
    generalRedisClient = null;
  }
}
