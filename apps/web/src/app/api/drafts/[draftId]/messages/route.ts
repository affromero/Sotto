import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { appendDraftMessagesSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function POST(
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
    include: { discovery: { select: { id: true } } },
  });

  if (!podcast || podcast.userId !== session.user.id || podcast.status !== 'DRAFT') {
    return errorResponse('Not found', 404);
  }

  if (!podcast.discovery) {
    return errorResponse('No discovery record', 400);
  }

  const body = await request.json();
  const parsed = appendDraftMessagesSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { messages, metadata } = parsed.data;

  await prisma.discoveryMessage.createMany({
    data: messages.map((msg) => ({
      discoveryId: podcast.discovery!.id,
      role: msg.role,
      content: msg.content,
      chips: msg.chips ?? undefined,
    })),
  });

  if (metadata) {
    const metaUpdate: Record<string, unknown> = {};
    if (metadata.topic !== undefined) metaUpdate.topic = metadata.topic;
    if (metadata.depth !== undefined) metaUpdate.depth = metadata.depth;
    if (metadata.audienceLevel !== undefined) metaUpdate.audienceLevel = metadata.audienceLevel;
    if (metadata.audience !== undefined) metaUpdate.audience = metadata.audience;
    if (metadata.focusAreas !== undefined) metaUpdate.focusAreas = metadata.focusAreas;
    if (metadata.tone !== undefined) metaUpdate.tone = metadata.tone;
    if (metadata.durationTarget !== undefined) metaUpdate.durationTarget = metadata.durationTarget;

    if (Object.keys(metaUpdate).length > 0) {
      await prisma.discovery.update({
        where: { id: podcast.discovery.id },
        data: metaUpdate,
      });
    }

    // Keep podcast title in sync with topic
    if (metadata.topic) {
      await prisma.podcast.update({
        where: { id: draftId },
        data: {
          title: metadata.topic.slice(0, 200),
          topic: metadata.topic,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
