import { NextRequest } from 'next/server';
import { createPodcastStatusSubscriber } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE endpoint for real-time podcast status updates.
 * Subscribes to a Redis pub/sub channel for the given podcast
 * and streams status change events as they arrive.
 *
 * No auth required — podcast status is public for public podcasts.
 * (Private podcast access is gated at the data level, not the stream.)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> },
) {
  const { podcastId } = await params;
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
