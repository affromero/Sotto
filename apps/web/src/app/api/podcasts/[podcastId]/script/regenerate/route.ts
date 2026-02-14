import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { addJob, JobType, scriptGenerationQueue } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }
  if (podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (podcast.status !== 'SCRIPT_READY') {
    return NextResponse.json(
      { error: 'Script can only be regenerated when status is SCRIPT_READY' },
      { status: 400 }
    );
  }

  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
  });
  if (!discovery) {
    return NextResponse.json({ error: 'Discovery not found' }, { status: 404 });
  }

  // Delete existing script, segments, and references
  await prisma.$transaction([
    prisma.segment.deleteMany({ where: { podcastId } }),
    prisma.reference.deleteMany({ where: { podcastId } }),
    prisma.script.deleteMany({ where: { podcastId } }),
  ]);

  // Set status back to SCRIPTING and queue script generation
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'SCRIPTING' },
  });

  await addJob(scriptGenerationQueue, JobType.GENERATE_SCRIPT, {
    podcastId,
    userId: session.user.id,
    discoveryId: discovery.id,
    sourceContent: discovery.sourceContent ?? undefined,
  });

  return NextResponse.json({ success: true });
}
