import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  placementConfirmRequestSchema,
  placementSubmitRequestSchema,
  type PlacementConfirmRequest,
  type PlacementSubmitRequest,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { createInitialCourse } from '@/lib/placement-course';
import { attachCourseMaterials } from '@/lib/course-materials';
import { scorePlacement } from '@/lib/placement-test';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { MaterialAnalysisConflict } from '@/lib/course-materials/analysis/inventory';
import { readPlacementAnalysis } from './analysis';
import { requirePlacementSession, decodePlacementQuestions } from './journal';

type PlacementIntent =
  | { kind: 'SOURCE'; input: PlacementConfirmRequest }
  | { kind: 'QUIZ'; input: PlacementSubmitRequest };
const responseSchema = z
  .object({
    courseId: z.string().min(1),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
    confirmationReceiptId: z.uuid(),
    assessedLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
    scoreBySkill: z.record(z.string(), z.number().min(0).max(1)).optional(),
    addedVocabulary: z.number().int().nonnegative().optional(),
  })
  .strict();
function digest(intent: PlacementIntent) {
  const { requestId, schemaVersion, ...body } = intent.input;
  if (!requestId || schemaVersion !== 1)
    throw new MaterialAnalysisConflict('A versioned confirmation request ID is required.', 400);
  return learningProviderInputHash({
    kind: intent.kind,
    ...body,
    ...(intent.kind === 'QUIZ'
      ? {
          answers: [...intent.input.answers].sort((left, right) =>
            left.id < right.id ? -1 : left.id > right.id ? 1 : 0
          ),
        }
      : {}),
  });
}
async function replay(
  database: Prisma.TransactionClient,
  userId: string,
  requestId: string,
  intentDigest: string
) {
  const receipt = await database.placementConfirmationReceipt.findUnique({
    where: { userId_requestId: { userId, requestId } },
  });
  if (!receipt) return null;
  if (receipt.intentDigest !== intentDigest)
    throw new MaterialAnalysisConflict(
      'This request ID already confirmed different placement inputs.'
    );
  return responseSchema.parse(receipt.response);
}
async function inspect(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  intent: PlacementIntent
) {
  const input = intent.input,
    analysis =
      input.analysisId && input.analysisRevision && input.resultDigest
        ? await readPlacementAnalysis(database, {
            userId: execution.userId,
            native: input.native,
            target: input.target,
            reference: {
              analysisId: input.analysisId,
              analysisRevision: input.analysisRevision,
              resultDigest: input.resultDigest,
            },
            acceptPartial: input.acceptPartial,
          })
        : null;
  if (intent.kind === 'SOURCE') {
    if (!analysis?.result.inference)
      throw new MaterialAnalysisConflict(
        'The sources do not support a starting-level suggestion. Choose a manual level or take a diagnostic.',
        422
      );
    return { analysis, session: null, outcome: null, level: analysis.result.inference.level };
  }
  const session = await requirePlacementSession(database, {
    userId: execution.userId,
    placementSessionId: intent.input.placementSessionId,
    execution,
  });
  if (
    session.row.nativeLang !== input.native ||
    session.row.targetLang !== input.target ||
    session.row.questionsDigest !== intent.input.questionsDigest ||
    session.row.analysisId !== input.analysisId ||
    session.row.analysisRevision !== input.analysisRevision ||
    session.row.analysisDigest !== input.resultDigest
  )
    throw new MaterialAnalysisConflict(
      'The placement questions or source analysis identity changed.'
    );
  if (
    !['READY', 'ACCEPTED'].includes(session.row.status) ||
    session.row.expiresAt.getTime() <= Date.now()
  )
    throw new MaterialAnalysisConflict('This placement session is not ready or has expired.');
  const questions = decodePlacementQuestions(session.row),
    ids = new Set(questions.map((question) => question.id));
  if (
    intent.input.answers.length !== questions.length ||
    intent.input.answers.some((answer) => !ids.has(answer.id))
  )
    throw new MaterialAnalysisConflict(
      'Submit exactly one answer for every preserved placement question.',
      400
    );
  const outcome = scorePlacement(questions, intent.input.answers);
  return { analysis, session, outcome, level: outcome.level };
}

/** Caller-owned Serializable transaction commits acceptance, attachments, initial band and replay receipt once. */
export async function acceptPlacementInTransaction(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  intent: PlacementIntent,
  curriculumId: string
) {
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId)
    throw new MaterialAnalysisConflict('The placement recipient changed.');
  await database.$queryRaw`SELECT id FROM "User" WHERE id = ${execution.userId} FOR UPDATE`;
  const intentDigest = digest(intent),
    prior = await replay(database, execution.userId, intent.input.requestId, intentDigest);
  if (prior) return prior;
  const state = await inspect(database, execution, intent);
  for (const acceptedId of [
    state.analysis?.row.acceptedReceiptId,
    state.session?.row.acceptedReceiptId,
  ]) {
    if (!acceptedId) continue;
    const accepted = await database.placementConfirmationReceipt.findFirst({
      where: { id: acceptedId, userId: execution.userId },
    });
    if (!accepted || accepted.intentDigest !== intentDigest)
      throw new MaterialAnalysisConflict(
        'These placement sources or questions were already accepted with another decision.'
      );
    return responseSchema.parse(accepted.response);
  }
  const course = await createInitialCourse(
    database,
    {
      userId: execution.userId,
      native: intent.input.native,
      target: intent.input.target,
      curriculumId,
      level: state.level,
      source: intent.kind === 'SOURCE' ? 'NOTES' : state.analysis ? 'NOTES_VERIFIED' : 'TEST',
    },
    execution
  );
  if (state.analysis) {
    if (
      (state.analysis.row.intendedCourseId && state.analysis.row.intendedCourseId !== course.id) ||
      (state.analysis.row.attachedCourseId && state.analysis.row.attachedCourseId !== course.id)
    )
      throw new MaterialAnalysisConflict('This analysis belongs to another course.');
    await attachCourseMaterials(
      database,
      execution.userId,
      course.id,
      state.analysis.sources.flatMap((source) => (source.materialId ? [source.materialId] : []))
    );
  }
  if (state.outcome)
    await database.placementResult.upsert({
      where: { courseId: course.id },
      create: {
        courseId: course.id,
        level: state.outcome.level,
        responses: state.outcome.responses,
        scoreBySkill: state.outcome.scoreBySkill,
      },
      update: {
        level: state.outcome.level,
        responses: state.outcome.responses,
        scoreBySkill: state.outcome.scoreBySkill,
      },
    });
  const id = randomUUID(),
    response = responseSchema.parse({
      courseId: course.id,
      level: course.currentLevel,
      confirmationReceiptId: id,
      ...(state.outcome
        ? { assessedLevel: state.outcome.level, scoreBySkill: state.outcome.scoreBySkill }
        : { addedVocabulary: 0 }),
    });
  await database.placementConfirmationReceipt.create({
    data: {
      id,
      userId: execution.userId,
      requestId: intent.input.requestId,
      courseId: course.id,
      analysisId: state.analysis?.row.id ?? null,
      sessionId: state.session?.row.id ?? null,
      intentDigest,
      response,
    },
  });
  if (state.analysis)
    await database.materialAnalysis.update({
      where: { id: state.analysis.row.id },
      data: { attachedCourseId: course.id, acceptedReceiptId: id },
    });
  if (state.session)
    await database.placementSession.update({
      where: { id: state.session.row.id },
      data: { status: 'ACCEPTED', acceptedReceiptId: id },
    });
  return response;
}

async function confirm(execution: SottoProviderExecution, intent: PlacementIntent) {
  const preflight = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new MaterialAnalysisConflict('The placement recipient changed.');
      const prior = await replay(
        database,
        execution.userId,
        intent.input.requestId,
        digest(intent)
      );
      if (prior) return { prior, curriculumId: null };
      await inspect(database, execution, intent);
      const course = await database.course.findUnique({
        where: {
          userId_nativeLang_targetLang: {
            userId: execution.userId,
            nativeLang: intent.input.native,
            targetLang: intent.input.target,
          },
        },
        select: { curriculumId: true },
      });
      return { prior: null, curriculumId: course?.curriculumId ?? null };
    },
    { signal: execution.signal }
  );
  if (preflight.prior) return preflight.prior;
  const curriculumId =
    preflight.curriculumId ??
    (
      await getOrCreateCurriculum(
        execution.userId,
        execution,
        intent.input.native,
        intent.input.target
      )
    ).id;
  return sottoTransaction(
    prismaUnfiltered,
    (database) => acceptPlacementInTransaction(database, execution, intent, curriculumId),
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
export async function confirmSourcePlacement(execution: SottoProviderExecution, input: unknown) {
  return confirm(execution, { kind: 'SOURCE', input: placementConfirmRequestSchema.parse(input) });
}
export async function submitPlacementSession(execution: SottoProviderExecution, input: unknown) {
  return confirm(execution, { kind: 'QUIZ', input: placementSubmitRequestSchema.parse(input) });
}
