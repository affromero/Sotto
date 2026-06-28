import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  deleteClassForUser,
  getClassForUser,
  regenerateCurrentClass,
  regenerateFailedSections,
} from '@/lib/class-service';
import { classIntroFromSeed } from '@/lib/classes/class-intro';

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
      episode: s.episode
        ? {
            id: s.episode.id,
            audioUrl: s.episode.audioUrl,
            title: s.episode.title,
            // Sourced-class sources: surfaced for the Sources panel + citation tooltips.
            references: s.episode.references,
          }
        : null,
      questions: s.questions.map((q) => ({
        id: q.id,
        order: q.order,
        question: q.question,
        options: q.options,
        passageRef: q.passageRef,
        // Sourced-class READING passage (may carry `[N]` citation markers).
        passageText: q.passageText,
        ...(submitted ? { correctIndex: q.correctIndex, explanation: q.explanation } : {}),
      })),
      prompts: s.prompts.map((p) => ({
        id: p.id,
        order: p.order,
        targetPhrase: p.targetPhrase,
        translation: p.translation,
        ipa: p.ipa,
        referenceTtsUrl: p.referenceTtsUrl,
        latestRecording: p.recordings?.[0]
          ? {
              id: p.recordings[0].id,
              status: p.recordings[0].status,
              transcript: p.recordings[0].transcript,
              overallScore: p.recordings[0].overallScore,
              rubricScores: p.recordings[0].rubricScores,
              phonemeScores: p.recordings[0].phonemeScores,
              feedback: p.recordings[0].feedback,
            }
          : null,
      })),
      writingPrompts: s.writingPrompts.map((p) => {
        const r = p.responses[0];
        return {
          id: p.id,
          order: p.order,
          task: p.task,
          guidance: p.guidance,
          response: r
            ? {
                text: r.text,
                overallScore: r.overallScore,
                corrections: r.corrections,
                feedback: r.feedback,
              }
            : null,
        };
      }),
    }));

    const grammarPoints = Array.isArray(cls.lesson.grammarPoints)
      ? (cls.lesson.grammarPoints as string[])
      : [];
    const targetVocab = Array.isArray(cls.lesson.targetVocab)
      ? (cls.lesson.targetVocab as Array<{ lemma: string; gloss: string; pos?: string }>)
      : [];
    const intro = classIntroFromSeed(cls.adaptiveSeed, {
      level: cls.lesson.level,
      nativeLang: cls.course.nativeLang,
      targetLang: cls.course.targetLang,
      title: cls.lesson.title,
      objective: cls.lesson.objective,
      grammarPoints,
      targetVocab,
      sourceTitle: cls.sourceTitle,
    });

    return NextResponse.json({
      id: cls.id,
      courseId: cls.courseId,
      status: cls.status,
      order: cls.order,
      passThreshold: cls.passThreshold,
      // Sourced-class attribution (null for curriculum classes).
      sourceUrl: cls.sourceUrl,
      sourceTitle: cls.sourceTitle,
      lesson: {
        title: cls.lesson.title,
        level: cls.lesson.level,
        objective: cls.lesson.objective,
      },
      intro,
      vocabulary: targetVocab
        .filter((item) => typeof item.lemma === 'string' && item.lemma.trim() !== '')
        .map((item) => ({
          lemma: item.lemma,
          gloss: item.gloss,
          pos: item.pos ?? null,
        })),
      submission: cls.submission,
      submitted,
      sections,
    });
  } catch (error: unknown) {
    logger.error('Failed to load class', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load class', 500);
  }
}

/** POST /api/classes/[classId] — regenerate failed sections, or the current class with {scope:"class"}. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;
    const body = (await request.json().catch(() => ({}))) as { scope?: unknown };

    if (body.scope === 'class') {
      const ok = await regenerateCurrentClass(classId, authed.userId);
      if (!ok) return errorResponse('Class not found or already passed.', 400);
      return NextResponse.json({ regenerated: true, scope: 'class' });
    }

    const ok = await regenerateFailedSections(classId, authed.userId);
    if (!ok) return errorResponse('No failed sections to regenerate (or class not found).', 400);
    return NextResponse.json({ regenerated: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate sections';
    logger.error('Failed to regenerate sections', { error: message });
    return errorResponse(message, 500);
  }
}

/** DELETE /api/classes/[classId] — remove an owned class and clear the active-class gate. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const ok = await deleteClassForUser(classId, authed.userId);
    if (!ok) return errorResponse('Class not found', 404);
    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete class';
    logger.error('Failed to delete class', { error: message });
    return errorResponse(message, 500);
  }
}
