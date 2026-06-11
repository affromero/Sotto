import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const [pending, reviewing, actioned, dismissed] = await Promise.all([
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: 'REVIEWING' } }),
    prisma.report.count({ where: { status: 'RESOLVED_ACTIONED' } }),
    prisma.report.count({ where: { status: 'RESOLVED_DISMISSED' } }),
  ]);

  return NextResponse.json({
    pending,
    reviewing,
    actioned,
    dismissed,
    total: pending + reviewing + actioned + dismissed,
  });
}
