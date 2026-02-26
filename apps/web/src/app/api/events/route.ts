import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { eventIngestionQueue, addJob, JobType } from '@/lib/queue';
import { eventBatchSchema } from '@/lib/validations/events';
import type { IngestEventsPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
/**
 * POST /api/events
 * Accepts a batch of behavioral events for async ingestion.
 * Auth is optional — anonymous events are valuable.
 * Returns 202 Accepted immediately; processing happens in the worker.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid event batch', 400);
  }

  // Attach authenticated user ID if available (supplements client-side userId)
  const session = await auth().catch(() => null);
  const serverUserId = session?.user?.id;

  const events = parsed.data.events.map((event) => ({
    context: {
      ...event.context,
      userId: event.context.userId || serverUserId,
    },
    payload: event.payload as Record<string, unknown> & { eventType: string },
  }));

  // Extract client IP for geo lookup in the worker (never stored raw)
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined;

  const payload: IngestEventsPayload = { ip, events };
  await addJob(eventIngestionQueue, JobType.INGEST_EVENTS, payload);

  return NextResponse.json({ accepted: events.length }, { status: 202 });
}
