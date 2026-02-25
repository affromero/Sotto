import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { announcementQueue, JobType } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
const announcementSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = announcementSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const job = await announcementQueue.add(JobType.SEND_ANNOUNCEMENT, parsed.data);

  return NextResponse.json({ jobId: job.id });
}
