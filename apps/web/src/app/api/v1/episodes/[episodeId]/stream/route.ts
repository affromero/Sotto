import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { createEpisodeStatusSubscriber, semaphore } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ episodeId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { episodeId } = await params;
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true },
  });
  if (!episode) {
    return new Response('Not found', { status: 404 });
  }
  if (episode.userId !== authenticated.userId && !(await isUserAdmin(authenticated.userId))) {
    return new Response('Forbidden', { status: 403 });
  }

  const userSlot = `sse:episode:user:${authenticated.userId}`;
  const globalSlot = 'sse:episode:global';
  if (!(await semaphore.acquire(userSlot, 5, 3600))) {
    return new Response('Too many active streams', { status: 429 });
  }
  if (!(await semaphore.acquire(globalSlot, 100, 3600))) {
    await semaphore.release(userSlot);
    return new Response('Too many active streams', { status: 503 });
  }

  const subscriber = createEpisodeStatusSubscriber(episodeId);
  let released = false;
  const releaseSlots = async () => {
    if (released) return;
    released = true;
    await Promise.all([semaphore.release(userSlot), semaphore.release(globalSlot)]);
  };
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(': connected\n\n'));

      subscriber.subscribe((data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // The disconnect handler owns cleanup.
        }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        subscriber.cleanup().catch((error) => {
          logger.warn('Episode status subscriber cleanup failed', {
            episodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        releaseSlots().catch((error) => {
          logger.warn('Episode status stream slot cleanup failed', {
            episodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        try {
          controller.close();
        } catch {
          // The stream may already be closed.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
