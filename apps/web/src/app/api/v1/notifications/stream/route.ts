import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { createNotificationSubscriber } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE endpoint for real-time notifications.
 * Subscribes to a Redis pub/sub channel for the authenticated user
 * and streams notification events as they arrive.
 *
 * EventSource sends cookies automatically, so session auth works.
 */
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { userId } = authed;
  const subscriber = createNotificationSubscriber(userId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial keepalive so the client knows the connection is established
      controller.enqueue(encoder.encode(': connected\n\n'));

      subscriber.subscribe((data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller closed — cleanup will handle it
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

      // Cleanup when client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        subscriber.cleanup().catch((err) => {
          logger.warn('SSE subscriber cleanup failed', {
            userId,
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
