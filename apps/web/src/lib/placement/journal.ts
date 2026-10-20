import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DelegationStore,
  delegationGrantSchema,
  delegationGrantBinding,
  delegationAttemptInputSchema,
} from 'thesidedoor-core/runtime/delegation';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { validateSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { materialAnalysisPolicySchema } from '@/lib/course-materials/analysis/policy';
import {
  MaterialAnalysisConflict,
  materialAnalysisBytesHash,
} from '@/lib/course-materials/analysis/inventory';
import type { LearningCliReceipt } from '@/lib/learning/preparation/provider-invocation';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import {
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from '@/lib/learning/preparation/preparation-provider';
import { placementPrivateQuestionSchema, PLACEMENT_SCORING_VERSION } from '@/lib/placement-test';
import { readPlacementAnalysis } from './analysis';

const limit = 512 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const placementInputSchema = z
  .object({
    system: z.string().max(200000),
    messagesJson: z.string().max(200000),
    jsonSchemaJson: z.string().max(200000),
    maxOutputTokens: z.number().int().min(256).max(32768),
    perBand: z.number().int().min(1).max(4),
    scoringVersion: z.literal(PLACEMENT_SCORING_VERSION),
    analysisId: z.uuid().nullable(),
    analysisRevision: z.number().int().positive().nullable(),
    resultDigest: sha.nullable(),
  })
  .strict();
const metadataSchema = z
  .object({
    status: z.number().int().min(200).max(599),
    statusText: z.string().max(2000),
    headers: z.array(z.tuple([z.string(), z.string()])).max(100),
  })
  .strict();
const count = z.number().finite().nonnegative().nullable();
const cliSchema = z
  .object({
    content: z.string(),
    model: z.string().min(1),
    inputTokens: count,
    outputTokens: count,
    cachedInputTokens: count.optional(),
    cacheWriteTokens: count.optional(),
    reasoningTokens: count.optional(),
  })
  .strict();
export interface PlacementAuthority {
  userId: string;
  placementSessionId: string;
  execution: SottoProviderExecution;
}

export async function readOwnedPlacementSession(
  database: Prisma.TransactionClient,
  input: { userId: string; placementSessionId: string }
) {
  const row = await database.placementSession.findFirst({
    where: { id: input.placementSessionId, userId: input.userId },
  });
  if (!row) throw new MaterialAnalysisConflict('Placement session not found.', 404);
  const owner = await database.user.findUnique({
    where: { id: input.userId },
    select: { createdAt: true },
  });
  if (!owner || BigInt(owner.createdAt.getTime()) !== row.userGeneration)
    throw new MaterialAnalysisConflict('The placement recipient generation changed.');
  const policy = materialAnalysisPolicySchema.parse(row.policy),
    prepared = placementInputSchema.parse(row.input);
  if (
    row.scoringVersion !== PLACEMENT_SCORING_VERSION ||
    prepared.analysisId !== row.analysisId ||
    prepared.analysisRevision !== row.analysisRevision ||
    prepared.resultDigest !== row.analysisDigest ||
    prepared.maxOutputTokens > policy.maxOutputTokens ||
    learningProviderInputHash({
      userId: row.userId,
      userGeneration: Number(row.userGeneration),
      native: row.nativeLang,
      target: row.targetLang,
      policy,
      input: prepared,
    }) !== row.inputDigest ||
    row.mode !== (policy.cliBinding ? 'CLI' : 'HTTP')
  )
    throw new MaterialAnalysisConflict('The immutable placement generation identity changed.');
  if (row.analysisId && row.analysisRevision && row.analysisDigest)
    await readPlacementAnalysis(database, {
      userId: row.userId,
      native: row.nativeLang,
      target: row.targetLang,
      reference: {
        analysisId: row.analysisId,
        analysisRevision: row.analysisRevision,
        resultDigest: row.analysisDigest,
      },
      acceptPartial: true,
    });
  const grant = delegationGrantSchema.parse(row.grant),
    instance = await sottoStorageInstance(database).read();
  if (
    grant.id !== row.id ||
    grant.operationId !== row.id ||
    grant.instanceId !== instance.instanceId ||
    grant.maxRequests !== 1 ||
    grant.subject.id !== `profile:${row.userId}` ||
    BigInt(grant.subject.generation) !== row.userGeneration ||
    grant.resource.id !== `placement-session:${row.id}` ||
    grant.resource.generation !== row.createdAt.getTime() ||
    grant.action !== `placement-session:${row.inputDigest}` ||
    grant.expiresAt !== row.expiresAt.getTime()
  )
    throw new MaterialAnalysisConflict('The placement invocation delegation changed.');
  return { row, policy, input: prepared, grant };
}
export async function requirePlacementSession(
  database: Prisma.TransactionClient,
  context: PlacementAuthority
) {
  const actor = await context.execution.authorize(database);
  if (actor.userId !== context.userId || context.execution.userId !== context.userId)
    throw new MaterialAnalysisConflict('The placement actor changed.');
  await database.$queryRaw`SELECT id FROM "PlacementSession" WHERE id = ${context.placementSessionId} FOR UPDATE`;
  return readOwnedPlacementSession(database, context);
}
function store(database: Prisma.TransactionClient, context: PlacementAuthority) {
  return new DelegationStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      `${SIDEDOOR_STATE_ID}:placement-session-grant:${context.placementSessionId}`
    ),
    authorize: async ({ grant }) => {
      const saved = await requirePlacementSession(database, context);
      if (learningProviderInputHash(saved.grant) !== learningProviderInputHash(grant))
        throw new MaterialAnalysisConflict('The placement delegation changed.');
    },
  });
}
export async function createPlacementSessionGrant(
  database: Prisma.TransactionClient,
  context: PlacementAuthority
) {
  const row = await database.placementSession.findUniqueOrThrow({
    where: { id: context.placementSessionId },
  });
  const instance = await sottoStorageInstance(database).read();
  const grant = {
    id: row.id,
    revision: randomUUID(),
    instanceId: instance.instanceId,
    subject: { id: `profile:${row.userId}`, generation: Number(row.userGeneration) },
    resource: { id: `placement-session:${row.id}`, generation: row.createdAt.getTime() },
    operationId: row.id,
    action: `placement-session:${row.inputDigest}`,
    expiresAt: row.expiresAt.getTime(),
    maxRequests: 1,
  };
  await database.placementSession.update({ where: { id: row.id }, data: { grant } });
  await store(database, context).create(grant);
}
async function admit(
  database: Prisma.TransactionClient,
  context: PlacementAuthority,
  ai: CapturedLearningAi,
  attemptInput: { id: string; fingerprint: string }
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput),
    saved = await requirePlacementSession(database, context);
  if (!['QUEUED', 'GENERATING'].includes(saved.row.status)) return { dispatch: false };
  if (saved.row.expiresAt.getTime() <= Date.now())
    throw new MaterialAnalysisConflict('Placement session expired.');
  if (
    ai.provider !== saved.policy.selection.provider ||
    ai.model !== saved.policy.selection.model ||
    (ai.endpoint ?? null) !== (saved.policy.selection.endpoint ?? null) ||
    learningCredentialFingerprint(ai.execution.credential) !==
      saved.policy.selection.credentialFingerprint
  )
    throw new MaterialAnalysisConflict('The selected placement provider changed.');
  if (ai.execution.credential)
    await validateSottoExecutionCredential(
      database,
      context.execution.authorize,
      ai.execution.credential,
      context.execution.signal
    );
  if (
    saved.row.mode === 'CLI' &&
    attempt.fingerprint !==
      learningProviderInputHash({
        inputDigest: saved.row.inputDigest,
        selection: saved.policy.selection,
        binding: saved.policy.cliBinding,
      })
  )
    throw new MaterialAnalysisConflict('The placement CLI invocation changed.');
  const admitted = await store(database, context).admit(
    delegationGrantBinding(saved.grant),
    attempt
  );
  if (!admitted.dispatch)
    throw new MaterialAnalysisConflict(
      'The placement request already consumed its one invocation.'
    );
  await database.placementSession.update({
    where: { id: saved.row.id },
    data: {
      status: 'DISPATCHING',
      attemptId: attempt.id,
      attemptFingerprint: attempt.fingerprint,
      admittedAt: new Date(),
    },
  });
  return { dispatch: true };
}
async function settle(
  database: Prisma.TransactionClient,
  context: PlacementAuthority,
  attemptInput: { id: string; fingerprint: string },
  outcome: 'succeeded' | 'failed' | 'unknown',
  receipt?: LearningPreparationResponseReceipt | LearningCliReceipt
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput),
    saved = await requirePlacementSession(database, context);
  if (saved.row.attemptId !== attempt.id || saved.row.attemptFingerprint !== attempt.fingerprint)
    throw new MaterialAnalysisConflict('The placement response belongs to another invocation.');
  if ((outcome === 'succeeded' && !receipt) || (outcome === 'unknown' && receipt))
    throw new MaterialAnalysisConflict('The placement outcome has no matching receipt.');
  let bytes: Buffer | undefined, metadata: Prisma.InputJsonObject | undefined;
  if (receipt && saved.row.mode === 'HTTP') {
    if (!('bodyBase64' in receipt))
      throw new MaterialAnalysisConflict('The placement response channel changed.');
    restoreLearningPreparationResponse(receipt);
    if ((receipt.status >= 200 && receipt.status < 300) !== (outcome === 'succeeded'))
      throw new MaterialAnalysisConflict('The placement response status changed its outcome.');
    bytes = Buffer.from(receipt.bodyBase64, 'base64');
    metadata = metadataSchema.parse({
      status: receipt.status,
      statusText: receipt.statusText,
      headers: receipt.headers,
    });
  } else if (receipt) {
    if (
      !('binding' in receipt) ||
      receipt.inputDigest !== saved.row.inputDigest ||
      receipt.attempt.id !== attempt.id ||
      receipt.attempt.fingerprint !== attempt.fingerprint ||
      learningProviderInputHash(receipt.binding) !==
        learningProviderInputHash(saved.policy.cliBinding)
    )
      throw new MaterialAnalysisConflict('The placement CLI receipt identity changed.');
    const response = cliSchema.parse(receipt.response);
    if (response.model !== saved.policy.selection.model)
      throw new MaterialAnalysisConflict('The placement response model changed.');
    bytes = Buffer.from(JSON.stringify(response), 'utf8');
    metadata = { schemaVersion: 1 };
  }
  if (
    bytes &&
    (bytes.length > limit || Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 32 * 1024)
  )
    throw new MaterialAnalysisConflict('The placement response exceeds its receipt budget.');
  const status = outcome === 'unknown' ? 'RECOVERY_REQUIRED' : outcome.toUpperCase();
  if (saved.row.status !== 'DISPATCHING') {
    if (
      saved.row.status !== status ||
      !!saved.row.responseBytes !== !!bytes ||
      (bytes &&
        (materialAnalysisBytesHash(bytes) !== saved.row.responseSha256 ||
          learningProviderInputHash(metadata) !==
            learningProviderInputHash(saved.row.responseMetadata)))
    )
      throw new MaterialAnalysisConflict('A settled placement invocation cannot change.');
    return;
  }
  await store(database, context).settle(delegationGrantBinding(saved.grant), attempt, outcome);
  await database.placementSession.update({
    where: { id: saved.row.id },
    data: {
      status,
      settledAt: new Date(),
      failureReason:
        outcome === 'unknown'
          ? 'The provider outcome is unknown. Explicit recovery is required before another equivalent quiz.'
          : outcome === 'failed'
            ? 'The placement provider request failed.'
            : null,
      ...(bytes
        ? {
            responseBytes: Uint8Array.from(bytes),
            responseSha256: materialAnalysisBytesHash(bytes),
            responseKind: saved.row.mode,
            responseMetadata: metadata,
          }
        : {}),
    },
  });
}
export function placementHttpStore(context: PlacementAuthority, ai: CapturedLearningAi) {
  return {
    admit: (database: Prisma.TransactionClient, attempt: { id: string; fingerprint: string }) =>
      admit(database, context, ai, attempt),
    settle: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string },
      outcome: 'succeeded' | 'failed' | 'unknown',
      receipt?: LearningPreparationResponseReceipt
    ) => settle(database, context, attempt, outcome, receipt),
  };
}
export function placementCliStore(
  context: PlacementAuthority,
  ai: CapturedLearningAi,
  validateBinding: (
    database: Prisma.TransactionClient,
    binding: LearningCliReceipt['binding']
  ) => Promise<void>
) {
  return {
    ...placementHttpStore(context, ai),
    settle: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string },
      outcome: 'succeeded' | 'failed' | 'unknown',
      receipt?: LearningCliReceipt
    ) => settle(database, context, attempt, outcome, receipt),
    validateBinding,
  };
}
export async function readPlacementResponse(
  database: Prisma.TransactionClient,
  context: PlacementAuthority
) {
  const saved = await requirePlacementSession(database, context),
    row = saved.row;
  if (!row.responseBytes) return { ...saved, receipt: null };
  if (
    !['SUCCEEDED', 'FAILED', 'READY', 'OUTPUT_INVALID', 'ACCEPTED'].includes(row.status) ||
    row.responseBytes.byteLength > limit ||
    materialAnalysisBytesHash(row.responseBytes) !== row.responseSha256 ||
    row.responseKind !== row.mode ||
    !row.attemptId ||
    !row.attemptFingerprint
  )
    throw new MaterialAnalysisConflict('The placement response checksum or identity changed.');
  if (row.mode === 'HTTP') {
    const receipt = {
      ...metadataSchema.parse(row.responseMetadata),
      bodyBase64: Buffer.from(row.responseBytes).toString('base64'),
      bodySha256: row.responseSha256!,
    };
    restoreLearningPreparationResponse(receipt);
    return { ...saved, receipt: { kind: 'HTTP' as const, value: receipt } };
  }
  return {
    ...saved,
    receipt: {
      kind: 'CLI' as const,
      value: cliSchema.parse(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(row.responseBytes)
        )
      ),
    },
  };
}
export function decodePlacementQuestions(row: {
  questionsBytes: Uint8Array;
  questionsDigest: string;
}) {
  if (materialAnalysisBytesHash(row.questionsBytes) !== row.questionsDigest)
    throw new MaterialAnalysisConflict('The preserved placement questions changed.');
  return z
    .array(placementPrivateQuestionSchema)
    .min(6)
    .max(24)
    .parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(row.questionsBytes)
      )
    );
}
