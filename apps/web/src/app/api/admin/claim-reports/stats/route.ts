import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
