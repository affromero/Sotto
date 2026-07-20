import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { gradeWriting } from '@/lib/writing-grader';

type RouteParams = { params: Promise<{ examId: string; promptId: string }> };

const submitSchema = z.object({ text: z.string().trim().min(1).max(4000) });

/**
 * POST /api/exams/[examId]/writing/[promptId] — submit an exam writing response,
 * graded synchronously by the LLM (reuses WritingResponse, keyed by examSectionId).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { examId, promptId } = await params;
    const userId = authed.userId;

    const exam = await prisma.mockExam.findFirst({
      where: { id: examId, userId },
      select: { id: true },
    });
    if (!exam) return errorResponse('Exam not found', 404);

    const prompt = await prisma.writingPrompt.findFirst({
      where: { id: promptId, examSection: { examId } },
      select: {
        task: true,
        examSectionId: true,
        examSection: {
          select: {
            exam: {
              select: { level: true, course: { select: { nativeLang: true, targetLang: true } } },
            },
          },
        },
      },
    });
    if (!prompt || !prompt.examSection) return errorResponse('Prompt not found', 404);

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid writing response', 400);

    const { exam: examCtx } = prompt.examSection;
    const grade = await gradeWriting({
      userId,
      nativeLang: examCtx.course.nativeLang,
      targetLang: examCtx.course.targetLang,
      level: examCtx.level,
      task: prompt.task,
      text: parsed.data.text,
    });

    const data = {
      examSectionId: prompt.examSectionId,
      promptId,
      userId,
      text: parsed.data.text,
      overallScore: grade.overallScore,
      corrections: grade.corrections as unknown as Prisma.InputJsonValue,
      feedback: grade.feedback,
    };
    const existing = await prisma.writingResponse.findFirst({
      where: { promptId, userId },
      select: { id: true },
    });
    if (existing) await prisma.writingResponse.update({ where: { id: existing.id }, data });
    else await prisma.writingResponse.create({ data });

    return NextResponse.json(grade);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to grade writing';
    logger.error('Failed to grade exam writing', { error: message });
    return errorResponse(message, 500);
  }
}
