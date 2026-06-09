import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { gradeWriting } from '@/lib/writing-grader';

type RouteParams = { params: Promise<{ classId: string; promptId: string }> };

const submitSchema = z.object({ text: z.string().trim().min(1).max(4000) });

/**
 * POST /api/classes/[classId]/writing/[promptId]
 * Submit a writing response; graded synchronously by the LLM. Returns the grade.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId, promptId } = await params;
    const userId = authed.userId;

    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId } },
      select: { id: true },
    });
    if (!cls) return errorResponse('Class not found', 404);

    const prompt = await prisma.writingPrompt.findFirst({
      where: { id: promptId, section: { classId } },
      select: {
        task: true,
        sectionId: true,
        section: { select: { class: { select: { course: { select: { nativeLang: true, targetLang: true, currentLevel: true } } } } } },
      },
    });
    if (!prompt || !prompt.section) return errorResponse('Prompt not found', 404);

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid writing response', 400);

    const course = prompt.section.class.course;
    const grade = await gradeWriting({
      userId,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: course.currentLevel,
      task: prompt.task,
      text: parsed.data.text,
    });

    const data = {
      sectionId: prompt.sectionId,
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
    logger.error('Failed to grade class writing', { error: message });
    return errorResponse(message, 500);
  }
}
