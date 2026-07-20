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
let sharedQueueRedisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!generalRedisClient) {
    generalRedisClient = createRedisConnection('general');
  }
  return generalRedisClient;
}

export function getSharedQueueRedisClient(): Redis {
  if (!sharedQueueRedisClient) {
    sharedQueueRedisClient = createRedisConnection('queue-shared');
  }
  return sharedQueueRedisClient;
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

  async getWithTtl<T>(key: string): Promise<{ value: T | null; ttl: number }> {
    const client = getRedisClient();
    const pipeline = client.pipeline();
    pipeline.get(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();
    if (!results) return { value: null, ttl: -1 };
    const rawValue = results[0]?.[1] as string | null;
    const ttl = (results[1]?.[1] as number) ?? -1;
    return {
      value: rawValue ? JSON.parse(rawValue) : null,
      ttl: ttl > 0 ? ttl : -1,
    };
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
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== '0');
  },
};

/**
 * Redis-based semaphore for limiting concurrent operations per key.
 * Each slot is a Redis key with a TTL; acquiring increments a counter,
 * releasing decrements it. TTL acts as a safety net for leaked slots.
 */
export const semaphore = {
  async acquire(key: string, maxSlots: number, ttlSeconds: number = 120): Promise<boolean> {
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
  const member = `${now}:${crypto.randomUUID()}`;
  const script = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
    local current = redis.call('ZCARD', KEYS[1])
    if current >= tonumber(ARGV[2]) then
      local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
      local resetAt = tonumber(ARGV[3]) + tonumber(ARGV[4])
      if #oldest > 0 then resetAt = tonumber(oldest[2]) + tonumber(ARGV[4]) end
      return {0, 0, resetAt}
    end
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[5])
    redis.call('PEXPIRE', KEYS[1], ARGV[4])
    return {1, tonumber(ARGV[2]) - current - 1, tonumber(ARGV[3]) + tonumber(ARGV[4])}
  `;
  const result = (await client.eval(
    script,
    1,
    key,
    windowStart,
    limit,
    now,
    windowSeconds * 1000,
    member
  )) as [number, number, number];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    resetAt: result[2],
  };
}

// ---------------------------------------------------------------------------
// Episode status cache + pub/sub
// ---------------------------------------------------------------------------

const EPISODE_CACHE_PREFIX = 'episode:public:';
const EPISODE_CHANNEL_PREFIX = 'episode:status:';

const ACTIVE_STATUSES = new Set([
  'EXTRACTING',
  'DISCOVERING',
  'RESEARCHING',
  'PLANNING',
  'SCRIPTING',
  'COMPILING',
  'GENERATING_AUDIO',
  'STITCHING',
]);

export function getEpisodeCacheTtl(status: string): number {
  return ACTIVE_STATUSES.has(status) ? 2 : 30;
}

export async function invalidateEpisodeCache(episodeId: string): Promise<void> {
  await cache.delete(`${EPISODE_CACHE_PREFIX}${episodeId}`);
}

export async function publishEpisodeStatus(
  episodeId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const client = getRedisClient();
  await client.publish(`${EPISODE_CHANNEL_PREFIX}${episodeId}`, JSON.stringify(payload));
}

export function createEpisodeStatusSubscriber(episodeId: string) {
  const client = createRedisConnection(`sse-pod-${episodeId.slice(0, 8)}`);
  const channel = `${EPISODE_CHANNEL_PREFIX}${episodeId}`;

  return {
    channel,
    client,
    subscribe(onMessage: (data: string) => void) {
      client.subscribe(channel).catch((err) => {
        logger.error('Failed to subscribe to episode status channel', {
          episodeId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      client.on('message', (_ch: string, message: string) => {
        onMessage(message);
      });
    },
    async cleanup() {
      try {
        await client.unsubscribe(channel);
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

/**
 * Notification pub/sub channel prefix.
 * Workers publish after creating a notification; SSE subscribers listen.
 */
const NOTIF_CHANNEL_PREFIX = 'notifications:';

/**
 * Publish a notification event so SSE subscribers receive it instantly.
 * Uses the general Redis client (pub/sub publish does not block).
 */
export async function publishNotification(
  userId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const client = getRedisClient();
  await client.publish(`${NOTIF_CHANNEL_PREFIX}${userId}`, JSON.stringify(payload));
}

/**
 * Create a dedicated Redis connection for subscribing to a user's notification channel.
 * Each subscriber MUST have its own connection (ioredis enters subscriber mode and
 * blocks the connection for pub/sub only).
 *
 * Returns an object with the subscriber client and cleanup function.
 */
export function createNotificationSubscriber(userId: string) {
  const client = createRedisConnection(`sse-${userId.slice(0, 8)}`);
  const channel = `${NOTIF_CHANNEL_PREFIX}${userId}`;

  return {
    channel,
    client,
    subscribe(onMessage: (data: string) => void) {
      client.subscribe(channel).catch((err) => {
        logger.error('Failed to subscribe to notification channel', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      client.on('message', (_ch: string, message: string) => {
        onMessage(message);
      });
    },
    async cleanup() {
      try {
        await client.unsubscribe(channel);
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export async function closeRedis(): Promise<void> {
  if (generalRedisClient) {
    await generalRedisClient.quit();
    generalRedisClient = null;
  }
  if (sharedQueueRedisClient) {
    await sharedQueueRedisClient.quit();
    sharedQueueRedisClient = null;
  }
}
