import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const [pending, reviewing, verified, inaccurate, dismissed] = await Promise.all([
    prisma.claimReport.count({ where: { status: 'PENDING' } }),
    prisma.claimReport.count({ where: { status: 'REVIEWING' } }),
    prisma.claimReport.count({ where: { status: 'RESOLVED_VERIFIED' } }),
    prisma.claimReport.count({ where: { status: 'RESOLVED_INACCURATE' } }),
    prisma.claimReport.count({ where: { status: 'DISMISSED' } }),
  ]);

  return NextResponse.json({
    pending,
    reviewing,
    verified,
    inaccurate,
    dismissed,
    total: pending + reviewing + verified + inaccurate + dismissed,
  });
}
