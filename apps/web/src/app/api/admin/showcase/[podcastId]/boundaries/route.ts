import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

/** GET — Compute provider boundaries (where consecutive segments use different TTS providers) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> },
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { podcastId } = await params;

  const segments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      order: true,
      speaker: true,
      ttsProvider: true,
    },
  });

  if (segments.length === 0) {
    return errorResponse('Podcast not found or has no segments', 404);
  }

  const boundaries: Array<{
    afterSegmentId: string;
    beforeSegmentId: string;
    afterOrder: number;
    beforeOrder: number;
    fromProvider: string | null;
    toProvider: string | null;
  }> = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current.ttsProvider !== next.ttsProvider) {
      boundaries.push({
        afterSegmentId: current.id,
        beforeSegmentId: next.id,
        afterOrder: current.order,
        beforeOrder: next.order,
        fromProvider: current.ttsProvider,
        toProvider: next.ttsProvider,
      });
    }
  }

  return NextResponse.json({ boundaries });
}
