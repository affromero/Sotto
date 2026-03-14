import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ podcastId: string }> };

const submitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedIndex: z.number().int().min(0).max(3),
    }),
  ).min(1),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body', 400);
  }

  const quiz = await prisma.podcastQuiz.findUnique({
    where: { podcastId },
    include: { questions: true },
  });

  if (!quiz || quiz.status !== 'READY') {
    return errorResponse('Quiz not found', 404);
  }

  // No retakes
  const existing = await prisma.quizAttempt.findUnique({
    where: { userId_quizId: { userId: authResult.userId, quizId: quiz.id } },
  });
  if (existing) {
    return errorResponse('Already submitted', 409);
  }

  // Build a map of question ID -> correct index
  const questionMap = new Map(quiz.questions.map((q) => [q.id, q]));

  // Score
  let score = 0;
  const answerData: Array<{
    questionId: string;
    selectedIndex: number;
    isCorrect: boolean;
  }> = [];

  for (const answer of parsed.data.answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;
    const isCorrect = answer.selectedIndex === question.correctIndex;
    if (isCorrect) score++;
    answerData.push({
      questionId: answer.questionId,
      selectedIndex: answer.selectedIndex,
      isCorrect,
    });
  }

  const total = quiz.questions.length;

  // Create attempt + answers + update aggregates in a transaction
  const attempt = await prisma.$transaction(async (tx) => {
    const att = await tx.quizAttempt.create({
      data: {
        userId: authResult.userId,
        quizId: quiz.id,
        score,
        total,
        completedAt: new Date(),
      },
    });

    await Promise.all(
      answerData.map((a) =>
        tx.quizAnswer.create({
          data: {
            attemptId: att.id,
            questionId: a.questionId,
            selectedIndex: a.selectedIndex,
            isCorrect: a.isCorrect,
          },
        }),
      ),
    );

    // Update per-question stats
    await Promise.all(
      answerData.map((a) =>
        tx.quizQuestion.update({
          where: { id: a.questionId },
          data: {
            attemptCount: { increment: 1 },
            ...(a.isCorrect && { correctCount: { increment: 1 } }),
          },
        }),
      ),
    );

    // Update quiz aggregate
    const newAttemptCount = quiz.attemptCount + 1;
    const newAvgScore =
      (quiz.avgScore * quiz.attemptCount + (score / total) * 100) / newAttemptCount;

    await tx.podcastQuiz.update({
      where: { id: quiz.id },
      data: {
        attemptCount: newAttemptCount,
        avgScore: Math.round(newAvgScore * 10) / 10,
      },
    });

    return att;
  });

  // Return results with correct answers
  const results = quiz.questions
    .sort((a, b) => a.order - b.order)
    .map((q) => {
      const userAnswer = answerData.find((a) => a.questionId === q.id);
      return {
        id: q.id,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        selectedIndex: userAnswer?.selectedIndex ?? null,
        isCorrect: userAnswer?.isCorrect ?? false,
      };
    });

  return NextResponse.json({
    attemptId: attempt.id,
    score,
    total,
    percentage: Math.round((score / total) * 100),
    results,
  });
}
