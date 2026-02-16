import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/redis';
import { generateInspireQuestions } from '@/lib/taste-quiz';

const inspireQuestionsSchema = z.object({
  count: z.coerce.number().int().min(1).max(20).default(6),
  section: z.enum(['forYou', 'trending', 'news']).default('forYou'),
});

/**
 * GET /api/inspire/questions?count=6&section=forYou|trending|news
 * Returns TasteQuestion[] for the Inspire Me overlay.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const validation = inspireQuestionsSchema.safeParse(params);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
  }

  const { count, section } = validation.data;

  const rateLimit = await checkRateLimit(`inspire:${session.user.id}`, 10, 3600);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.', resetAt: rateLimit.resetAt },
      { status: 429 }
    );
  }

  const questions = await generateInspireQuestions(session.user.id, count, section);

  return NextResponse.json({ questions });
}
