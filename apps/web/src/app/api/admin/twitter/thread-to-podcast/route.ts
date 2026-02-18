import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { addJob, JobType, adminThreadToPodcastQueue } from '@/lib/queue';
import { threadToPodcastSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = threadToPodcastSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const job = await addJob(adminThreadToPodcastQueue, JobType.ADMIN_THREAD_TO_PODCAST, {
    tweetUrl: parsed.data.tweetUrl,
    adminUserId: adminId,
    message: parsed.data.message,
  });

  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
