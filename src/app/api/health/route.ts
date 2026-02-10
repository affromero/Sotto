import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};
  let healthy = true;

  // Check database
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: 'error', latencyMs: Date.now() - dbStart };
    healthy = false;
  }

  // Check Redis
  const redisStart = Date.now();
  try {
    const client = getRedisClient();
    await client.ping();
    checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch {
    checks.redis = { status: 'error', latencyMs: Date.now() - redisStart };
    healthy = false;
  }

  const envKeys = [
    'DATABASE_URL',
    'REDIS_URL',
    'NEXTAUTH_SECRET',
    'SITE_PASSWORD',
    'PITCH_PASSWORD',
    'ANTHROPIC_API_KEY',
    'ELEVENLABS_API_KEY',
    'STRIPE_SECRET_KEY',
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
      env,
    },
    { status: healthy ? 200 : 503 }
  );
}
