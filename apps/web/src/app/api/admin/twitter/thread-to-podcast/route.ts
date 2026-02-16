import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addJob, JobType, adminThreadToPodcastQueue } from '@/lib/queue';
import { threadToPodcastSchema } from '@/lib/validations';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== 'ADMIN') return null;
  return session.user.id;
}

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
  });

  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
