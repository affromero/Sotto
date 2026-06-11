import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCostBreakdown, getDailyCostTrend, checkCostThresholds } from '@/lib/cost-monitor';

import { errorResponse } from '@/lib/api-response';
/**
 * GET /api/admin/costs — Provider cost breakdown dashboard (ADMIN only)
 *
 * Query params:
 *   period: '24h' | '7d' | '30d' | '90d' (default: '30d')
 *   trendDays: number (default: 30)
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }
  if (session.user.role !== 'ADMIN') {
    return errorResponse('Admin access required', 403);
  }

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') || '30d') as '24h' | '7d' | '30d' | '90d';
  const trendDays = Math.min(parseInt(searchParams.get('trendDays') || '30', 10), 90);

  const validPeriods = ['24h', '7d', '30d', '90d'];
  if (!validPeriods.includes(period)) {
    return errorResponse('Invalid period', 400);
  }

  const [breakdown, trend, warnings] = await Promise.all([
    getCostBreakdown(period),
    getDailyCostTrend(trendDays),
    checkCostThresholds(),
  ]);

  return NextResponse.json({
    breakdown,
    trend,
    warnings,
  });
}
