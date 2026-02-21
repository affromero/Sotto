import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateVoiceTrackSchema } from '@/lib/validations';
import { deleteVoiceTrackFiles } from '@/lib/r2';

type RouteParams = { params: Promise<{ podcastId: string; trackId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, trackId } = await params;

  const track = await prisma.voiceTrack.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      podcastId: true,
      name: true,
      status: true,
      audioUrl: true,
      duration: true,
      ttsProvider: true,
      failureReason: true,
      voices: { select: { speaker: true, voiceId: true } },
    },
  });

  if (!track || track.podcastId !== podcastId) {
    return NextResponse.json({ error: 'Voice track not found' }, { status: 404 });
  }

  return NextResponse.json(track);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId, trackId } = await params;
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

  const track = await prisma.voiceTrack.findUnique({
    where: { id: trackId },
    select: { podcastId: true },
  });

  if (!track || track.podcastId !== podcastId) {
    return NextResponse.json({ error: 'Voice track not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = updateVoiceTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.voiceTrack.update({
    where: { id: trackId },
    data: parsed.data,
    select: { id: true, name: true, status: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, trackId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, defaultVoiceTrackId: true },
  });

  if (!podcast || podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const track = await prisma.voiceTrack.findUnique({
    where: { id: trackId },
    select: { podcastId: true },
  });

  if (!track || track.podcastId !== podcastId) {
    return NextResponse.json({ error: 'Voice track not found' }, { status: 404 });
  }

  // Delete from database (cascade deletes voices + segments)
  await prisma.voiceTrack.delete({ where: { id: trackId } });

  // Clear default if this was the default track
  if (podcast.defaultVoiceTrackId === trackId) {
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { defaultVoiceTrackId: null },
    });
  }

  // Clean up R2 files (fire-and-forget)
  deleteVoiceTrackFiles(podcastId, trackId).catch(() => {});

  return NextResponse.json({ success: true });
}
