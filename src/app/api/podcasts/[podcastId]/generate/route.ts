import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import type { ExtractContentPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      discovery: {
        select: { sourceUrl: true, sourceContent: true },
      },
    },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (podcast.status !== 'PENDING' && podcast.status !== 'DISCOVERING') {
    return NextResponse.json(
      { error: 'Podcast must be in PENDING or DISCOVERING status to generate' },
      { status: 400 }
    );
  }

  // Update status to EXTRACTING
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'EXTRACTING' },
  });

  // Queue content extraction job
  const payload: ExtractContentPayload = {
    podcastId,
    userId: session.user.id,
    sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
    sourceText: podcast.discovery?.sourceContent ?? undefined,
  };

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload);

  return NextResponse.json({ success: true, message: 'Generation started' });
}
