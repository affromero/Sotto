import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/analytics/live
 * Returns country breakdown of active visitors in the last 15 minutes.
 * Admin-only.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return errorResponse('Unauthorized', 401);
  }

  const since = new Date(Date.now() - 15 * 60 * 1000);

  const [countries, totalActive] = await Promise.all([
    prisma.userSession.groupBy({
      by: ['country'],
      where: { lastSeenAt: { gte: since }, country: { not: null } },
      _count: true,
      orderBy: { _count: { country: 'desc' } },
      take: 50,
    }),
    prisma.userSession.count({
      where: { lastSeenAt: { gte: since } },
    }),
  ]);

  return NextResponse.json({
    since: since.toISOString(),
    totalActive,
    countries: countries.map((c) => ({
      country: c.country!,
      count: c._count,
    })),
  });
}
