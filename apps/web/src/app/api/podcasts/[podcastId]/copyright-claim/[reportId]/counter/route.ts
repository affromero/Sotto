import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { copyrightCounterNoticeSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ podcastId: string; reportId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId, reportId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = copyrightCounterNoticeSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Verify the podcast belongs to the authenticated user
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== session.user.id) {
    return errorResponse('Only the podcast creator can file a counter-notice', 403);
  }

  // Verify the report exists and is a copyright claim on this podcast
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, reason: true, targetId: true, status: true },
  });

  if (!report || report.targetId !== podcastId || report.reason !== 'COPYRIGHT') {
    return errorResponse('Copyright claim not found', 404);
  }

  const terminalStatuses = ['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'];
  if (terminalStatuses.includes(report.status)) {
    return errorResponse('This claim has already been resolved', 409);
  }

  const updated = await prisma.report.update({
    where: { id: reportId },
    data: {
      counterNotice: parsed.data.counterNotice,
      status: 'REVIEWING',
    },
  });

  return NextResponse.json({ id: updated.id, status: updated.status });
}
