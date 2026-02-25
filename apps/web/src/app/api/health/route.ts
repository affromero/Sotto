import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { auth } from '@/lib/auth';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { isClaudeAvailable } from '@/lib/claude-code-client';

export const dynamic = 'force-dynamic';

type CheckResult = { status: string; latencyMs?: number; detail?: string };

const QUEUE_NAMES = [
  'content-extraction',
  'script-generation',
  'script-verification',
  'reference-validation',
  'audio-generation',
  'audio-stitching',
  'interactions',
  'segment-regeneration',
  'notifications',
  'pdf-generation',
  'twitter-mentions',
  'twitter-reply',
];

export async function GET() {
  const checks: Record<string, CheckResult> = {};
  let healthy = true;

  // --- Database ---
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: 'error', latencyMs: Date.now() - dbStart };
    healthy = false;
  }

  // --- Redis ---
  const redisStart = Date.now();
  try {
    const client = getRedisClient();
    await client.ping();
    checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch {
    checks.redis = { status: 'error', latencyMs: Date.now() - redisStart };
    healthy = false;
  }

  // --- OAuth providers (not sensitive — just reports which are configured) ---
  const oauth: Record<string, boolean> = {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    twitter: !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
    apple: !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
  };

  // --- VAPID (Web Push) ---
  const vapid = !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  // --- R2 Storage (non-critical) ---
  const r2Start = Date.now();
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
      checks.storage = { status: 'ok', latencyMs: Date.now() - r2Start };
    } else {
      checks.storage = { status: 'not_configured', latencyMs: 0 };
    }
  } catch {
    checks.storage = { status: 'error', latencyMs: Date.now() - r2Start };
  }

  // --- Anthropic API (non-critical) ---
  const anthropicStart = Date.now();
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(5000),
      });
      checks.anthropic = {
        status: res.ok ? 'ok' : 'error',
        latencyMs: Date.now() - anthropicStart,
        ...(!res.ok && { detail: `HTTP ${res.status}` }),
      };
    } else {
      checks.anthropic = { status: 'not_configured', latencyMs: 0 };
    }
  } catch {
    checks.anthropic = { status: 'error', latencyMs: Date.now() - anthropicStart };
  }

  // --- OpenAI API (non-critical) ---
  const openaiStart = Date.now();
  try {
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.openai = {
        status: res.ok ? 'ok' : 'error',
        latencyMs: Date.now() - openaiStart,
        ...(!res.ok && { detail: `HTTP ${res.status}` }),
      };
    } else {
      checks.openai = { status: 'not_configured', latencyMs: 0 };
    }
  } catch {
    checks.openai = { status: 'error', latencyMs: Date.now() - openaiStart };
  }

  // --- ElevenLabs API (non-critical) ---
  const elStart = Date.now();
  try {
    if (process.env.ELEVENLABS_API_KEY) {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        signal: AbortSignal.timeout(5000),
      });
      checks.elevenlabs = {
        status: res.ok ? 'ok' : 'error',
        latencyMs: Date.now() - elStart,
        ...(!res.ok && { detail: `HTTP ${res.status}` }),
      };
    } else {
      checks.elevenlabs = { status: 'not_configured', latencyMs: 0 };
    }
  } catch {
    checks.elevenlabs = { status: 'error', latencyMs: Date.now() - elStart };
  }

  // --- Groq API (non-critical, default STT provider) ---
  const groqStart = Date.now();
  try {
    if (process.env.GROQ_API_KEY) {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.groq = {
        status: res.ok ? 'ok' : 'error',
        latencyMs: Date.now() - groqStart,
        ...(!res.ok && { detail: `HTTP ${res.status}` }),
      };
    } else {
      checks.groq = { status: 'not_configured', latencyMs: 0 };
    }
  } catch {
    checks.groq = { status: 'error', latencyMs: Date.now() - groqStart };
  }

  // --- Claude Code CLI (non-critical) ---
  const claudeCodeStart = Date.now();
  try {
    const available = await isClaudeAvailable();
    checks.claudeCode = available
      ? { status: 'ok', latencyMs: Date.now() - claudeCodeStart }
      : { status: 'not_installed' };
  } catch {
    checks.claudeCode = { status: 'error', latencyMs: Date.now() - claudeCodeStart };
  }

  // --- BullMQ Queues (non-critical, uses existing Redis) ---
  try {
    const redis = getRedisClient();
    const queues: Record<string, { waiting: number; active: number; failed: number }> = {};
    for (const name of QUEUE_NAMES) {
      const [waiting, active, failed] = await Promise.all([
        redis.llen(`bull:${name}:wait`),
        redis.llen(`bull:${name}:active`),
        redis.zcard(`bull:${name}:failed`),
      ]);
      queues[name] = { waiting, active, failed };
    }
    const totalFailed = Object.values(queues).reduce((sum, q) => sum + q.failed, 0);
    checks.queues = {
      status: totalFailed > 50 ? 'degraded' : 'ok',
      detail: JSON.stringify(queues),
    };
  } catch {
    checks.queues = { status: 'error' };
  }

  // Public response — includes all checks (ok/error + latency only, no secrets)
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json(
      {
        status: healthy ? 'healthy' : 'degraded',
        version: process.env.COMMIT_SHA || 'dev',
        timestamp: new Date().toISOString(),
        checks,
        oauth,
        vapid,
      },
      { status: healthy ? 200 : 503 }
    );
  }

  // --- Admin-only: env var configuration ---
  const envKeys = [
    'DATABASE_URL',
    'REDIS_URL',
    'NEXTAUTH_SECRET',
    'SITE_PASSWORD',
    'PITCH_PASSWORD',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'GROQ_API_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ];

  const env: Record<string, boolean> = {};
  for (const key of envKeys) {
    env[key] = !!process.env[key];
  }

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      version: process.env.COMMIT_SHA || 'dev',
      timestamp: new Date().toISOString(),
      checks,
      oauth,
      vapid,
      env,
    },
    { status: healthy ? 200 : 503 }
  );
}
