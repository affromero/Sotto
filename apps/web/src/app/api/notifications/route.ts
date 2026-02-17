import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { paginationSchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = paginationSchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: authed.userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({
      where: { userId: authed.userId },
    }),
    prisma.notification.count({
      where: { userId: authed.userId, read: false },
    }),
  ]);

  return NextResponse.json({
    notifications,
    total,
    unreadCount,
    page,
    limit,
    hasMore: skip + limit < total,
  });
}
