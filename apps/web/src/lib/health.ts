import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { getAgentStatus } from '@/lib/agent-availability';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { getServerInfra } from '@/lib/server-config';
import {
  configuredLocalStorageRoot,
  configuredStorageProvider,
  getObjectStorageConfig,
} from '@/lib/storage/sidedoor/configuration';

export type CheckResult = { status: string; latencyMs?: number; detail?: string };

export interface HealthData {
  status: 'healthy' | 'degraded';
  timestamp: string;
  version?: string;
  checks?: Record<string, CheckResult>;
  oauth?: Record<string, boolean>;
  vapid?: boolean;
  env?: Record<string, boolean>;
}

interface Check {
  key: string;
  result: CheckResult;
  critical?: boolean;
}

async function databaseCheck(): Promise<Check> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      key: 'database',
      result: { status: 'ok', latencyMs: Date.now() - start },
      critical: true,
    };
  } catch {
    return {
      key: 'database',
      result: { status: 'error', latencyMs: Date.now() - start },
      critical: true,
    };
  }
}

async function redisCheck(): Promise<Check> {
  const start = Date.now();
  try {
    await getRedisClient().ping();
    return {
      key: 'redis',
      result: { status: 'ok', latencyMs: Date.now() - start },
      critical: true,
    };
  } catch {
    return {
      key: 'redis',
      result: { status: 'error', latencyMs: Date.now() - start },
      critical: true,
    };
  }
}

async function storageCheck(): Promise<Check> {
  const start = Date.now();
  try {
    const configuration = await getServerInfra();
    const provider = configuredStorageProvider(configuration);
    if (provider === 'local') {
      const root = configuredLocalStorageRoot(configuration);
      await mkdir(root, { recursive: true });
      await access(root, constants.R_OK | constants.W_OK);
    } else {
      const storage = await getObjectStorageConfig(configuration);
      try {
        await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
      } finally {
        storage.client.destroy();
      }
    }
    return {
      key: 'storage',
      result: { status: 'ok', latencyMs: Date.now() - start, detail: provider },
    };
  } catch (error) {
    return {
      key: 'storage',
      result: {
        status: 'error',
        latencyMs: Date.now() - start,
        detail: error instanceof Error ? error.message : 'Storage check failed',
      },
    };
  }
}

async function claudeCodeCheck(): Promise<Check> {
  const start = Date.now();
  try {
    const status = await getAgentStatus('claude-code');
    return {
      key: 'claudeCode',
      result: {
        status: status.readiness === 'ready' ? 'ok' : status.readiness,
        latencyMs: Date.now() - start,
        ...(status.detail ? { detail: status.detail } : {}),
      },
    };
  } catch {
    return { key: 'claudeCode', result: { status: 'error', latencyMs: Date.now() - start } };
  }
}

async function queueCheck(): Promise<Check> {
  try {
    const redis = getRedisClient();
    const queues: Record<string, { waiting: number; active: number; failed: number }> = {};
    for (const name of ALL_QUEUE_NAMES) {
      const [waiting, active, failed] = await Promise.all([
        redis.llen(`bull:${name}:wait`),
        redis.llen(`bull:${name}:active`),
        redis.zcard(`bull:${name}:failed`),
      ]);
      queues[name] = { waiting, active, failed };
    }
    const totalFailed = Object.values(queues).reduce((sum, queue) => sum + queue.failed, 0);
    return {
      key: 'queues',
      result: {
        status: totalFailed > 50 ? 'degraded' : 'ok',
        detail: JSON.stringify(queues),
      },
    };
  } catch {
    return { key: 'queues', result: { status: 'error' } };
  }
}

export async function getHealthData(isAdmin: boolean): Promise<HealthData> {
  const core = await Promise.all([databaseCheck(), redisCheck()]);
  const healthy = core.every((check) => !check.critical || check.result.status !== 'error');
  const base = {
    status: healthy ? ('healthy' as const) : ('degraded' as const),
    version: process.env.COMMIT_SHA || 'dev',
    timestamp: new Date().toISOString(),
  };
  if (!isAdmin) return base;

  const checks = Object.fromEntries(
    [...core, ...(await Promise.all([storageCheck(), claudeCodeCheck(), queueCheck()]))].map(
      (check) => [check.key, check.result]
    )
  );
  return {
    ...base,
    checks,
    vapid: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    env: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      REDIS_URL: Boolean(process.env.REDIS_URL),
    },
  };
}
