import { NextRequest, NextResponse } from 'next/server';
import { speakingTaskMode } from '@/lib/learning-map/evidence/communicative-speaking';
import {
  classReceiptSchema,
  classRegenerationRequestSchema,
  skillRequirementsSchema,
} from '@sotto/shared';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  PrerequisiteSourceConflict,
  readPrerequisiteSource,
} from '@/lib/classes/help/content/prerequisite-source';
import { deleteClassForUser, getClassForUser } from '@/lib/class-service';
import { PrerequisiteDeletionConflict } from '@/lib/classes/help/prerequisite-deletion';
import { SpeakingDeletionConflict } from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';
import { lessonHelpTeachingHash } from '@/lib/classes/help/lesson-source';
import { classProgressRevision } from '@/lib/learning/classes/progress/progress-revision';
import { requestClassPreparation } from '@/lib/classes/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import {
  ProviderCreditsExhaustedError,
  speechCreditsMessage,
} from '@/lib/providers/shared/speech-availability';
import { classIntroFromSeed } from '@/lib/classes/class-intro';
import { patchLearningProgress } from '@/lib/learning/progress-route';
import {
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
    const execution = sottoRequestExecution(request, authed);
    const loaded = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await execution.authorize(database);
        const cls = await getClassForUser(classId, authed.userId, database);
        if (!cls) return null;
        const requirements = skillRequirementsSchema.safeParse(cls.skillRequirements);
        let sourceHash: string | null = null;
        if (cls.teaching && (!requirements.success || requirements.data.level === 'A1')) {
          try {
            const source = await readPrerequisiteSource(database, classId, authed.userId);
            if (source.source.lesson.level === 'A1') sourceHash = source.sourceHash;
          } catch (error) {
            if (!(error instanceof PrerequisiteSourceConflict)) throw error;
          }
        }
        const progress = await classProgressRevision(database, classId, authed.userId);
        const tokenizer = createPrerequisiteTokenizer(classId, authed.userId);
        try {
          return {
            cls,
            prerequisiteSourceHash: sourceHash ? tokenizer.source(sourceHash) : null,
            taskMaterialRevision: progress.revision,
            lessonHelpRevision: cls.teaching
              ? tokenizer.helpSource(lessonHelpTeachingHash(cls.teaching))
              : null,
          };
        } finally {
          tokenizer.dispose();
        }
      },
      { signal: request.signal }
    );
    const cls = loaded?.cls;
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
      passThreshold: s.passThreshold,
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
        taskMode: speakingTaskMode(p.learningObjectives),
        id: p.id,
        order: p.order,
        targetPhrase: p.targetPhrase,
        translation: p.translation,
        ipa: p.ipa,
        referenceTtsUrl:
          p.referenceEncryption != null
            ? p.referenceTtsUrl
              ? `/api/v1/classes/${encodeURIComponent(classId)}/speaking/${encodeURIComponent(p.id)}/reference/audio`
              : null
            : p.referenceTtsUrl,
        latestRecording: p.recordings?.[0]
          ? {
              id: p.recordings[0].id,
              status: p.recordings[0].status,
              recoveryAcknowledged: p.recordings[0].gradingAcknowledgedAt != null,
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

    const storedReceipt = classReceiptSchema.safeParse(cls.submission?.receipt);
    return NextResponse.json(
      {
        ...(pristineSnapshot ? { pristineSnapshot } : {}),
        prerequisiteSourceHash: loaded?.prerequisiteSourceHash ?? null,
        taskMaterialRevision: loaded?.taskMaterialRevision ?? null,
        lessonHelpRevision: loaded?.lessonHelpRevision ?? null,
        id: cls.id,
        skillRequirements: cls.skillRequirements,
        readingVocabulary: cls.readingVocabulary,
        attempt: cls.attempt,
        learnerAnswers: cls.learnerAnswers,
        writingDrafts: cls.writingDrafts,
        writingHistory: cls.writingHistory,
        speakingHistory: cls.speakingHistory,
        speakingHistoryUnlinked: cls.speakingHistoryUnlinked,
        orphanWritingDrafts: cls.orphanWritingDrafts,
        quizHistory: cls.quizHistory,
        orphanQuizAnswers: cls.orphanQuizAnswers,
        quizSubmissionReceipts: cls.quizSubmissionReceipts,
        quizHistoryUnreadable: cls.quizHistoryUnreadable,
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
        ...(cls.teaching ? { teaching: cls.teaching } : {}),
        vocabulary: targetVocab
          .filter((item) => typeof item.lemma === 'string' && item.lemma.trim() !== '')
          .map((item) => ({
            lemma: item.lemma,
            gloss: item.gloss,
            pos: item.pos ?? null,
          })),
        submission: cls.submission
          ? {
              passed: cls.submission.passed,
              overallScore: cls.submission.overallScore,
              submittedAt: cls.submission.submittedAt,
              ...(storedReceipt.success ? { receipt: storedReceipt.data } : {}),
            }
          : null,
        submitted,
        sections,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
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
    const parsed = classRegenerationRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse('Invalid regeneration request', 400);
    const body = parsed.data;

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
            ...(body.scope === 'section'
              ? { retry: { sectionId: body.sectionId!, expectedRevision: body.expectedRevision! } }
              : {}),
          },
        }
      );
      return NextResponse.json(
        {
          started: true,
          scope: body.scope ?? 'sections',
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
    if (error instanceof ProviderCreditsExhaustedError)
      return errorResponse(speechCreditsMessage(error), 402, { code: error.code });
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

    const ok = await deleteClassForUser(
      classId,
      authed.userId,
      sottoRequestExecution(request, authed)
    );
    if (!ok) return errorResponse('Class not found', 404);
    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    if (
      error instanceof PrerequisiteDeletionConflict ||
      error instanceof SpeakingDeletionConflict ||
      error instanceof AssessmentFenceConflict
    )
      return errorResponse(error.message, 409);
    const message = error instanceof Error ? error.message : 'Failed to delete class';
    logger.error('Failed to delete class', { error: message });
    return errorResponse(message, 500);
  }
}
