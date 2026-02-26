import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const RANGE_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const VALID_RANGES = Object.keys(RANGE_MS);

/**
 * GET /api/admin/analytics/live?range=15m|1h|1d|7d
 * Returns country breakdown of active visitors for the given time range.
 * Admin-only.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return errorResponse('Unauthorized', 401);
  }

  const rangeParam = request.nextUrl.searchParams.get('range') ?? '15m';
  const range = VALID_RANGES.includes(rangeParam) ? rangeParam : '15m';
  const since = new Date(Date.now() - RANGE_MS[range]);

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
