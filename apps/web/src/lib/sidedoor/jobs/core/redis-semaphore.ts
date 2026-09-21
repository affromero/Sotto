import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import {
  openSemaphoreSession,
  type SemaphoreConnectionPort,
} from 'thesidedoor-core/runtime/semaphore';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const CONNECTION_DEADLINE_MS = 10_000;

function semaphoreConnection(redisUrl: string, resource: string): SemaphoreConnectionPort {
  const resourceId = createHash('sha256').update(resource).digest('hex').slice(0, 12);
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    autoResubscribe: false,
    retryStrategy: null,
    reconnectOnError: null,
    connectTimeout: CONNECTION_DEADLINE_MS,
    commandTimeout: CONNECTION_DEADLINE_MS,
    keepAlive: 30_000,
    connectionName: `sotto-sidedoor-semaphore:${resourceId}`,
    ...(redisUrl.startsWith('rediss://') && { tls: {} }),
  });

  return {
    connect: () => client.connect(),
    eval: (script, keys, args) => client.eval(script, keys.length, ...keys, ...args),
    onError(listener) {
      client.on('error', listener);
      return () => client.off('error', listener);
    },
    onEnd(listener) {
      client.on('end', listener);
      return () => client.off('end', listener);
    },
    async end() {
      if (client.status === 'end') return;
      await new Promise<void>((resolve) => {
        const ended = () => {
          client.off('end', ended);
          resolve();
        };
        client.on('end', ended);
        client.disconnect(false);
        if (client.status === 'end') ended();
      });
    },
  };
}

/** One unused, non-replaying Redis session owns one logical capacity token. */
export async function openSottoSemaphore(options: {
  resource: string;
  limit: number;
  ttlMs: number;
  redisUrl?: string;
}) {
  const resource = options.resource;
  const limit = options.limit;
  const ttlMs = options.ttlMs;
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  return openSemaphoreSession(semaphoreConnection(redisUrl, resource), {
    namespace: SIDEDOOR_STATE_ID,
    resource,
    limit,
    ttlMs,
    connectMs: CONNECTION_DEADLINE_MS,
    commandMs: CONNECTION_DEADLINE_MS,
    closeMs: CONNECTION_DEADLINE_MS,
  });
}
