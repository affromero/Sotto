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

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
}
