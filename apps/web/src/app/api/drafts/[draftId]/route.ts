import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateDraftSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { draftId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: draftId },
    include: {
      discovery: {
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  if (!podcast || podcast.userId !== session.user.id || podcast.status !== 'DRAFT') {
    return errorResponse('Not found', 404);
  }

  return NextResponse.json({
    id: podcast.id,
    title: podcast.title,
    topic: podcast.topic,
    draftData: podcast.draftData,
    discovery: podcast.discovery
      ? {
          id: podcast.discovery.id,
          topic: podcast.discovery.topic,
          depth: podcast.discovery.depth,
          audienceLevel: podcast.discovery.audienceLevel,
          audience: podcast.discovery.audience,
          focusAreas: podcast.discovery.focusAreas,
          tone: podcast.discovery.tone,
          durationTarget: podcast.discovery.durationTarget,
          speakers: podcast.discovery.speakers,
          messages: podcast.discovery.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            chips: msg.chips,
            createdAt: msg.createdAt.toISOString(),
          })),
        }
      : null,
    createdAt: podcast.createdAt.toISOString(),
    updatedAt: podcast.updatedAt.toISOString(),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { draftId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: draftId },
    select: { userId: true, status: true },
  });

  if (!podcast || podcast.userId !== session.user.id || podcast.status !== 'DRAFT') {
    return errorResponse('Not found', 404);
  }

  const body = await request.json();
  const parsed = updateDraftSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { draftData, metadata } = parsed.data;

  const podcastUpdate: Record<string, unknown> = {};
  if (draftData !== undefined) podcastUpdate.draftData = draftData;
  if (metadata?.topic) {
    podcastUpdate.title = metadata.topic.slice(0, 200);
    podcastUpdate.topic = metadata.topic;
  }

  if (Object.keys(podcastUpdate).length > 0) {
    await prisma.podcast.update({
      where: { id: draftId },
      data: podcastUpdate,
    });
  }

  if (metadata) {
    await prisma.discovery.updateMany({
      where: { podcastId: draftId },
      data: {
        topic: metadata.topic ?? undefined,
        depth: metadata.depth ?? undefined,
        audienceLevel: metadata.audienceLevel ?? undefined,
        audience: metadata.audience ?? undefined,
        focusAreas: metadata.focusAreas ?? undefined,
        tone: metadata.tone ?? undefined,
        durationTarget: metadata.durationTarget ?? undefined,
      },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { draftId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: draftId },
    select: { userId: true, status: true },
  });

  if (!podcast || podcast.userId !== session.user.id || podcast.status !== 'DRAFT') {
    return errorResponse('Not found', 404);
  }

  await prisma.podcast.delete({ where: { id: draftId } });

  return NextResponse.json({ ok: true });
}
