import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/redis';
import { generateQuestions } from '@/lib/taste-quiz';
import { tasteQuizQuerySchema, tasteQuizAnswerSchema } from '@/lib/validations';

/**
 * GET /api/taste-quiz?count=10
 * Generate fresh AI-powered quiz questions for the user.
 */
export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authed.userId;

    // Rate limit: 10 requests/hour (each triggers LLM generation)
    const rateLimit = await checkRateLimit(`taste-quiz:${userId}`, 10, 3600);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.', resetAt: rateLimit.resetAt },
        { status: 429 }
      );
    }

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const validation = tasteQuizQuerySchema.safeParse(params);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { count } = validation.data;
    const questions = await generateQuestions(userId, count);

    return NextResponse.json({ questions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate questions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/taste-quiz
 * Submit quiz answers — creates TasteQuizAnswer rows and upserts UserInterest.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authed.userId;
    const body = await request.json();
    const validation = tasteQuizAnswerSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { answers } = validation.data;

    // Resolve tag slugs to tag IDs
    const allSlugs = [...new Set(answers.flatMap((a) => a.tagSlugs))];
    const tags = await prisma.tag.findMany({
      where: { slug: { in: allSlugs } },
      select: { id: true, slug: true },
    });
    const slugToId = new Map(tags.map((t) => [t.slug, t.id]));

    let saved = 0;

    await prisma.$transaction(async (tx) => {
      for (const answer of answers) {
        // Save the quiz answer (upsert to handle retries)
        await tx.tasteQuizAnswer.upsert({
          where: { userId_questionId: { userId, questionId: answer.questionId } },
          create: {
            userId,
            questionId: answer.questionId,
            question: answer.question,
            tagSlugs: answer.tagSlugs,
            response: answer.response,
          },
          update: {
            response: answer.response,
            tagSlugs: answer.tagSlugs,
          },
        });
        saved++;

        // Skip interest updates for "skip" responses
        if (answer.response === 'skip') continue;

        const weight = answer.response === 'yes' ? 1.0 : -0.5;

        for (const slug of answer.tagSlugs) {
          const tagId = slugToId.get(slug);
          if (!tagId) continue;

          // Check if a non-quiz interest exists (onboarding/manual take priority)
          const existing = await tx.userInterest.findUnique({
            where: { userId_tagId: { userId, tagId } },
            select: { source: true },
          });

          if (existing && existing.source !== 'quiz') continue;

          // Upsert quiz-sourced interest (latest answer wins)
          await tx.userInterest.upsert({
            where: { userId_tagId: { userId, tagId } },
            create: { userId, tagId, source: 'quiz', weight },
            update: { weight, source: 'quiz' },
          });
        }
      }
    });

    return NextResponse.json({ saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save answers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/taste-quiz
 * Reset all taste quiz data for the user.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authed.userId;

    await prisma.$transaction([
      prisma.tasteQuizAnswer.deleteMany({ where: { userId } }),
      prisma.userInterest.deleteMany({ where: { userId, source: 'quiz' } }),
    ]);

    return NextResponse.json({ reset: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to reset quiz';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
