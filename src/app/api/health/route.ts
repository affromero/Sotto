import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

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

  // Check R2 storage (non-critical — won't fail the health check)
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
    // Don't set healthy = false — storage issues are degraded, not down
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
      env,
    },
    { status: healthy ? 200 : 503 }
  );
}
