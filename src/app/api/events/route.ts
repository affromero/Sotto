import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { eventIngestionQueue, addJob, JobType } from '@/lib/queue';
import { eventBatchSchema } from '@/lib/validations/events';
import type { IngestEventsPayload } from '@/lib/queue';

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
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid event batch' }, { status: 400 });
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

  const payload: IngestEventsPayload = { events };
  await addJob(eventIngestionQueue, JobType.INGEST_EVENTS, payload);

  return NextResponse.json({ accepted: events.length }, { status: 202 });
}
