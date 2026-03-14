import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const attempts = await prisma.quizAttempt.findMany({
    where: { userId: authResult.userId },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      score: true,
      total: true,
      startedAt: true,
      quiz: {
        select: {
          podcast: {
            select: { id: true, title: true },
          },
        },
      },
    },
  });

  const totalQuizzes = attempts.length;
  const avgScore = totalQuizzes > 0
    ? Math.round(attempts.reduce((sum, a) => sum + (a.score / a.total) * 100, 0) / totalQuizzes)
    : 0;
  const totalCorrect = attempts.reduce((sum, a) => sum + a.score, 0);
  const totalQuestions = attempts.reduce((sum, a) => sum + a.total, 0);

  return NextResponse.json({
    totalQuizzes,
    avgScore,
    totalCorrect,
    totalQuestions,
    recentAttempts: attempts.map((a) => ({
      id: a.id,
      podcastId: a.quiz.podcast.id,
      podcastTitle: a.quiz.podcast.title,
      score: a.score,
      total: a.total,
      percentage: Math.round((a.score / a.total) * 100),
      date: a.startedAt.toISOString(),
    })),
  });
}
