import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { delegationAttemptInputSchema } from 'thesidedoor-core/runtime/delegation';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import {
  learningPreparationRequestFingerprint,
  restoreLearningPreparationResponse,
} from '@/lib/learning/preparation/preparation-provider';
import {
  interpretModerationResponse,
  MODERATION_API_URL,
  moderationRequestBody,
} from '@/lib/moderation';
import type { LearningCliReceipt } from '@/lib/learning/preparation/provider-invocation';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import {
  requireAssessmentSettlementWork,
  requirePendingAssessmentWork,
} from '../generation/assessment-work';
import { readAssessmentProviderCall } from './assessment-provider-journal';

type Context = Parameters<typeof readAssessmentProviderCall>[1] & { moderationInput: string };
const responseSchema = z
  .object({
    content: z.string().min(1),
    model: z.string().min(1),
    inputTokens: z.number().finite().nonnegative().nullable(),
    outputTokens: z.number().finite().nonnegative().nullable(),
    cachedInputTokens: z.number().finite().nonnegative().nullable().optional(),
    cacheWriteTokens: z.number().finite().nonnegative().nullable().optional(),
    reasoningTokens: z.number().finite().nonnegative().nullable().optional(),
  })
  .strict();
const metadataSchema = z
  .object({
    status: z.number().int(),
    statusText: z.string(),
    headers: z.array(z.tuple([z.string(), z.string()])),
  })
  .strict();

async function cliRow(database: Prisma.TransactionClient, context: Context, settling: boolean) {
  if (
    context.role !== 'CLI' ||
    context.ordinal !== 0 ||
    !/^[a-f0-9]{64}$/.test(context.inputDigest)
  )
    throw new AssessmentFenceConflict();
  const { current } = settling
    ? await requireAssessmentSettlementWork(database, context.identity)
    : await requirePendingAssessmentWork(database, context.identity, context.execution, 'RUNNING');
  if (current.selection.provider !== 'codex' || !current.cliBinding)
    throw new AssessmentFenceConflict();
  const row = await database.classAssessmentProviderCall.findUnique({
    where: {
      assessmentId_stage_ordinal: {
        assessmentId: current.assessmentId,
        stage: context.stage,
        ordinal: 0,
      },
    },
  });
  if (!row || row.role !== 'CLI' || row.inputDigest !== context.inputDigest)
    throw new AssessmentFenceConflict();
  return { current, row };
}

async function requireSettledModeration(
  database: Prisma.TransactionClient,
  context: Context,
  current: Awaited<ReturnType<typeof cliRow>>['current'],
  output: string
) {
  const calls = await database.classAssessmentProviderCall.findMany({
    where: { assessmentId: current.assessmentId, stage: context.stage, ordinal: { gt: 0 } },
    orderBy: { ordinal: 'asc' },
  });
  const texts =
    current.selection.moderationCredentialFingerprint === null
      ? []
      : [context.moderationInput, output];
  if (calls.length !== texts.length) throw new AssessmentFenceConflict();
  const grant = await learningPreparationGrant(database, current, 'assessment').read(current.grant);
  for (const [index, call] of calls.entries()) {
    const attempt = grant.attempts.find((entry) => entry.id === call.attemptId);
    if (
      call.ordinal !== index + 1 ||
      call.role !== 'MODERATION' ||
      call.inputDigest !== context.inputDigest ||
      call.status !== 'SUCCEEDED' ||
      !call.responseBytes ||
      !call.responseSha256 ||
      createHash('sha256').update(call.responseBytes).digest('hex') !== call.responseSha256 ||
      !attempt ||
      attempt.outcome !== 'succeeded' ||
      attempt.fingerprint !== call.attemptFingerprint
    )
      throw new AssessmentFenceConflict();
    const receipt = {
      ...metadataSchema.parse(call.responseMetadata),
      bodyBase64: Buffer.from(call.responseBytes).toString('base64'),
      bodySha256: call.responseSha256,
    };
    if (receipt.status < 200 || receipt.status >= 300) throw new AssessmentFenceConflict();
    restoreLearningPreparationResponse(receipt);
    const request = new Request(MODERATION_API_URL, {
      method: 'POST',
      body: moderationRequestBody(texts[index]!),
    });
    const fingerprint = await learningPreparationRequestFingerprint(
      request,
      {
        selection: current.selection,
        operationId: context.identity.id,
        stage: context.stage,
        inputDigest: context.inputDigest,
      },
      context.execution.signal ?? new AbortController().signal
    );
    if (fingerprint !== call.attemptFingerprint) throw new AssessmentFenceConflict();
    const verdict = interpretModerationResponse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(call.responseBytes))
    );
    if (verdict.flagged) throw new AssessmentFenceConflict();
  }
}

/** Settle the exact local-account invocation even when its teaching has since changed. */
export async function settleAssessmentCliCall(
  database: Prisma.TransactionClient,
  context: Context,
  attemptInput: { id: string; fingerprint: string },
  outcome: 'succeeded' | 'failed' | 'unknown',
  receipt?: LearningCliReceipt
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput);
  const { current, row } = await cliRow(database, context, true);
  if (
    row.attemptId !== attempt.id ||
    row.attemptFingerprint !== attempt.fingerprint ||
    (outcome === 'succeeded') !== Boolean(receipt) ||
    attempt.fingerprint !==
      learningProviderInputHash({
        inputDigest: context.inputDigest,
        selection: current.selection,
        binding: current.cliBinding,
      })
  )
    throw new AssessmentFenceConflict();
  let bytes: Buffer | undefined;
  let metadata: { kind: 'CLI'; binding: NonNullable<typeof current.cliBinding> } | undefined;
  if (receipt) {
    if (
      receipt.inputDigest !== context.inputDigest ||
      !isDeepStrictEqual(receipt.attempt, attempt) ||
      !isDeepStrictEqual(receipt.binding, current.cliBinding)
    )
      throw new AssessmentFenceConflict();
    const response = responseSchema.parse(receipt.response);
    if (response.model !== current.selection.model) throw new AssessmentFenceConflict();
    bytes = Buffer.from(JSON.stringify(response));
    if (bytes.length > 512 * 1024) throw new AssessmentFenceConflict();
    metadata = { kind: 'CLI', binding: current.cliBinding! };
    await requireSettledModeration(database, context, current, response.content);
  }
  const status = outcome.toUpperCase();
  const hash = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  if (row.status !== 'DISPATCHING') {
    if (
      row.status !== status ||
      row.responseSha256 !== hash ||
      !isDeepStrictEqual(row.responseMetadata, metadata ?? null) ||
      !isDeepStrictEqual(row.responseBytes ? Buffer.from(row.responseBytes) : null, bytes ?? null)
    )
      throw new AssessmentFenceConflict();
    return;
  }
  await learningPreparationGrant(database, current, 'assessment').settle(
    current.grant,
    attempt,
    outcome
  );
  await database.classAssessmentProviderCall.update({
    where: { id: row.id },
    data: {
      status,
      ...(bytes && metadata
        ? {
            responseBytes: Uint8Array.from(bytes),
            responseSha256: hash,
            responseMetadata: metadata,
          }
        : {}),
    },
  });
}

/** Reconstruct only an owned, settled CLI response with its original binding. */
export async function readAssessmentCliCall(database: Prisma.TransactionClient, context: Context) {
  const { current, row } = await cliRow(database, context, false);
  const call = await readAssessmentProviderCall(database, context);
  if (
    !call ||
    call.status !== 'SUCCEEDED' ||
    !row.attemptId ||
    !row.attemptFingerprint ||
    row.status !== 'SUCCEEDED' ||
    !row.responseBytes ||
    !row.responseSha256
  )
    throw new AssessmentFenceConflict();
  if (
    createHash('sha256').update(row.responseBytes).digest('hex') !== row.responseSha256 ||
    !isDeepStrictEqual(row.responseMetadata, { kind: 'CLI', binding: current.cliBinding })
  )
    throw new AssessmentFenceConflict();
  const response = responseSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(row.responseBytes))
  );
  await requireSettledModeration(database, context, current, response.content);
  if (
    response.model !== current.selection.model ||
    row.attemptFingerprint !==
      learningProviderInputHash({
        inputDigest: context.inputDigest,
        selection: current.selection,
        binding: current.cliBinding,
      })
  )
    throw new AssessmentFenceConflict();
  return response;
}
