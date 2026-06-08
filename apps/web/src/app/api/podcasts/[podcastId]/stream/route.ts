import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-response';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPodcastStatusSubscriber } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE endpoint for real-time podcast status updates.
 * Subscribes to a Redis pub/sub channel for the given podcast
 * and streams status change events as they arrive.
 *
 * Access is owner-only so generation status cannot leak across tenants.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> }
) {
  const { podcastId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  const subscriber = createPodcastStatusSubscriber(podcastId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(encoder.encode(': connected\n\n'));

      subscriber.subscribe((data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller closed
        }
      });

      // Keepalive every 30s to prevent proxy/load balancer timeouts
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        subscriber.cleanup().catch((err) => {
          logger.warn('Podcast SSE subscriber cleanup failed', {
            podcastId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        try {
          controller.close();
        } catch {
          // Already closed
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
