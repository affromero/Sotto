import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { delegationAttemptInputSchema } from 'thesidedoor-core/runtime/delegation';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningHttpCompletion } from '@/lib/learning/preparation/provider-invocation';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import {
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from '@/lib/learning/preparation/preparation-provider';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import {
  requireAssessmentSettlementWork,
  requirePendingAssessmentWork,
} from '../generation/assessment-work';

const stageSchema = z.enum([
  'AUTHOR_GRAMMAR',
  'AUTHOR_READING',
  'AUTHOR_LISTENING',
  'AUTHOR_SPEAKING',
  'AUTHOR_WRITING',
  'REVIEW',
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const metadataSchema = z
  .object({
    status: z.number().int().min(200).max(599),
    statusText: z.string().max(2000),
    headers: z.array(z.tuple([z.string(), z.string()])).max(100),
  })
  .strict();
type Context = {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  stage: z.infer<typeof stageSchema>;
  ordinal: number;
  role: 'MODEL' | 'MODERATION' | 'CLI';
  inputDigest: string;
};

/** Bind every private journal field consumed by an offline review to its final transaction. */
export function assessmentCallInventoryDigest(
  calls: Array<Prisma.ClassAssessmentProviderCallGetPayload<{}>>
) {
  return learningProviderInputHash(
    calls.map((call) => ({
      id: call.id,
      assessmentId: call.assessmentId,
      stage: call.stage,
      ordinal: call.ordinal,
      role: call.role,
      inputDigest: call.inputDigest,
      status: call.status,
      attemptId: call.attemptId,
      attemptFingerprint: call.attemptFingerprint,
      responseMetadata: call.responseMetadata,
      responseSha256: call.responseSha256,
      responseBytes: call.responseBytes ? Buffer.from(call.responseBytes).toString('base64') : null,
    }))
  );
}

async function ownedCall(database: Prisma.TransactionClient, context: Context, settling = false) {
  const stage = stageSchema.parse(context.stage);
  const ordinal = z.number().int().min(0).max(15).parse(context.ordinal);
  const role = z.enum(['MODEL', 'MODERATION', 'CLI']).parse(context.role);
  const inputDigest = digest.parse(context.inputDigest);
  const { current } = settling
    ? await requireAssessmentSettlementWork(database, context.identity)
    : await requirePendingAssessmentWork(database, context.identity, context.execution, 'RUNNING');
  if (stage !== 'REVIEW') {
    const skill = stage.slice('AUTHOR_'.length);
    if (
      !Object.entries(current.requirements.skills).some(
        ([key, value]) => key === skill && value.state === 'REQUIRED'
      )
    )
      throw new AssessmentFenceConflict();
  }
  if (
    (role === 'CLI' && (current.selection.provider !== 'codex' || ordinal !== 0)) ||
    (role === 'MODEL' && current.selection.provider === 'codex') ||
    (role === 'MODERATION' && current.selection.provider === 'codex' && ordinal === 0)
  )
    throw new AssessmentFenceConflict();
  const row = await database.classAssessmentProviderCall.findUnique({
    where: { assessmentId_stage_ordinal: { assessmentId: current.assessmentId, stage, ordinal } },
  });
  if (row && (row.inputDigest !== inputDigest || row.role !== role))
    throw new AssessmentFenceConflict();
  return { current, row, stage, ordinal, inputDigest, role };
}

/** Create the stable stage before any provider I/O. Unknown stages are never retried implicitly. */
export async function prepareAssessmentProviderCall(
  database: Prisma.TransactionClient,
  context: Context
) {
  const { current, row, stage, ordinal, inputDigest, role } = await ownedCall(database, context);
  if (row) return row;
  const previous = await database.classAssessmentProviderCall.findMany({
    where: { assessmentId: current.assessmentId, stage },
    orderBy: { ordinal: 'asc' },
  });
  if (previous.length !== ordinal) throw new AssessmentFenceConflict();
  for (const [index, call] of previous.entries()) {
    if (call.ordinal !== index || call.inputDigest !== inputDigest)
      throw new AssessmentFenceConflict();
    const priorRole = z.enum(['MODEL', 'MODERATION', 'CLI']).parse(call.role);
    const saved = await readAssessmentProviderCall(database, {
      ...context,
      ordinal: index,
      role: priorRole,
    });
    if (
      priorRole === 'CLI' &&
      role === 'MODERATION' &&
      call.status === 'DISPATCHING' &&
      saved?.status === 'DISPATCHING'
    )
      continue;
    if (!['SUCCEEDED', 'FAILED'].includes(call.status) || priorRole === 'CLI')
      throw new AssessmentFenceConflict();
    if (!saved?.receipt) throw new AssessmentFenceConflict();
  }
  return database.classAssessmentProviderCall.create({
    data: { assessmentId: current.assessmentId, stage, ordinal, role, inputDigest },
  });
}

export async function admitAssessmentProviderCall(
  database: Prisma.TransactionClient,
  context: Context,
  attemptInput: { id: string; fingerprint: string }
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput);
  const { current, row } = await ownedCall(database, context);
  if (!row || row.status !== 'READY') throw new AssessmentFenceConflict();
  if (
    context.role === 'CLI' &&
    (!current.cliBinding ||
      attempt.fingerprint !==
        learningProviderInputHash({
          inputDigest: context.inputDigest,
          selection: current.selection,
          binding: current.cliBinding,
        }))
  )
    throw new AssessmentFenceConflict();
  const result = await learningPreparationGrant(database, current, 'assessment').admit(
    current.grant,
    attempt
  );
  if (!result.dispatch) throw new AssessmentFenceConflict();
  await database.classAssessmentProviderCall.update({
    where: { id: row.id },
    data: {
      status: 'DISPATCHING',
      attemptId: attempt.id,
      attemptFingerprint: attempt.fingerprint,
    },
  });
  return result;
}

export async function settleAssessmentProviderCall(
  database: Prisma.TransactionClient,
  context: Context,
  attemptInput: { id: string; fingerprint: string },
  outcome: 'succeeded' | 'failed' | 'unknown',
  receipt?: LearningPreparationResponseReceipt
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput);
  if (context.role === 'CLI') throw new AssessmentFenceConflict();
  const { current, row } = await ownedCall(database, context, true);
  if (
    !row ||
    row.attemptId !== attempt.id ||
    row.attemptFingerprint !== attempt.fingerprint ||
    (outcome === 'succeeded' && !receipt) ||
    (outcome === 'unknown' && receipt)
  )
    throw new AssessmentFenceConflict();
  let bytes: Buffer | undefined;
  let metadata: z.infer<typeof metadataSchema> | undefined;
  if (receipt) {
    restoreLearningPreparationResponse(receipt);
    if ((receipt.status >= 200 && receipt.status < 300) !== (outcome === 'succeeded'))
      throw new AssessmentFenceConflict();
    bytes = Buffer.from(receipt.bodyBase64, 'base64');
    metadata = metadataSchema.parse({
      status: receipt.status,
      statusText: receipt.statusText,
      headers: receipt.headers.filter(([name]) => name.toLowerCase() === 'content-type'),
    });
    if (
      bytes.length > 512 * 1024 ||
      Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 32 * 1024
    )
      throw new AssessmentFenceConflict();
  }
  const status = outcome.toUpperCase();
  const sha256 = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  if (row.status !== 'DISPATCHING') {
    if (
      row.status !== status ||
      row.responseSha256 !== sha256 ||
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
            responseSha256: sha256,
            responseMetadata: metadata,
          }
        : {}),
    },
  });
}

/** Return only a fully validated receipt bound to the same settled provider attempt. */
export async function readAssessmentProviderCall(
  database: Prisma.TransactionClient,
  context: Context
) {
  const { current, row } = await ownedCall(database, context);
  if (!row) return null;
  if (!row.attemptId || !row.attemptFingerprint) {
    if (row.status !== 'READY') throw new AssessmentFenceConflict();
    return { status: row.status, receipt: null, attemptFingerprint: null };
  }
  const grant = await learningPreparationGrant(database, current, 'assessment').read(current.grant);
  const attempt = grant.attempts.find((value) => value.id === row.attemptId);
  const expected = row.status === 'DISPATCHING' ? 'admitted' : row.status.toLowerCase();
  if (!attempt || attempt.fingerprint !== row.attemptFingerprint || attempt.outcome !== expected)
    throw new AssessmentFenceConflict();
  if (context.role === 'CLI')
    return { status: row.status, receipt: null, attemptFingerprint: row.attemptFingerprint };
  if (!row.responseBytes)
    return { status: row.status, receipt: null, attemptFingerprint: row.attemptFingerprint };
  if (
    !row.responseSha256 ||
    createHash('sha256').update(row.responseBytes).digest('hex') !== row.responseSha256
  )
    throw new AssessmentFenceConflict();
  const receipt = {
    ...metadataSchema.parse(row.responseMetadata),
    bodyBase64: Buffer.from(row.responseBytes).toString('base64'),
    bodySha256: row.responseSha256,
  };
  restoreLearningPreparationResponse(receipt);
  return { status: row.status, receipt, attemptFingerprint: row.attemptFingerprint };
}

/** The last model exchange must be complete, and replay must consume every saved call. */
export async function requireCompleteAssessmentProviderStage(
  database: Prisma.TransactionClient,
  context: Omit<Context, 'ordinal' | 'role'>,
  consumedCalls: number
) {
  const { current } = await requirePendingAssessmentWork(
    database,
    context.identity,
    context.execution,
    'RUNNING'
  );
  const rows = await database.classAssessmentProviderCall.findMany({
    where: { assessmentId: current.assessmentId, stage: stageSchema.parse(context.stage) },
    orderBy: { ordinal: 'asc' },
  });
  if (!Number.isSafeInteger(consumedCalls) || consumedCalls < 1 || rows.length !== consumedCalls)
    throw new AssessmentFenceConflict();
  let lastModel: Awaited<ReturnType<typeof readAssessmentProviderCall>> = null;
  for (const [ordinal, row] of rows.entries()) {
    const role = z.enum(['MODEL', 'MODERATION']).parse(row.role);
    if (row.ordinal !== ordinal || row.inputDigest !== context.inputDigest)
      throw new AssessmentFenceConflict();
    const call = await readAssessmentProviderCall(database, { ...context, role, ordinal });
    if (!call || !['SUCCEEDED', 'FAILED'].includes(call.status) || !call.receipt)
      throw new AssessmentFenceConflict();
    if (role === 'MODEL') lastModel = call;
  }
  if (
    !lastModel ||
    lastModel.status !== 'SUCCEEDED' ||
    !lastModel.receipt ||
    learningHttpCompletion(lastModel.receipt) !== 'COMPLETE'
  )
    throw new AssessmentFenceConflict();
}
