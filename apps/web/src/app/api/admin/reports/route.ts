import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const targetType = searchParams.get('targetType');
  const reason = searchParams.get('reason');
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);

  const where: Prisma.ReportWhereInput = {};
  if (status) where.status = status as Prisma.EnumReportStatusFilter;
  if (targetType) where.targetType = targetType;
  if (reason) where.reason = reason as Prisma.EnumReportReasonFilter;

  const [rawItems, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        reporter: { select: { id: true, name: true, email: true, handle: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  // Enrich podcast reports with podcast context
  const podcastIds = rawItems
    .filter((r) => r.targetType === 'podcast')
    .map((r) => r.targetId);

  const podcastMap = podcastIds.length > 0
    ? new Map(
        (
          await prisma.podcast.findMany({
            where: { id: { in: podcastIds } },
            select: { id: true, title: true, source: true, isHumanContent: true, status: true },
          })
        ).map((p) => [p.id, p])
      )
    : new Map();

  const items = rawItems.map((r) => ({
    ...r,
    podcast: r.targetType === 'podcast' ? podcastMap.get(r.targetId) ?? null : null,
  }));

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
