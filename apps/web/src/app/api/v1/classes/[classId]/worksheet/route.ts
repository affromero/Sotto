import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { buildClassDocument } from '@/lib/class-document';
import { addJob, worksheetPdfQueue, JobType } from '@/lib/queue';

type RouteParams = { params: Promise<{ classId: string }> };

/**
 * GET /api/classes/[classId]/worksheet
 * Returns the ClassDocument render contract plus the current worksheetPdfUrl (may be null).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId: authed.userId } },
      include: {
        course: { select: { nativeLang: true, targetLang: true } },
        lesson: { select: { title: true, level: true, objective: true } },
        sections: {
          include: {
            questions: { orderBy: { order: 'asc' } },
            prompts: { orderBy: { order: 'asc' } },
            writingPrompts: { orderBy: { order: 'asc' } },
          },
        },
      },
    });

    if (!cls) return errorResponse('Class not found', 404);

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL;

    const document = await buildClassDocument(
      {
        id: cls.id,
        nativeLang: cls.course.nativeLang,
        targetLang: cls.course.targetLang,
        lesson: {
          title: cls.lesson?.title ?? '',
          level: cls.lesson?.level ?? '',
          objective: cls.lesson?.objective ?? '',
        },
        sections: cls.sections.map((s) => ({
          id: s.id,
          skill: s.skill,
          questions: s.questions.map((q) => ({
            id: q.id,
            order: q.order,
            question: q.question,
            options: q.options,
            passageRef: q.passageRef,
            passageText: q.passageText,
            correctIndex: q.correctIndex,
            explanation: q.explanation ?? '',
          })),
          prompts: s.prompts.map((p) => ({
            id: p.id,
            order: p.order,
            targetPhrase: p.targetPhrase,
            translation: p.translation,
            ipa: p.ipa,
          })),
          writingPrompts: s.writingPrompts.map((p) => ({
            id: p.id,
            order: p.order,
            task: p.task,
            guidance: p.guidance,
          })),
        })),
      },
      { isAnswerKey: false, appBaseUrl },
    );

    return NextResponse.json({ document, worksheetPdfUrl: cls.worksheetPdfUrl ?? null });
  } catch (error: unknown) {
    logger.error('Failed to load worksheet', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load worksheet', 500);
  }
}

/**
 * POST /api/classes/[classId]/worksheet
 * Enqueues a WORKSHEET_PDF job. Returns 202 immediately.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId: authed.userId } },
      select: { id: true },
    });

    if (!cls) return errorResponse('Class not found', 404);

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL;

    await addJob(worksheetPdfQueue, JobType.WORKSHEET_PDF, { classId, appBaseUrl });

    return NextResponse.json({ status: 'PENDING' }, { status: 202 });
  } catch (error: unknown) {
    logger.error('Failed to enqueue worksheet PDF job', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to enqueue worksheet PDF job', 500);
  }
}
