import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addJob, JobType, pdfGenerationQueue } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * POST /api/podcasts/[podcastId]/export
 * Trigger PDF generation for a podcast. Returns existing PDF URL if already generated.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, status: true, pdfUrl: true, userId: true, visibility: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  // Allow export for owner, or for public/unlisted podcasts
  if (podcast.visibility === 'PRIVATE' && podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (podcast.status !== 'READY') {
    return NextResponse.json(
      { error: 'Podcast must be in READY status to export' },
      { status: 400 }
    );
  }

  // If PDF already exists, return it immediately
  if (podcast.pdfUrl) {
    return NextResponse.json({ status: 'ready', pdfUrl: podcast.pdfUrl });
  }

  // Queue PDF generation
  await addJob(pdfGenerationQueue, JobType.GENERATE_PDF, {
    podcastId: podcast.id,
    userId: session.user.id,
  });

  return NextResponse.json({ status: 'generating' });
}

/**
 * GET /api/podcasts/[podcastId]/export
 * Check PDF export status and return download URL if ready.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { pdfUrl: true, userId: true, visibility: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.visibility === 'PRIVATE' && podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (podcast.pdfUrl) {
    return NextResponse.json({ status: 'ready', pdfUrl: podcast.pdfUrl });
  }

  return NextResponse.json({ status: 'idle', pdfUrl: null });
}
