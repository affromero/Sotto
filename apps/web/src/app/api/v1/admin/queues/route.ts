import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getRedisClient } from '@/lib/redis';
import { ALL_QUEUE_NAMES } from '@/lib/queue';

export const dynamic = 'force-dynamic';

// Bearer-capable so a paired device can read queue depth. isUserAdmin checks
// the principal that actually authenticated, unlike the session-reading
// requireAdmin(), which would ignore which key made the request.
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  if (!(await isUserAdmin(authed.userId))) return errorResponse('Forbidden', 403);

  const redis = getRedisClient();
  const queues: Record<
    string,
    { waiting: number; active: number; completed: number; failed: number; delayed: number }
  > = {};

  await Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        redis.llen(`bull:${name}:wait`),
        redis.llen(`bull:${name}:active`),
        redis.zcard(`bull:${name}:completed`),
        redis.zcard(`bull:${name}:failed`),
        redis.zcard(`bull:${name}:delayed`),
      ]);
      queues[name] = { waiting, active, completed, failed, delayed };
    })
  );

  return NextResponse.json({ queues });
}
