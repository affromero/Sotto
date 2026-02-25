import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { savedIdeaSchema, paginationSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
/**
 * GET /api/ideas
 * List user's saved ideas, newest first, paginated.
 */
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const validation = paginationSchema.safeParse(params);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message, 400);
  }

  const { page, limit } = validation.data;
  const skip = (page - 1) * limit;

  const [ideas, total] = await Promise.all([
    prisma.savedIdea.findMany({
      where: { userId: authed.userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        questionId: true,
        question: true,
        tagSlugs: true,
        category: true,
        podcastId: true,
        createdAt: true,
      },
    }),
    prisma.savedIdea.count({ where: { userId: authed.userId } }),
  ]);

  return NextResponse.json({
    ideas,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

/**
 * POST /api/ideas
 * Save a quiz question as an idea (upsert by userId + questionId).
 */
export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const validation = savedIdeaSchema.safeParse(body);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message, 400);
  }

  const { questionId, question, tagSlugs, category } = validation.data;

  const idea = await prisma.savedIdea.upsert({
    where: {
      userId_questionId: { userId: authed.userId, questionId },
    },
    create: {
      userId: authed.userId,
      questionId,
      question,
      tagSlugs,
      category,
    },
    update: {},
  });

  return NextResponse.json({ idea }, { status: 201 });
}
