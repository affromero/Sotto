import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addJob, JobType, pdfGenerationQueue } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string }> };

/**
 * POST /api/episodes/[episodeId]/export
 * Trigger PDF generation for a episode. Returns existing PDF URL if already generated.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { episodeId } = await params;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { id: true, status: true, pdfUrl: true, userId: true, visibility: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  // Allow export for owner, or for public/unlisted episodes
  if (episode.visibility === 'PRIVATE' && episode.userId !== session.user.id) {
    return errorResponse('Not found', 404);
  }

  if (episode.status !== 'READY') {
    return errorResponse('Episode must be in READY status to export', 400);
  }

  // If PDF already exists, return it immediately
  if (episode.pdfUrl) {
    return NextResponse.json({ status: 'ready', pdfUrl: episode.pdfUrl });
  }

  // Queue PDF generation
  await addJob(pdfGenerationQueue, JobType.GENERATE_PDF, {
    episodeId: episode.id,
    userId: session.user.id,
  });

  return NextResponse.json({ status: 'generating' });
}

/**
 * GET /api/episodes/[episodeId]/export
 * Check PDF export status and return download URL if ready.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { episodeId } = await params;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { pdfUrl: true, userId: true, visibility: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  if (episode.visibility === 'PRIVATE' && episode.userId !== session.user.id) {
    return errorResponse('Not found', 404);
  }

  if (episode.pdfUrl) {
    return NextResponse.json({ status: 'ready', pdfUrl: episode.pdfUrl });
  }

  return NextResponse.json({ status: 'idle', pdfUrl: null });
}
