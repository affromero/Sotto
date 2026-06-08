import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getClassForUser, regenerateFailedSections } from '@/lib/class-service';

type RouteParams = { params: Promise<{ classId: string }> };

/** GET /api/classes/[classId] — class with sections + questions (answers stripped until submitted). */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const cls = await getClassForUser(classId, authed.userId);
    if (!cls) return errorResponse('Class not found', 404);

    const submitted = cls.submission !== null;
    const sections = cls.sections.map((s) => ({
      id: s.id,
      skill: s.skill,
      status: s.status,
      attempt: s.attempt,
      score: s.score,
      passed: s.passed,
      questions: s.questions.map((q) => ({
        id: q.id,
        order: q.order,
        question: q.question,
        options: q.options,
        passageRef: q.passageRef,
        ...(submitted ? { correctIndex: q.correctIndex, explanation: q.explanation } : {}),
      })),
      prompts: s.prompts.map((p) => ({
        id: p.id,
        order: p.order,
        targetPhrase: p.targetPhrase,
        translation: p.translation,
        ipa: p.ipa,
        referenceTtsUrl: p.referenceTtsUrl,
      })),
    }));

    return NextResponse.json({
      id: cls.id,
      status: cls.status,
      order: cls.order,
      passThreshold: cls.passThreshold,
      lesson: cls.lesson,
      submission: cls.submission,
      submitted,
      sections,
    });
  } catch (error: unknown) {
    logger.error('Failed to load class', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to load class', 500);
  }
}

/** POST /api/classes/[classId] — regenerate failed sections in a fresh form (retry). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const ok = await regenerateFailedSections(classId, authed.userId);
    if (!ok) return errorResponse('No failed sections to regenerate (or class not found).', 400);
    return NextResponse.json({ regenerated: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate sections';
    logger.error('Failed to regenerate sections', { error: message });
    return errorResponse(message, 500);
  }
}
