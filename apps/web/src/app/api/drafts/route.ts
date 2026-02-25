import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createDraftSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = createDraftSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { tabMode, messages, metadata, importData } = parsed.data;

  const draftTitle =
    (tabMode === 'import' && importData?.title) || metadata?.topic?.slice(0, 200) || 'Untitled Draft';

  const podcast = await prisma.podcast.create({
    data: {
      userId: session.user.id,
      title: draftTitle,
      topic: metadata?.topic ?? importData?.topic ?? '',
      status: 'DRAFT',
      visibility: 'PRIVATE',
      draftData: tabMode === 'import'
        ? { tabMode, importData: importData ?? {} }
        : { tabMode },
    },
  });

  // Create Discovery record with chat messages for create-tab drafts
  if (tabMode === 'create') {
    const discovery = await prisma.discovery.create({
      data: {
        podcastId: podcast.id,
        userId: session.user.id,
        topic: metadata?.topic,
        depth: metadata?.depth,
        audienceLevel: metadata?.audienceLevel,
        audience: metadata?.audience,
        focusAreas: metadata?.focusAreas ?? [],
        tone: metadata?.tone,
        durationTarget: metadata?.durationTarget,
      },
    });

    if (messages && messages.length > 0) {
      await prisma.discoveryMessage.createMany({
        data: messages.map((msg) => ({
          discoveryId: discovery.id,
          role: msg.role,
          content: msg.content,
          chips: msg.chips ?? undefined,
        })),
      });
    }
  }

  return NextResponse.json({ id: podcast.id }, { status: 201 });
}
