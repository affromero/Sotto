import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getRedisClient } from '@/lib/redis';
import { ALL_QUEUE_NAMES } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const redis = getRedisClient();
  const queues: Record<string, { waiting: number; active: number; completed: number; failed: number; delayed: number }> = {};

  await Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        redis.llen(`bull:${name}:wait`),
        redis.llen(`bull:${name}:active`),
        redis.get(`bull:${name}:completed`).then((v) => parseInt(v || '0', 10)),
        redis.zcard(`bull:${name}:failed`),
        redis.zcard(`bull:${name}:delayed`),
      ]);
      queues[name] = { waiting, active, completed, failed, delayed };
    })
  );

  return NextResponse.json({ queues });
}
