import { NextRequest, NextResponse } from 'next/server';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { deleteClassForUser, getClassForUser } from '@/lib/class-service';
import { requestClassPreparation } from '@/lib/classes/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import { classIntroFromSeed } from '@/lib/classes/class-intro';
import { z } from 'zod';
import { patchLearningProgress } from '@/lib/learning/progress-route';
import {
  pristineSnapshotSchema,
  PristineRegenerationConflict,
  readPristineRegenerationSnapshot,
  validatePristineRegeneration,
} from '@/lib/classes/regeneration/pristine';

type RouteParams = { params: Promise<{ classId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return patchLearningProgress(request, 'CLASS', (await params).classId);
}

/** GET /api/classes/[classId]: owned practice class with immediate answer feedback. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const pristineSnapshot =
      request.nextUrl.searchParams.get('pristineSnapshot') === '1'
        ? await readPristineRegenerationSnapshot(classId, sottoRequestExecution(request, authed))
        : undefined;
    const cls = await getClassForUser(classId, authed.userId);
    if (!cls) return errorResponse('Class not found', 404);
    if (pristineSnapshot)
      await validatePristineRegeneration(
        classId,
        sottoRequestExecution(request, authed),
        pristineSnapshot
      );

    const submitted =
      cls.submission !== null && (cls.status === 'PASSED' || cls.status === 'FAILED');
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
            status: s.episode.status,
            title: s.episode.title,
            failureReason: s.episode.failureReason,
            technicalError: s.episode.technicalError,
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
        correctIndex: q.correctIndex,
        explanation: q.explanation,
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
          ideas: p.ideas,
          savedDraft: (cls.writingDrafts as Record<string, string> | null)?.[p.id] ?? r?.text,
          response:
            r && r.overallScore !== null
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
      ...(pristineSnapshot ? { pristineSnapshot } : {}),
      id: cls.id,
      skillRequirements: cls.skillRequirements,
      readingVocabulary: cls.readingVocabulary,
      attempt: cls.attempt,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
      progressRevision: cls.progressRevision,
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
    if (error instanceof PristineRegenerationConflict || error instanceof PreparationConflictError)
      return errorResponse(error.message, 409);
    logger.error('Failed to load class', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load class', 500);
  }
}

/** Admit durable repair, or full regeneration with {scope:"class"}. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;
    const parsed = z
      .object({
        scope: z.enum(['class', 'sections']).optional(),
        pristineSnapshot: pristineSnapshotSchema.optional(),
        expectedAttempt: z.number().int().positive(),
      })
      .safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse('Invalid regeneration request', 400);
    const body = parsed.data;
    if (body.pristineSnapshot && body.scope !== 'class')
      return errorResponse('Pristine regeneration requires class scope', 400);

    {
      const cls = await prisma.courseClass.findFirst({
        where: { id: classId, course: { userId: authed.userId } },
        select: { courseId: true, status: true },
      });
      if (!cls || cls.status === 'PASSED')
        return errorResponse('Class not found or already passed.', 400);
      const operation = await requestClassPreparation(
        cls.courseId,
        sottoRequestExecution(request, authed),
        {
          intent: {
            kind: body.scope === 'class' ? 'REGENERATE' : 'REPAIR',
            classId,
            expectedAttempt: body.expectedAttempt,
            ...(body.pristineSnapshot ? { pristineSnapshot: body.pristineSnapshot } : {}),
          },
        }
      );
      return NextResponse.json(
        {
          started: true,
          scope: body.scope === 'class' ? 'class' : 'sections',
          status: 'GENERATING',
          operationId: operation.id,
          courseId: cls.courseId,
        },
        { status: 202 }
      );
    }
  } catch (error: unknown) {
    if (error instanceof PristineRegenerationConflict || error instanceof PreparationConflictError)
      return errorResponse(error.message, 409);
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
