import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  const quiz = await prisma.podcastQuiz.findUnique({
    where: { podcastId },
    include: {
      questions: { orderBy: { order: 'asc' } },
    },
  });

  if (!quiz || quiz.status !== 'READY') {
    return errorResponse('Quiz not found', 404);
  }

  // Check if user has already submitted
  let hasSubmitted = false;
  if (authResult) {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { userId_quizId: { userId: authResult.userId, quizId: quiz.id } },
    });
    hasSubmitted = !!attempt;
  }

  // Strip answers if not yet submitted
  const questions = quiz.questions.map((q) => ({
    id: q.id,
    order: q.order,
    question: q.question,
    options: q.options,
    ...(hasSubmitted && {
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    }),
    ...(hasSubmitted && {
      correctCount: q.correctCount,
      attemptCount: q.attemptCount,
    }),
  }));

  return NextResponse.json({
    id: quiz.id,
    podcastId: quiz.podcastId,
    status: quiz.status,
    questionCount: quiz.questions.length,
    attemptCount: quiz.attemptCount,
    avgScore: quiz.avgScore,
    hasSubmitted,
    questions,
  });
}
