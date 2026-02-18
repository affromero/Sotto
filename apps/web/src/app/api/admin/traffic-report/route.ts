import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { subDays, startOfDay } from 'date-fns';
import { buildTrafficReport } from '@/lib/traffic-report';

export async function GET(request: NextRequest) {
  const key = process.env.ADMIN_REPORT_KEY;
  if (!key) {
    return NextResponse.json({ error: 'ADMIN_REPORT_KEY not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const expected = `Bearer ${key}`;
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const periodParam = request.nextUrl.searchParams.get('period') ?? '7';
  const periodDays = Math.max(1, Math.min(90, parseInt(periodParam, 10) || 7));
  const since = subDays(startOfDay(new Date()), periodDays);

  const report = await buildTrafficReport(since, periodDays);
  return NextResponse.json(report);
}
