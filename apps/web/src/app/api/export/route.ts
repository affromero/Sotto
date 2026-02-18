import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { dataExportQueue, addJob, JobType } from '@/lib/queue';
import type { DataExportPayload } from '@/lib/queue';
import { z } from 'zod';

const exportSchema = z.object({
  exportType: z.enum([
    'playback_sessions',
    'behavioral_events',
    'user_features',
    'podcast_features',
    'interactions',
    'training_pairs',
  ]),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  format: z.enum(['jsonl', 'csv']).default('jsonl'),
});

/**
 * POST /api/export
 * Admin-only endpoint to trigger data export jobs.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload: DataExportPayload = parsed.data;
  const job = await addJob(dataExportQueue, JobType.EXPORT_DATA, payload);

  return NextResponse.json(
    { jobId: job.id, status: 'queued', exportType: payload.exportType },
    { status: 202 }
  );
}
