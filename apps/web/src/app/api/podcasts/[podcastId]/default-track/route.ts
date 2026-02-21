import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { setDefaultTrackSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast || podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = setDefaultTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { voiceTrackId } = parsed.data;

  if (voiceTrackId !== null) {
    // Validate the track exists and is READY
    const track = await prisma.voiceTrack.findUnique({
      where: { id: voiceTrackId },
      select: { podcastId: true, status: true },
    });

    if (!track || track.podcastId !== podcastId) {
      return NextResponse.json({ error: 'Voice track not found' }, { status: 404 });
    }

    if (track.status !== 'READY') {
      return NextResponse.json({ error: 'Only READY voice tracks can be set as default' }, { status: 400 });
    }
  }

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { defaultVoiceTrackId: voiceTrackId },
  });

  return NextResponse.json({ defaultVoiceTrackId: voiceTrackId });
}
