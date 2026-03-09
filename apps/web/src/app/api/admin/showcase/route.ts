import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

/** GET /api/admin/showcase/podcasts — List podcasts eligible for showcase building */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const podcasts = await prisma.podcast.findMany({
    where: { status: { in: ['SCRIPT_READY', 'READY'] } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      ttsProvider: true,
      updatedAt: true,
      _count: { select: { segments: true } },
    },
  });

  return NextResponse.json({
    podcasts: podcasts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      ttsProvider: p.ttsProvider,
      segmentCount: p._count.segments,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}
