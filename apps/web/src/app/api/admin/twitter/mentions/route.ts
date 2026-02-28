import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { mentionsQuerySchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = mentionsQuerySchema.safeParse(params);

  if (!parsed.success) {
    return errorResponse('Invalid query parameters', 400, {
      issues: parsed.error.issues,
    });
  }

  const { status, search, page, limit } = parsed.data;

  const where: Prisma.TweetMentionWhereInput = {};

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { text: { contains: search, mode: 'insensitive' } },
      { parsedTopic: { contains: search, mode: 'insensitive' } },
      { authorId: { contains: search } },
    ];
  }

  const [mentions, total] = await Promise.all([
    prisma.tweetMention.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { name: true, handle: true, image: true } },
        podcast: { select: { id: true, title: true, status: true } },
      },
    }),
    prisma.tweetMention.count({ where }),
  ]);

  return NextResponse.json({
    mentions,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
