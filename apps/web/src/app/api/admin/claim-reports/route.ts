import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const podcastId = searchParams.get('podcastId');
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);

  const where: Prisma.ClaimReportWhereInput = {};
  if (status) where.status = status as Prisma.EnumClaimReportStatusFilter;
  if (podcastId) where.podcastId = podcastId;

  const [items, total] = await Promise.all([
    prisma.claimReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        reporter: { select: { id: true, name: true, email: true, handle: true } },
        podcast: { select: { id: true, title: true } },
      },
    }),
    prisma.claimReport.count({ where }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
