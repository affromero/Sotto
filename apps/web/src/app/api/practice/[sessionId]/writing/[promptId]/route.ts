import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { gradeWriting } from '@/lib/writing-grader';

type RouteParams = { params: Promise<{ sessionId: string; promptId: string }> };

const submitSchema = z.object({ text: z.string().trim().min(1).max(4000) });

/**
 * POST /api/practice/[sessionId]/writing/[promptId]
 * Submit a practice writing response; graded synchronously by the LLM.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId, promptId } = await params;
    const userId = authed.userId;

    const session = await prisma.practiceSession.findFirst({
      where: { id: sessionId, course: { userId } },
      select: { id: true },
    });
    if (!session) return errorResponse('Practice session not found', 404);

    const prompt = await prisma.writingPrompt.findFirst({
      where: { id: promptId, practiceSessionId: sessionId },
      select: {
        task: true,
        practiceSession: { select: { course: { select: { nativeLang: true, targetLang: true, currentLevel: true } } } },
      },
    });
    if (!prompt || !prompt.practiceSession) return errorResponse('Prompt not found', 404);

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid writing response', 400);

    const course = prompt.practiceSession.course;
    const grade = await gradeWriting({
      userId,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: course.currentLevel,
      task: prompt.task,
      text: parsed.data.text,
    });

    const data = {
      practiceSessionId: sessionId,
      promptId,
      userId,
      text: parsed.data.text,
      overallScore: grade.overallScore,
      corrections: grade.corrections as unknown as Prisma.InputJsonValue,
      feedback: grade.feedback,
    };
    const existing = await prisma.writingResponse.findFirst({ where: { promptId, userId }, select: { id: true } });
    if (existing) await prisma.writingResponse.update({ where: { id: existing.id }, data });
    else await prisma.writingResponse.create({ data });

    return NextResponse.json(grade);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to grade writing';
    logger.error('Failed to grade practice writing', { error: message });
    return errorResponse(message, 500);
  }
}
