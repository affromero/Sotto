import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/admin/landing-showcase/segments?podcastId=X
 * Returns segment timing data for bidirectional segment#/seconds mapping.
 */
export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const podcastId = request.nextUrl.searchParams.get('podcastId');
  if (!podcastId) {
    return errorResponse('podcastId is required', 400);
  }

  const segments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: {
      order: true,
      speaker: true,
      startTime: true,
      duration: true,
    },
  });

  return NextResponse.json({ segments });
}
