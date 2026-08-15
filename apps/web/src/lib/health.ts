import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { getAgentStatus } from '@/lib/agent-availability';
import { ALL_QUEUE_NAMES } from '@/lib/queue';

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

export async function getHealthData(isAdmin: boolean): Promise<HealthData> {
  let healthy = true;

  // --- Always check DB + Redis (determines healthy/degraded for all callers) ---
  const dbCheck = async () => {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        key: 'database',
        result: { status: 'ok', latencyMs: Date.now() - start } as CheckResult,
        critical: true,
      };
    } catch {
      return {
        key: 'database',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
        critical: true,
      };
    }
  };

  const redisCheck = async () => {
    const start = Date.now();
    try {
      const client = getRedisClient();
      await client.ping();
      return {
        key: 'redis',
        result: { status: 'ok', latencyMs: Date.now() - start } as CheckResult,
        critical: true,
      };
    } catch {
      return {
        key: 'redis',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
        critical: true,
      };
    }
  };

  const r2Check = async () => {
    const start = Date.now();
    try {
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKey = process.env.R2_ACCESS_KEY_ID;
      const secretKey = process.env.R2_SECRET_ACCESS_KEY;
      const bucket = process.env.R2_BUCKET_NAME || 'sotto-storage';

      if (accountId && accessKey && secretKey) {
        const r2Client = new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        });
        await r2Client.send(new HeadBucketCommand({ Bucket: bucket }));
        return {
          key: 'storage',
          result: { status: 'ok', latencyMs: Date.now() - start } as CheckResult,
        };
      }
      return { key: 'storage', result: { status: 'not_configured', latencyMs: 0 } as CheckResult };
    } catch {
      return {
        key: 'storage',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
      };
    }
  };

  const anthropicCheck = async () => {
    const start = Date.now();
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(5000),
        });
        return {
          key: 'anthropic',
          result: {
            status: res.ok ? 'ok' : 'error',
            latencyMs: Date.now() - start,
            ...(!res.ok && { detail: `HTTP ${res.status}` }),
          } as CheckResult,
        };
      }
      return {
        key: 'anthropic',
        result: { status: 'not_configured', latencyMs: 0 } as CheckResult,
      };
    } catch {
      return {
        key: 'anthropic',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
      };
    }
  };

  const openaiCheck = async () => {
    const start = Date.now();
    try {
      if (process.env.OPENAI_API_KEY) {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          signal: AbortSignal.timeout(5000),
        });
        return {
          key: 'openai',
          result: {
            status: res.ok ? 'ok' : 'error',
            latencyMs: Date.now() - start,
            ...(!res.ok && { detail: `HTTP ${res.status}` }),
          } as CheckResult,
        };
      }
      return { key: 'openai', result: { status: 'not_configured', latencyMs: 0 } as CheckResult };
    } catch {
      return {
        key: 'openai',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
      };
    }
  };

  const elevenlabsCheck = async () => {
    const start = Date.now();
    try {
      if (process.env.ELEVENLABS_API_KEY) {
        const res = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
          signal: AbortSignal.timeout(5000),
        });
        return {
          key: 'elevenlabs',
          result: {
            status: res.ok ? 'ok' : 'error',
            latencyMs: Date.now() - start,
            ...(!res.ok && { detail: `HTTP ${res.status}` }),
          } as CheckResult,
        };
      }
      return {
        key: 'elevenlabs',
        result: { status: 'not_configured', latencyMs: 0 } as CheckResult,
      };
    } catch {
      return {
        key: 'elevenlabs',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
      };
    }
  };

  const claudeCodeCheck = async () => {
    const start = Date.now();
    try {
      const agentStatus = await getAgentStatus('claude-code');
      return {
        key: 'claudeCode',
        result: {
          status: agentStatus.readiness === 'ready' ? 'ok' : agentStatus.readiness,
          latencyMs: Date.now() - start,
          ...(agentStatus.detail ? { detail: agentStatus.detail } : {}),
        } as CheckResult,
      };
    } catch {
      return {
        key: 'claudeCode',
        result: { status: 'error', latencyMs: Date.now() - start } as CheckResult,
      };
    }
  };

  const queueCheck = async () => {
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
      const totalFailed = Object.values(queues).reduce((sum, q) => sum + q.failed, 0);
      return {
        key: 'queues',
        result: {
          status: totalFailed > 50 ? 'degraded' : 'ok',
          detail: JSON.stringify(queues),
        } as CheckResult,
      };
    } catch {
      return { key: 'queues', result: { status: 'error' } as CheckResult };
    }
  };

  // Non-admin: only run DB + Redis, return minimal response
  const coreResults = await Promise.allSettled([dbCheck(), redisCheck()]);
  for (const result of coreResults) {
    if (result.status === 'fulfilled') {
      const { critical, result: checkResult } = result.value as {
        key: string;
        result: CheckResult;
        critical?: boolean;
      };
      if (critical && checkResult.status === 'error') healthy = false;
    }
  }

  if (!isAdmin) {
    return {
      status: healthy ? 'healthy' : 'degraded',
      version: process.env.COMMIT_SHA || 'dev',
      timestamp: new Date().toISOString(),
    };
  }

  // Admin: run all remaining checks in parallel
  const checks: Record<string, CheckResult> = {};
  for (const result of coreResults) {
    if (result.status === 'fulfilled') {
      const { key, result: checkResult } = result.value as { key: string; result: CheckResult };
      checks[key] = checkResult;
    }
  }

  const adminResults = await Promise.allSettled([
    r2Check(),
    anthropicCheck(),
    openaiCheck(),
    elevenlabsCheck(),
    claudeCodeCheck(),
    queueCheck(),
  ]);

  for (const result of adminResults) {
    if (result.status === 'fulfilled') {
      const { key, result: checkResult } = result.value as { key: string; result: CheckResult };
      checks[key] = checkResult;
    }
  }

  const vapid = !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  const envKeys = [
    'DATABASE_URL',
    'REDIS_URL',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ];
  const env: Record<string, boolean> = {};
  for (const key of envKeys) {
    env[key] = !!process.env[key];
  }

  return {
    status: healthy ? 'healthy' : 'degraded',
    version: process.env.COMMIT_SHA || 'dev',
    timestamp: new Date().toISOString(),
    checks,
    vapid,
    env,
  };
}
