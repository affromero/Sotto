import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const q = request.nextUrl.searchParams.get('q') ?? '';
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const podcasts = await prisma.podcast.findMany({
    where: {
      status: 'READY',
      visibility: 'PUBLIC',
      deletedAt: null,
      title: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      duration: true,
      createdAt: true,
      user: { select: { handle: true, name: true } },
    },
  });

  const results = podcasts.map((p) => ({
    id: p.id,
    title: p.title,
    duration: p.duration,
    createdAt: p.createdAt,
    creator: p.user.handle || p.user.name || 'Unknown',
  }));

  return NextResponse.json({ results });
}
