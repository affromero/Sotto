import { randomUUID } from 'node:crypto';
import {
  placementGenerateRequestSchema,
  placementSessionPublicSchema,
  type PlacementGenerateRequest,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { enqueueDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import { captureMaterialAnalysisPolicy } from '@/lib/course-materials/analysis/policy';
import {
  MaterialAnalysisConflict,
  materialAnalysisBytesHash,
} from '@/lib/course-materials/analysis/inventory';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import {
  preparePlacementQuestionBatch,
  toPublic,
  PLACEMENT_SCORING_VERSION,
} from '@/lib/placement-test';
import { readPlacementAnalysis } from './analysis';
import {
  createPlacementSessionGrant,
  readOwnedPlacementSession,
  decodePlacementQuestions,
  placementInputSchema,
} from './journal';

export const placementGenerationPayload = (userId: string, placementSessionId: string) => ({
  userId,
  placementSessionId,
});
const reference = (input: PlacementGenerateRequest) =>
  input.analysisId && input.analysisRevision && input.resultDigest
    ? {
        analysisId: input.analysisId,
        analysisRevision: input.analysisRevision,
        resultDigest: input.resultDigest,
      }
    : null;
const semantic = (input: PlacementGenerateRequest) =>
  learningProviderInputHash({
    version: 1,
    native: input.native,
    target: input.target,
    analysis: reference(input),
    perBand: input.analysisId ? 2 : 4,
    scoringVersion: PLACEMENT_SCORING_VERSION,
  });

export async function readPlacementSessionStatus(
  database: Prisma.TransactionClient,
  input: { userId: string; placementSessionId: string }
) {
  const saved = await readOwnedPlacementSession(database, input),
    row = saved.row;
  const ready = ['READY', 'ACCEPTED'].includes(row.status);
  const expired = row.status !== 'ACCEPTED' && row.expiresAt.getTime() <= Date.now();
  return placementSessionPublicSchema.parse({
    native: row.nativeLang,
    target: row.targetLang,
    placementSessionId: row.id,
    status:
      expired && !['RECOVERY_REQUIRED', 'DISPATCHING', 'GENERATING'].includes(row.status)
        ? 'EXPIRED'
        : row.status,
    questionsDigest: row.questionsDigest,
    analysisId: row.analysisId,
    analysisRevision: row.analysisRevision,
    resultDigest: row.analysisDigest,
    expiresAt: row.expiresAt.toISOString(),
    failureReason: row.failureReason,
    questions: ready && !expired ? decodePlacementQuestions(row).map(toPublic) : [],
  });
}

/** Admission owns the request ID before queueing. An equivalent unsettled quiz cannot consume another paid call. */
export async function requestPlacementSession(
  execution: SottoProviderExecution,
  requestInput: unknown
) {
  const input = placementGenerateRequestSchema.parse(requestInput),
    semanticDigest = semantic(input);
  const replay = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new MaterialAnalysisConflict('The placement recipient changed.');
      const prior = await database.placementSession.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId: input.requestId } },
      });
      if (prior && prior.semanticDigest !== semanticDigest)
        throw new MaterialAnalysisConflict('This request ID belongs to another placement quiz.');
      return prior
        ? readPlacementSessionStatus(database, {
            userId: execution.userId,
            placementSessionId: prior.id,
          })
        : null;
    },
    { signal: execution.signal }
  );
  if (replay) return replay;
  const { policy } = await captureMaterialAnalysisPolicy(execution);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new MaterialAnalysisConflict('The placement recipient changed.');
      await database.$queryRaw`SELECT id FROM "User" WHERE id = ${execution.userId} FOR UPDATE`;
      const user = await database.user.findUniqueOrThrow({
        where: { id: execution.userId },
        select: { createdAt: true },
      });
      const prior = await database.placementSession.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId: input.requestId } },
      });
      if (prior) {
        if (prior.semanticDigest !== semanticDigest)
          throw new MaterialAnalysisConflict('This request ID belongs to another placement quiz.');
        return readPlacementSessionStatus(database, {
          userId: execution.userId,
          placementSessionId: prior.id,
        });
      }
      const unresolved = await database.placementSession.findFirst({
        where: {
          userId: execution.userId,
          semanticDigest,
          OR: [
            { status: { in: ['RECOVERY_REQUIRED', 'DISPATCHING', 'GENERATING'] } },
            { status: { in: ['QUEUED', 'SUCCEEDED', 'READY'] }, expiresAt: { gt: new Date() } },
          ],
        },
      });
      if (unresolved)
        throw new MaterialAnalysisConflict(
          `Resume placement session ${unresolved.id}. An equivalent quiz is already retained or requires explicit recovery.`
        );
      const source = reference(input);
      const analysis = source
        ? await readPlacementAnalysis(database, {
            userId: execution.userId,
            native: input.native,
            target: input.target,
            reference: source,
            acceptPartial: input.acceptPartial,
          })
        : null;
      const note = analysis?.result.inference
        ? `An immutable analysis of the learner's materials suggests ${analysis.result.inference.level}. This describes source difficulty, not learner proficiency. The independently answered diagnostic must cover every CEFR band.`
        : '';
      const prepared = preparePlacementQuestionBatch(
        input.native,
        input.target,
        note,
        source ? 2 : 4
      );
      const frozen = placementInputSchema.parse({
        system: prepared.system,
        messagesJson: JSON.stringify(prepared.messages),
        jsonSchemaJson: JSON.stringify(prepared.jsonSchema),
        maxOutputTokens: policy.maxOutputTokens,
        perBand: prepared.perBand,
        scoringVersion: PLACEMENT_SCORING_VERSION,
        analysisId: source?.analysisId ?? null,
        analysisRevision: source?.analysisRevision ?? null,
        resultDigest: source?.resultDigest ?? null,
      });
      const id = randomUUID(),
        inputDigest = learningProviderInputHash({
          userId: execution.userId,
          userGeneration: user.createdAt.getTime(),
          native: input.native,
          target: input.target,
          policy,
          input: frozen,
        });
      await database.placementSession.create({
        data: {
          id,
          userId: execution.userId,
          userGeneration: BigInt(user.createdAt.getTime()),
          nativeLang: input.native,
          targetLang: input.target,
          requestId: input.requestId,
          semanticDigest,
          policy,
          input: frozen,
          inputDigest,
          mode: policy.cliBinding ? 'CLI' : 'HTTP',
          grant: {},
          status: 'QUEUED',
          analysisId: source?.analysisId ?? null,
          analysisRevision: source?.analysisRevision ?? null,
          analysisDigest: source?.resultDigest ?? null,
          questionsBytes: new Uint8Array(),
          questionsDigest: materialAnalysisBytesHash(new Uint8Array()),
          scoringVersion: PLACEMENT_SCORING_VERSION,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await createPlacementSessionGrant(database, {
        userId: execution.userId,
        placementSessionId: id,
        execution,
      });
      await enqueueDurableQueueJob(database, {
        handler: 'placement-generation',
        type: 'generate_placement_session',
        payload: placementGenerationPayload(execution.userId, id),
        jobId: `placement-generation-${id}`,
        attempts: 2,
      });
      return readPlacementSessionStatus(database, {
        userId: execution.userId,
        placementSessionId: id,
      });
    },
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
