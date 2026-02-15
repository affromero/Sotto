import { NextRequest, NextResponse } from 'next/server';
import { subDays, startOfDay } from 'date-fns';
import { buildTrafficReport } from '@/lib/traffic-report';

export async function GET(request: NextRequest) {
  const key = process.env.ADMIN_REPORT_KEY;
  if (!key) {
    return NextResponse.json({ error: 'ADMIN_REPORT_KEY not configured' }, { status: 500 });
  }

  const auth = request.headers.get('authorization');
  if (!auth || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const periodParam = request.nextUrl.searchParams.get('period') ?? '7';
  const periodDays = Math.max(1, Math.min(90, parseInt(periodParam, 10) || 7));
  const since = subDays(startOfDay(new Date()), periodDays);

  const report = await buildTrafficReport(since, periodDays);
  return NextResponse.json(report);
}
