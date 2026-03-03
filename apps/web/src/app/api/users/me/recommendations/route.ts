import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
/**
 * DELETE /api/users/me/recommendations
 * Nuclear reset — clears all personalization data so the user starts fresh.
 * Deletes: UserInterest (all sources), TasteQuizAnswer, UserFeature, RecommendationLog.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const userId = session.user.id;

    await prisma.$transaction([
      prisma.userInterest.deleteMany({ where: { userId } }),
      prisma.tasteQuizAnswer.deleteMany({ where: { userId } }),
      prisma.userFeature.deleteMany({ where: { userId } }),
      prisma.recommendationLog.deleteMany({ where: { userId } }),
    ]);

    return NextResponse.json({ reset: true });
  } catch (error: unknown) {
    logger.error('Failed to reset recommendations', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to reset recommendations', 500);
  }
}
