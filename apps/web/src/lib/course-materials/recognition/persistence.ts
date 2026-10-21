import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DelegationStore,
  delegationGrantBinding,
  delegationGrantSchema,
  delegationAttemptInputSchema,
} from 'thesidedoor-core/runtime/delegation';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma, MaterialRecognitionOperation } from '@/generated/prisma/client';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { validateSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { materialStorageScopes } from '@/lib/course-materials';
import {
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from '@/lib/learning/preparation/preparation-provider';
import { requireMaterialRun, type MaterialRunIdentity } from '../extraction/persistence';
import { materialPdfPageSchema } from '../extraction/pdf-protocol';
import {
  MATERIAL_RECOGNITION_LIMITS,
  MATERIAL_RECOGNITION_SYSTEM,
  MATERIAL_TRANSCRIPTION_JSON_SCHEMA,
  materialRecognitionHash,
  materialRecognitionCapabilitySchema,
  materialRecognitionSourceSchema,
  materialRecognitionSelectionSchema,
  materialRecognitionSelection,
  materialRecognitionGrantSpec,
  type PreparedMaterialRecognition,
} from './protocol';
import type {
  MaterialRecognitionCliBinding,
  MaterialRecognitionCliOperation,
  MaterialRecognitionCliReceipt,
  MaterialRecognitionHttpOperation,
  MaterialRecognitionHttpReceipt,
  RecognitionAttempt,
} from './execute';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z
  .object({
    kind: z.literal('LOCAL_ACCOUNT'),
    fingerprint: sha,
    revision: z.string().min(1).max(200),
  })
  .strict();
const renderSchema = z
  .object({
    originalSha256: sha,
    rendererVersion: z.string().min(1),
    page: materialPdfPageSchema,
  })
  .strict();
const identitySchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    mode: z.enum(['HTTP', 'CLI']),
    inputDigest: sha,
    source: materialRecognitionSourceSchema,
    capability: materialRecognitionCapabilitySchema,
    selection: materialRecognitionSelectionSchema,
    cliBinding: bindingSchema.nullable(),
    renderIdentity: renderSchema,
  })
  .strict();
export type MaterialRecognitionIdentity = z.infer<typeof identitySchema>;
type Identity = MaterialRecognitionIdentity;
const terminalRuns = new Set(['COMPLETE', 'PARTIAL', 'FAILED', 'RECOVERY_REQUIRED']);
const usage = z.number().int().nonnegative().finite().nullable();
const aiResponseSchema = z
  .object({
    content: z.string(),
    model: z.string().min(1).max(200),
    inputTokens: usage,
    outputTokens: usage,
    cachedInputTokens: usage.optional(),
    cacheWriteTokens: usage.optional(),
    reasoningTokens: usage.optional(),
  })
  .strict();
const httpMetadataSchema = z
  .object({
    status: z.number().int().min(200).max(599),
    statusText: z.string().max(2000),
    headers: z.array(z.tuple([z.string(), z.string()])).max(100),
  })
  .strict();

export interface MaterialRecognitionStoreContext {
  run: MaterialRunIdentity;
  execution: SottoProviderExecution;
  operationId: string;
}

function checkedIdentity(operation: MaterialRecognitionOperation) {
  const identity = identitySchema.parse(operation.identity);
  if (
    materialRecognitionHash(identity) !== operation.identityDigest ||
    identity.runId !== operation.runId ||
    identity.mode !== operation.mode ||
    identity.inputDigest !== operation.inputDigest ||
    identity.source.page.number !== operation.pageNumber ||
    identity.source.material.originalSha256 !== operation.originalSha256 ||
    identity.source.page.imageSha256 !== operation.pageImageSha256
  )
    throw new Error('The saved recognition identity changed.');
  return identity;
}

/** The caller supplies a real durable-job/request authority and a transaction. No external effects. */
async function owned(
  database: Prisma.TransactionClient,
  context: Omit<MaterialRecognitionStoreContext, 'operationId'>
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Recognition persistence requires a Serializable transaction.');
  const current = await context.execution.authorize(database);
  if (current.userId !== context.run.userId || context.execution.userId !== current.userId)
    throw new Error('The recognition recipient changed.');
  const run = await requireMaterialRun(database, context.run);
  const material = await database.courseMaterial.findUniqueOrThrow({
    where: { id: run.materialId },
  });
  const authority = await materialStorageScopes(database, material);
  return { run, material, authority };
}

function assertAuthority(
  identity: Identity,
  authority: Awaited<ReturnType<typeof materialStorageScopes>>
) {
  if (
    !authority.scopes.some(
      (scope) =>
        scope.subjectId === `profile:${identity.source.material.userId}` &&
        scope.generation === identity.source.material.ownerGeneration
    ) ||
    !authority.scopes.some(
      (scope) =>
        scope.subjectId === `material:${identity.source.material.id}` &&
        scope.generation === identity.source.material.generation
    )
  )
    throw new Error('The recognition owner or material generation changed.');
}

async function load(database: Prisma.TransactionClient, context: MaterialRecognitionStoreContext) {
  const owner = await owned(database, context);
  const operation = await database.materialRecognitionOperation.findFirst({
    where: {
      id: context.operationId,
      runId: context.run.runId,
    },
  });
  if (!operation) throw new Error('The owned recognition operation is unavailable.');
  const identity = checkedIdentity(operation);
  if (
    identity.source.material.id !== context.run.materialId ||
    identity.source.material.userId !== context.run.userId ||
    identity.source.material.processingRevision !== context.run.processingRevision
  )
    throw new Error('The recognition extraction scope changed.');
  assertAuthority(identity, owner.authority);
  const page = await database.materialPage.findUniqueOrThrow({
    where: {
      runId_pageNumber: { runId: operation.runId, pageNumber: operation.pageNumber },
    },
  });
  if (
    materialRecognitionHash(page.renderIdentity) !==
      materialRecognitionHash(identity.renderIdentity) ||
    page.pageImageSha256 !== operation.pageImageSha256 ||
    owner.run.rendererVersion !== identity.source.renderer.version
  )
    throw new Error('The immutable recognition page render changed.');
  const grant = delegationGrantSchema.parse(operation.grant);
  if (
    grant.instanceId !== owner.authority.instanceId ||
    grant.id !== operation.id ||
    grant.maxRequests !== 1 ||
    grant.action !== `material-recognition:${operation.identityDigest}` ||
    grant.operationId !== operation.id ||
    grant.subject.id !== `profile:${context.run.userId}` ||
    grant.subject.generation !== identity.source.material.ownerGeneration ||
    grant.resource.id !== `material:${context.run.materialId}` ||
    grant.resource.generation !== identity.source.material.generation
  )
    throw new Error('The recognition delegation authority changed.');
  return { ...owner, operation, identity, grant };
}

function grantStore(database: Prisma.TransactionClient, context: MaterialRecognitionStoreContext) {
  return new DelegationStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      `${SIDEDOOR_STATE_ID}:material-recognition-grant:${context.operationId}`
    ),
    authorize: async ({ grant }) => {
      const saved = await load(database, context);
      if (materialRecognitionHash(saved.grant) !== materialRecognitionHash(grant))
        throw new Error('The recognition delegation grant changed.');
    },
  });
}

/** Creates an immutable single-dispatch scope. A new ID does not bypass an existing identity fence. */
export async function createMaterialRecognitionOperation(
  database: Prisma.TransactionClient,
  options: {
    run: MaterialRunIdentity;
    ai: CapturedLearningAi;
    prepared: PreparedMaterialRecognition;
    mode: 'HTTP' | 'CLI';
    cliBinding?: MaterialRecognitionCliBinding;
    expiresAt: number;
  }
) {
  const prepared = structuredClone(options.prepared);
  const owner = await owned(database, { run: options.run, execution: options.ai.execution });
  const source = materialRecognitionSourceSchema.parse(prepared.source);
  const capability = materialRecognitionCapabilitySchema.parse(prepared.capability);
  const selection = materialRecognitionSelection(options.ai, capability);
  const expectedInputDigest = materialRecognitionHash({
    source,
    selection,
    protocolSha256: materialRecognitionHash({
      system: MATERIAL_RECOGNITION_SYSTEM,
      schema: MATERIAL_TRANSCRIPTION_JSON_SCHEMA,
    }),
    maxOutputTokens: capability.maxOutputTokens,
  });
  if (
    prepared.inputDigest !== expectedInputDigest ||
    prepared.system !== MATERIAL_RECOGNITION_SYSTEM ||
    materialRecognitionHash(selection) !== materialRecognitionHash(prepared.selection) ||
    source.material.id !== options.run.materialId ||
    source.material.userId !== options.run.userId ||
    source.material.processingRevision !== options.run.processingRevision ||
    source.material.originalSha256 !== options.run.originalSha256
  )
    throw new Error('Recognition inputs do not match this captured extraction.');
  if (
    options.mode === 'CLI'
      ? selection.provider !== 'codex' || !options.cliBinding
      : selection.provider === 'codex' ||
        selection.provider === 'claude-code' ||
        !!options.cliBinding
  )
    throw new Error('The recognition dispatch mode requires its explicitly configured capability.');
  const page = await database.materialPage.findUniqueOrThrow({
    where: {
      runId_pageNumber: { runId: options.run.runId, pageNumber: source.page.number },
    },
  });
  const render = renderSchema.parse(page.renderIdentity);
  if (owner.run.pageCount === null || source.page.number > owner.run.pageCount)
    throw new Error('Inventory the original page before recognition admission.');
  if (
    render.originalSha256 !== options.run.originalSha256 ||
    render.rendererVersion !== owner.run.rendererVersion ||
    source.renderer.version !== render.rendererVersion ||
    render.page.pageNumber !== source.page.number ||
    !render.page.image ||
    page.pageImageSha256 !== source.page.imageSha256 ||
    render.page.image.sha256 !== source.page.imageSha256 ||
    render.page.image.width !== source.page.width ||
    render.page.image.height !== source.page.height ||
    Math.abs(72 * render.page.image.scale - source.renderer.dpi) > 0.000001 ||
    String(render.page.rotation ?? 0) !== source.renderer.rotation
  )
    throw new Error('Recognition requires the exact retained original page render.');
  const identity = identitySchema.parse({
    schemaVersion: 1,
    runId: options.run.runId,
    mode: options.mode,
    inputDigest: prepared.inputDigest,
    source,
    capability,
    selection,
    cliBinding: options.cliBinding ?? null,
    renderIdentity: render,
  });
  assertAuthority(identity, owner.authority);
  const identityDigest = materialRecognitionHash(identity);
  if (Buffer.byteLength(JSON.stringify(identity)) > 128 * 1024)
    throw new Error('The recognition identity exceeds its immutable metadata budget.');
  const prior = await database.materialRecognitionOperation.findUnique({
    where: {
      runId_identityDigest: { runId: options.run.runId, identityDigest },
    },
  });
  if (prior) {
    await load(database, {
      run: options.run,
      execution: options.ai.execution,
      operationId: prior.id,
    });
    return prior;
  }
  if (terminalRuns.has(owner.run.status))
    throw new Error('Recognition requires an active extraction revision.');
  const id = randomUUID();
  const grant = materialRecognitionGrantSpec({
    id,
    revision: randomUUID(),
    instanceId: owner.authority.instanceId,
    expiresAt: options.expiresAt,
    source,
    identityDigest,
  });
  const operation = await database.materialRecognitionOperation.create({
    data: {
      id,
      runId: options.run.runId,
      pageNumber: source.page.number,
      mode: options.mode,
      identityDigest,
      inputDigest: prepared.inputDigest,
      originalSha256: options.run.originalSha256,
      pageImageSha256: source.page.imageSha256,
      identity,
      grant,
    },
  });
  await grantStore(database, {
    run: options.run,
    execution: options.ai.execution,
    operationId: id,
  }).create(grant);
  return operation;
}

async function admit(
  database: Prisma.TransactionClient,
  context: MaterialRecognitionStoreContext,
  ai: CapturedLearningAi,
  mode: 'HTTP' | 'CLI',
  input: RecognitionAttempt
) {
  const attempt = delegationAttemptInputSchema.parse(input);
  const saved = await load(database, context);
  if (saved.operation.mode !== mode) throw new Error('The recognition dispatch mode changed.');
  // Returning false preserves the original receipt after a lost acknowledgement.
  if (saved.operation.status !== 'READY') return { dispatch: false };
  if (terminalRuns.has(saved.run.status))
    throw new Error('The extraction revision already completed.');
  if (
    mode === 'CLI' &&
    attempt.fingerprint !==
      materialRecognitionHash({
        inputDigest: saved.identity.inputDigest,
        selection: saved.identity.selection,
        binding: saved.identity.cliBinding,
      })
  )
    throw new Error('The CLI invocation fingerprint changed before dispatch.');
  if (
    ai.execution.userId !== context.execution.userId ||
    materialRecognitionHash(materialRecognitionSelection(ai, saved.identity.capability)) !==
      materialRecognitionHash(saved.identity.selection)
  )
    throw new Error('The captured recognition provider or credential changed.');
  if (ai.execution.credential)
    await validateSottoExecutionCredential(
      database,
      context.execution.authorize,
      ai.execution.credential,
      ai.execution.signal
    );
  const admitted = await grantStore(database, context).admit(
    delegationGrantBinding(saved.grant),
    attempt
  );
  if (!admitted.dispatch)
    throw new Error('The recognition grant has already consumed its one dispatch.');
  await database.materialRecognitionOperation.update({
    where: { id: context.operationId },
    data: {
      status: 'DISPATCHING',
      attemptId: attempt.id,
      attemptFingerprint: attempt.fingerprint,
      admittedAt: new Date(),
    },
  });
  return { dispatch: true };
}

function storedBody(body: Buffer, metadata: Prisma.InputJsonObject, kind: 'HTTP' | 'CLI') {
  if (
    body.length > MATERIAL_RECOGNITION_LIMITS.responseBytes ||
    Buffer.byteLength(JSON.stringify(metadata)) > 32 * 1024
  )
    throw new Error('The recognition receipt exceeds its private storage budget.');
  return {
    kind,
    metadata,
    body: Uint8Array.from(body),
    bodySha256: createHash('sha256').update(body).digest('hex'),
    bodyBytes: body.length,
  };
}

function httpBody(receipt: LearningPreparationResponseReceipt) {
  if (receipt.bodyBase64.length > Math.ceil(MATERIAL_RECOGNITION_LIMITS.responseBytes / 3) * 4)
    throw new Error('The recognition receipt exceeds its private storage budget.');
  restoreLearningPreparationResponse(receipt);
  const metadata = httpMetadataSchema.parse({
    status: receipt.status,
    statusText: receipt.statusText,
    headers: receipt.headers,
  });
  return storedBody(Buffer.from(receipt.bodyBase64, 'base64'), metadata, 'HTTP');
}

function cliBody(
  receipt: MaterialRecognitionCliReceipt,
  identity: Identity,
  attempt: RecognitionAttempt
) {
  const binding = bindingSchema.parse(receipt.binding);
  if (
    receipt.inputDigest !== identity.inputDigest ||
    receipt.attempt.id !== attempt.id ||
    receipt.attempt.fingerprint !== attempt.fingerprint ||
    materialRecognitionHash(binding) !== materialRecognitionHash(identity.cliBinding) ||
    materialRecognitionHash({
      inputDigest: identity.inputDigest,
      selection: identity.selection,
      binding,
    }) !== attempt.fingerprint
  )
    throw new Error('The CLI invocation receipt changed its admitted identity.');
  const response = aiResponseSchema.parse(receipt.response);
  if (response.model !== identity.selection.model)
    throw new Error('The CLI receipt model changed.');
  return storedBody(Buffer.from(JSON.stringify(response), 'utf8'), { schemaVersion: 1 }, 'CLI');
}

async function settle(
  database: Prisma.TransactionClient,
  context: MaterialRecognitionStoreContext,
  mode: 'HTTP' | 'CLI',
  input: RecognitionAttempt,
  outcome: 'succeeded' | 'failed' | 'unknown',
  receipt?: LearningPreparationResponseReceipt | MaterialRecognitionCliReceipt
) {
  const attempt = delegationAttemptInputSchema.parse(input);
  const saved = await load(database, context);
  if (
    saved.operation.mode !== mode ||
    saved.operation.attemptId !== attempt.id ||
    saved.operation.attemptFingerprint !== attempt.fingerprint
  )
    throw new Error('The recognition settlement does not match its admitted attempt.');
  if (outcome === 'succeeded' && !receipt)
    throw new Error('Success requires a durable replayable response receipt.');
  if (outcome === 'unknown' && receipt)
    throw new Error('An unknown outcome cannot claim a complete response receipt.');
  let body: ReturnType<typeof storedBody> | undefined;
  if (receipt) {
    if (mode === 'HTTP') {
      if (!('status' in receipt)) throw new Error('The HTTP receipt has the wrong channel.');
      if ((receipt.status >= 200 && receipt.status < 300) !== (outcome === 'succeeded'))
        throw new Error('The HTTP status does not match its settlement.');
      body = httpBody(receipt);
    } else {
      if (!('binding' in receipt) || outcome !== 'succeeded')
        throw new Error('The CLI receipt has the wrong channel or outcome.');
      body = cliBody(receipt, saved.identity, attempt);
    }
  }
  const status = outcome.toUpperCase();
  if (saved.operation.status !== 'DISPATCHING') {
    const previous = await database.materialRecognitionResponse.findUnique({
      where: { operationId: context.operationId },
    });
    if (
      saved.operation.status !== status ||
      !!previous !== !!body ||
      (previous &&
        body &&
        (previous.bodySha256 !== body.bodySha256 ||
          materialRecognitionHash(previous.metadata) !== materialRecognitionHash(body.metadata)))
    )
      throw new Error('A terminal recognition outcome cannot be changed or retried.');
    return;
  }
  // All writes share the caller transaction. Failed commits leave DISPATCHING and forbid replay dispatch.
  if (body)
    await database.materialRecognitionResponse.create({
      data: { operationId: context.operationId, ...body },
    });
  await grantStore(database, context).settle(delegationGrantBinding(saved.grant), attempt, outcome);
  await database.materialRecognitionOperation.update({
    where: { id: context.operationId },
    data: { status, settledAt: new Date() },
  });
}

export function materialRecognitionHttpStore(
  context: Omit<MaterialRecognitionStoreContext, 'execution'> & { ai: CapturedLearningAi }
): MaterialRecognitionHttpOperation {
  const ownedContext = { ...context, execution: context.ai.execution };
  return {
    admit: (database, attempt) => admit(database, ownedContext, context.ai, 'HTTP', attempt),
    settle: (database, attempt, outcome, receipt) =>
      settle(database, ownedContext, 'HTTP', attempt, outcome, receipt),
  };
}

/** The caller uses the canonical persistent local account binding capture before and after invocation. */
export function materialRecognitionCliStore(
  context: Omit<MaterialRecognitionStoreContext, 'execution'> & {
    ai: CapturedLearningAi;
    validateBinding: MaterialRecognitionCliOperation['validateBinding'];
  }
): MaterialRecognitionCliOperation {
  const ownedContext = { ...context, execution: context.ai.execution };
  return {
    validateBinding: context.validateBinding,
    admit: (database, attempt) => admit(database, ownedContext, context.ai, 'CLI', attempt),
    settle: (database, attempt, outcome, receipt) =>
      settle(database, ownedContext, 'CLI', attempt, outcome, receipt),
  };
}

/** Owner-authorized offline receipt read. Rotating a provider key does not erase an observed response. */
export async function readMaterialRecognitionReceipt(
  database: Prisma.TransactionClient,
  context: MaterialRecognitionStoreContext
) {
  const saved = await load(database, context);
  const response = await database.materialRecognitionResponse.findUnique({
    where: { operationId: context.operationId },
  });
  if (!response) return { status: saved.operation.status, receipt: null };
  if (
    !['SUCCEEDED', 'FAILED'].includes(saved.operation.status) ||
    !saved.operation.attemptId ||
    !saved.operation.attemptFingerprint
  )
    throw new Error('The saved response has no terminal admitted attempt.');
  const bytes = Buffer.from(response.body);
  if (
    response.kind !== saved.operation.mode ||
    bytes.length !== response.bodyBytes ||
    bytes.length > MATERIAL_RECOGNITION_LIMITS.responseBytes ||
    createHash('sha256').update(bytes).digest('hex') !== response.bodySha256 ||
    Buffer.byteLength(JSON.stringify(response.metadata)) > 32 * 1024
  )
    throw new Error('The durable recognition response receipt changed.');
  const attempt = {
    id: saved.operation.attemptId,
    fingerprint: saved.operation.attemptFingerprint,
  };
  if (response.kind === 'HTTP') {
    const receipt: MaterialRecognitionHttpReceipt = {
      inputDigest: saved.identity.inputDigest,
      attempt,
      response: {
        ...httpMetadataSchema.parse(response.metadata),
        bodyBase64: bytes.toString('base64'),
        bodySha256: response.bodySha256,
      },
    };
    restoreLearningPreparationResponse(receipt.response);
    return { status: saved.operation.status, receipt: { kind: 'HTTP' as const, value: receipt } };
  }
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const receipt: MaterialRecognitionCliReceipt = {
    inputDigest: saved.identity.inputDigest,
    attempt,
    binding: bindingSchema.parse(saved.identity.cliBinding),
    response: aiResponseSchema.parse(JSON.parse(body)),
  };
  cliBody(receipt, saved.identity, attempt);
  return { status: saved.operation.status, receipt: { kind: 'CLI' as const, value: receipt } };
}

/** Only immutable non-secret inputs. The caller regenerates and verifies their retained PNG tiles. */
export async function readMaterialRecognitionIdentity(
  database: Prisma.TransactionClient,
  context: MaterialRecognitionStoreContext
): Promise<MaterialRecognitionIdentity> {
  return structuredClone((await load(database, context)).identity);
}

/** A crashed admitted invocation remains terminally fenced. This never authorizes another call. */
export async function markMaterialRecognitionUnknown(
  database: Prisma.TransactionClient,
  context: MaterialRecognitionStoreContext
) {
  const saved = await load(database, context);
  if (saved.operation.status !== 'DISPATCHING') return;
  if (!saved.operation.attemptId || !saved.operation.attemptFingerprint)
    throw new Error('The recognition invocation has no durable admitted attempt.');
  await settle(
    database,
    context,
    saved.identity.mode,
    {
      id: saved.operation.attemptId,
      fingerprint: saved.operation.attemptFingerprint,
    },
    'unknown'
  );
}
