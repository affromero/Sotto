import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

const TTS_PROVIDER_IDS = new Set([
  'elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate', 'minimax', 'kittentts',
]);

const assignmentSchema = z.object({
  assignments: z.array(z.object({
    segmentId: z.string(),
    ttsProvider: z.string().refine((v) => TTS_PROVIDER_IDS.has(v), { message: 'Invalid TTS provider' }),
    ttsModel: z.string().optional(),
    ttsVoiceId: z.string().optional(),
  })),
});

/** GET — Return all segments with current provider/voice assignments */
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
      text: true,
      audioUrl: true,
      duration: true,
      ttsProvider: true,
      ttsModel: true,
      ttsVoiceId: true,
    },
  });

  if (segments.length === 0) {
    return errorResponse('Podcast not found or has no segments', 404);
  }

  return NextResponse.json({ segments });
}

/** PATCH — Batch update segment TTS overrides */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> },
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { podcastId } = await params;
  const body = await request.json();
  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Verify all segments belong to this podcast
  const segmentIds = parsed.data.assignments.map((a) => a.segmentId);
  const count = await prisma.segment.count({
    where: { podcastId, id: { in: segmentIds } },
  });
  if (count !== segmentIds.length) {
    return errorResponse('One or more segments do not belong to this podcast', 400);
  }

  await prisma.$transaction(
    parsed.data.assignments.map((a) =>
      prisma.segment.update({
        where: { id: a.segmentId },
        data: {
          ttsProvider: a.ttsProvider,
          ttsModel: a.ttsModel ?? null,
          ttsVoiceId: a.ttsVoiceId ?? null,
        },
      })
    )
  );

  return NextResponse.json({ updated: segmentIds.length });
}
