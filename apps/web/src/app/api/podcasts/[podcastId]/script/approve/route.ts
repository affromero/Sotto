import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import type { ScriptTurn } from '@/lib/script-generator';

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
      { error: 'Script can only be approved when status is SCRIPT_READY' },
      { status: 400 }
    );
  }

  const script = await prisma.script.findUnique({
    where: { podcastId },
  });
  if (!script) {
    return NextResponse.json({ error: 'Script not found' }, { status: 404 });
  }

  const turns = script.turns as ScriptTurn[];
  await createSegmentsAndQueueAudio(
    podcastId,
    turns.map((t) => ({ speaker: t.speaker, text: t.text }))
  );

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'GENERATING_AUDIO' },
  });

  return NextResponse.json({ success: true });
}
