import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DelegationStore,
  delegationGrantSchema,
  delegationGrantBinding,
  delegationAttemptInputSchema,
} from 'thesidedoor-core/runtime/delegation';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import {
  materialFocusAnalysisIdentitySchema,
  materialFocusChunkResultSchema,
  MATERIAL_FOCUS_ANALYSIS_LIMITS,
} from '@sotto/shared';
import type { Prisma, MaterialAnalysisUnit } from '@/generated/prisma/client';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { validateSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { readPublishedLearningCatalog } from '@/lib/learning-map/catalog';
import {
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from '@/lib/learning/preparation/preparation-provider';
import type { LearningCliReceipt } from '@/lib/learning/preparation/provider-invocation';
import { materialAnalysisPolicySchema } from './policy';
import {
  restoreMaterialFocusAnalysis,
  materialFocusAnalysisHash,
  type PreparedMaterialFocusChunk,
} from './protocol';
import {
  validateMaterialAnalysisSources,
  MaterialAnalysisConflict,
  materialAnalysisBytesHash,
} from './inventory';
import { materialAnalysisUnitReuseSchema } from './recovery/reuse';

export interface MaterialAnalysisAuthority {
  analysisId: string;
  userId: string;
  execution: SottoProviderExecution;
}
export interface MaterialAnalysisUnitAuthority extends MaterialAnalysisAuthority {
  unitId: string;
}
const active = new Set(['WAITING_SOURCE', 'RUNNING']);
const responseMetadata = z
  .object({
    status: z.number().int().min(200).max(599),
    statusText: z.string().max(2000),
    headers: z.array(z.tuple([z.string(), z.string()])).max(100),
  })
  .strict();
const tokenCount = z.number().nonnegative().finite().nullable();
const cliResponse = z
  .object({
    content: z.string(),
    model: z.string().min(1),
    inputTokens: tokenCount,
    outputTokens: tokenCount,
    cachedInputTokens: tokenCount.optional(),
    cacheWriteTokens: tokenCount.optional(),
    reasoningTokens: tokenCount.optional(),
  })
  .strict();
const unitIdentity = z
  .object({
    schemaVersion: z.literal(1),
    analysisId: z.uuid(),
    analysisIdentityDigest: z.string(),
    unitId: z.string(),
    inputDigest: z.string(),
    mode: z.enum(['HTTP', 'CLI']),
    selection: z.json(),
    cliBinding: z.json(),
    systemSha256: z.string(),
    messagesSha256: z.string(),
    schemaSha256: z.string(),
    maxOutputTokens: z.number().int().positive(),
  })
  .strict();

/** Serializable application authority protects every analysis checkpoint and provider attempt. */
export async function requireMaterialAnalysis(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisAuthority
) {
  const actor = await context.execution.authorize(database);
  if (actor.userId !== context.userId || context.execution.userId !== context.userId)
    throw new MaterialAnalysisConflict('The analysis actor changed.');
  await database.$queryRaw`SELECT id FROM "MaterialAnalysis" WHERE id = ${context.analysisId} FOR UPDATE`;
  return readOwnedMaterialAnalysis(database, context);
}

export async function readOwnedMaterialAnalysis(
  database: Prisma.TransactionClient,
  context: { analysisId: string; userId: string }
) {
  const row = await database.materialAnalysis.findFirst({
    where: { id: context.analysisId, userId: context.userId },
    include: { catalogRevision: true },
  });
  if (!row) throw new MaterialAnalysisConflict('Analysis not found.', 404);
  const sources = await validateMaterialAnalysisSources(database, row);
  const policy = materialAnalysisPolicySchema.parse(row.policy);
  const catalog = row.catalogRevision ? readPublishedLearningCatalog(row.catalogRevision) : null;
  const prepared = row.identity
    ? restoreMaterialFocusAnalysis(materialFocusAnalysisIdentitySchema.parse(row.identity), catalog)
    : null;
  if (prepared) {
    const course = row.intendedCourseId
      ? await database.course.findUnique({
          where: { id: row.intendedCourseId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (
      (prepared.identity.course === null) !== (row.intendedCourseId === null) ||
      (prepared.identity.course &&
        (!course ||
          course.id !== prepared.identity.course.id ||
          course.createdAt.getTime() !== prepared.identity.course.generation))
    )
      throw new MaterialAnalysisConflict('The frozen analysis course generation changed.');
  }
  if (
    prepared &&
    (prepared.identityDigest !== row.identityDigest ||
      prepared.identity.owner.userId !== row.userId ||
      BigInt(prepared.identity.owner.generation) !== row.userGeneration ||
      prepared.identity.nativeLang !== row.nativeLang ||
      prepared.identity.targetLang !== row.targetLang ||
      prepared.identity.analyzer.version !== policy.analyzerVersion ||
      prepared.identity.analyzer.runtimeRevision !== policy.runtimeRevision ||
      materialFocusAnalysisHash(prepared.identity.analyzer.selection) !==
        materialFocusAnalysisHash(policy.selection) ||
      materialFocusAnalysisHash(prepared.identity.analyzer.cliBinding) !==
        materialFocusAnalysisHash(policy.cliBinding) ||
      prepared.identity.analyzer.maxOutputTokens !== policy.maxOutputTokens ||
      sources.length !== prepared.identity.sources.length ||
      sources.some((source) => {
        const id = source.materialId ?? source.sourceId;
        const saved = prepared.identity.sources.find(
          (value) => (value.sourceKind === 'MATERIAL' ? value.materialId : value.sourceId) === id
        );
        return !saved || materialFocusAnalysisHash(saved) !== source.inventoryDigest;
      }))
  )
    throw new MaterialAnalysisConflict('The frozen analysis identity changed.');
  return { row, sources, policy, catalog, prepared };
}

async function loadUnit(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisUnitAuthority,
  visited: ReadonlySet<string> = new Set(),
  analyses: Map<string, Awaited<ReturnType<typeof requireMaterialAnalysis>>> = new Map()
): Promise<
  Awaited<ReturnType<typeof requireMaterialAnalysis>> & {
    unit: MaterialAnalysisUnit;
    identity: z.infer<typeof unitIdentity>;
    grant: z.infer<typeof delegationGrantSchema> | null;
  }
> {
  if (visited.has(context.unitId) || visited.size >= 64)
    throw new MaterialAnalysisConflict(
      'The inherited analysis receipt lineage is invalid or exceeds its explicit read bound.'
    );
  const lineage = new Set(visited);
  lineage.add(context.unitId);
  const analysis =
    analyses.get(context.analysisId) ?? (await requireMaterialAnalysis(database, context));
  analyses.set(context.analysisId, analysis);
  if (!analysis.prepared)
    throw new MaterialAnalysisConflict('Seal the complete source inventory before provider work.');
  const row = await database.materialAnalysisUnit.findFirst({
    where: { id: context.unitId, analysisId: context.analysisId },
  });
  if (!row) throw new MaterialAnalysisConflict('Analysis unit not found.', 404);
  const identity = unitIdentity.parse(row.identity);
  const expected = analysis.prepared.units.find((unit) => unit.id === row.unitKey);
  if (
    !expected ||
    identity.analysisId !== analysis.row.id ||
    identity.analysisIdentityDigest !== analysis.prepared.identityDigest ||
    identity.unitId !== expected.id ||
    identity.inputDigest !== expected.inputDigest ||
    row.inputDigest !== expected.inputDigest ||
    row.mode !== identity.mode ||
    materialFocusAnalysisHash(identity) !== row.identityDigest ||
    materialFocusAnalysisHash(identity.selection) !==
      materialFocusAnalysisHash(analysis.policy.selection) ||
    materialFocusAnalysisHash(identity.cliBinding) !==
      materialFocusAnalysisHash(analysis.policy.cliBinding)
  )
    throw new MaterialAnalysisConflict('The frozen provider unit identity changed.');
  if (row.reuse !== null) {
    const reuse = materialAnalysisUnitReuseSchema.parse(row.reuse);
    if (
      row.grant !== null ||
      row.attemptId !== null ||
      analysis.row.retryOfAnalysisId !== reuse.sourceAnalysisId
    )
      throw new MaterialAnalysisConflict(
        'An inherited unit cannot own a provider grant or change its parent.'
      );
    const source = await loadUnit(
      database,
      { ...context, analysisId: reuse.sourceAnalysisId, unitId: reuse.sourceUnitId },
      lineage,
      analyses
    );
    const original = source.unit;
    if (
      source.row.userId !== analysis.row.userId ||
      source.row.userGeneration !== analysis.row.userGeneration ||
      source.row.identityDigest !== analysis.row.identityDigest ||
      source.row.catalogRevisionId !== analysis.row.catalogRevisionId ||
      materialFocusAnalysisHash(source.policy) !== materialFocusAnalysisHash(analysis.policy) ||
      original.unitKey !== row.unitKey ||
      original.inputDigest !== row.inputDigest ||
      original.identityDigest !== reuse.sourceIdentityDigest ||
      original.inputDigest !== reuse.sourceInputDigest ||
      original.status !== reuse.sourceStatus ||
      original.attemptId !== reuse.attemptId ||
      original.attemptFingerprint !== reuse.attemptFingerprint ||
      original.responseKind !== reuse.responseKind ||
      original.responseSha256 !== reuse.responseSha256 ||
      original.outputSha256 !== reuse.outputSha256 ||
      !original.responseBytes ||
      materialAnalysisBytesHash(original.responseBytes) !== reuse.responseSha256 ||
      (original.status === 'ANALYZED' &&
        (!original.outputBytes ||
          materialAnalysisBytesHash(original.outputBytes) !== reuse.outputSha256)) ||
      (reuse.sourceStatus === 'ANALYZED'
        ? row.status !== 'ANALYZED'
        : !['SUCCEEDED', 'ANALYZED', 'OUTPUT_INVALID'].includes(row.status))
    )
      throw new MaterialAnalysisConflict(
        'The inherited source response or analyzed output changed.'
      );
    const unit = {
      ...row,
      attemptId: original.attemptId,
      attemptFingerprint: original.attemptFingerprint,
      responseKind: original.responseKind,
      responseMetadata: original.responseMetadata,
      responseBytes: original.responseBytes,
      responseSha256: original.responseSha256,
      outputBytes: row.outputBytes ?? original.outputBytes,
      outputSha256: row.outputSha256 ?? original.outputSha256,
    };
    return { ...analysis, unit, identity, grant: null };
  }
  const grant = delegationGrantSchema.parse(row.grant);
  const instance = await sottoStorageInstance(database).read();
  if (
    grant.instanceId !== instance.instanceId ||
    grant.id !== row.id ||
    grant.operationId !== row.id ||
    grant.maxRequests !== 1 ||
    grant.subject.id !== `profile:${analysis.row.userId}` ||
    BigInt(grant.subject.generation) !== analysis.row.userGeneration ||
    grant.resource.id !== `material-analysis:${analysis.row.id}` ||
    grant.resource.generation !== analysis.row.createdAt.getTime() ||
    grant.action !== `material-analysis:${row.identityDigest}`
  )
    throw new MaterialAnalysisConflict('The provider unit delegation changed.');
  return { ...analysis, unit: row, identity, grant };
}

/** Resolve only validated private ancestors. Callers never receive another unit's admission authority. */
export async function readMaterialAnalysisEffectiveUnits(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisAuthority
) {
  const analysis = await requireMaterialAnalysis(database, context);
  const rows = await database.materialAnalysisUnit.findMany({
    where: { analysisId: analysis.row.id },
    orderBy: { unitKey: 'asc' },
  });
  const units = [];
  const analyses = new Map([[analysis.row.id, analysis]]);
  for (const row of rows)
    units.push(
      (await loadUnit(database, { ...context, unitId: row.id }, new Set(), analyses)).unit
    );
  return units;
}
function grantStore(database: Prisma.TransactionClient, context: MaterialAnalysisUnitAuthority) {
  return new DelegationStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      `${SIDEDOOR_STATE_ID}:material-analysis-grant:${context.unitId}`
    ),
    authorize: async ({ grant }) => {
      const saved = await loadUnit(database, context);
      if (materialFocusAnalysisHash(saved.grant) !== materialFocusAnalysisHash(grant))
        throw new MaterialAnalysisConflict('The provider delegation receipt changed.');
    },
  });
}

export async function createMaterialAnalysisUnit(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisAuthority,
  prepared: PreparedMaterialFocusChunk
) {
  const analysis = await requireMaterialAnalysis(database, context);
  if (
    !analysis.prepared ||
    analysis.prepared.identityDigest !== prepared.analysis.identityDigest ||
    !active.has(analysis.row.status)
  )
    throw new MaterialAnalysisConflict('This analysis is not admitting more work.');
  const identity = unitIdentity.parse({
    schemaVersion: 1,
    analysisId: analysis.row.id,
    analysisIdentityDigest: analysis.prepared.identityDigest,
    unitId: prepared.unit.id,
    inputDigest: prepared.inputDigest,
    mode: analysis.policy.cliBinding ? 'CLI' : 'HTTP',
    selection: analysis.policy.selection,
    cliBinding: analysis.policy.cliBinding,
    systemSha256: materialFocusAnalysisHash(prepared.system),
    messagesSha256: materialFocusAnalysisHash(prepared.messages),
    schemaSha256: materialFocusAnalysisHash(prepared.jsonSchema),
    maxOutputTokens: prepared.maxOutputTokens,
  });
  const identityDigest = materialFocusAnalysisHash(identity);
  const prior = await database.materialAnalysisUnit.findUnique({
    where: {
      analysisId_stage_unitKey: {
        analysisId: analysis.row.id,
        stage: 'DISCOVERY',
        unitKey: prepared.unit.id,
      },
    },
  });
  if (prior) {
    const saved = await loadUnit(database, { ...context, unitId: prior.id });
    if (saved.unit.identityDigest !== identityDigest)
      throw new MaterialAnalysisConflict('The provider request changed.');
    return saved.unit;
  }
  const stored = await database.materialAnalysisUnit.aggregate({
    where: { analysisId: analysis.row.id },
    _count: true,
  });
  if (stored._count >= MATERIAL_FOCUS_ANALYSIS_LIMITS.chunks)
    throw new MaterialAnalysisConflict('The analysis exhausted its declared unit budget.', 422);
  const id = randomUUID(),
    instance = await sottoStorageInstance(database).read();
  const grant = {
    id,
    revision: randomUUID(),
    instanceId: instance.instanceId,
    subject: {
      id: `profile:${analysis.row.userId}`,
      generation: Number(analysis.row.userGeneration),
    },
    resource: {
      id: `material-analysis:${analysis.row.id}`,
      generation: analysis.row.createdAt.getTime(),
    },
    operationId: id,
    action: `material-analysis:${identityDigest}`,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    maxRequests: 1,
  };
  const row = await database.materialAnalysisUnit.create({
    data: {
      id,
      analysisId: analysis.row.id,
      stage: 'DISCOVERY',
      unitKey: prepared.unit.id,
      identity,
      identityDigest,
      inputDigest: prepared.inputDigest,
      mode: identity.mode,
      grant,
    },
  });
  await grantStore(database, { ...context, unitId: id }).create(grant);
  return row;
}

async function admit(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisUnitAuthority,
  ai: CapturedLearningAi,
  attemptInput: { id: string; fingerprint: string }
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput),
    saved = await loadUnit(database, context);
  if (saved.unit.reuse !== null || !saved.grant)
    throw new MaterialAnalysisConflict('Inherited provider work cannot admit another request.');
  if (saved.unit.status !== 'READY') return { dispatch: false };
  if (!active.has(saved.row.status))
    throw new MaterialAnalysisConflict('This analysis stopped admitting provider work.');
  if (
    ai.provider !== saved.policy.selection.provider ||
    ai.model !== saved.policy.selection.model ||
    (ai.endpoint ?? null) !== (saved.policy.selection.endpoint ?? null) ||
    learningCredentialFingerprint(ai.execution.credential) !==
      saved.policy.selection.credentialFingerprint
  )
    throw new MaterialAnalysisConflict('The selected analysis provider changed.');
  if (ai.execution.credential)
    await validateSottoExecutionCredential(
      database,
      context.execution.authorize,
      ai.execution.credential,
      context.execution.signal
    );
  if (
    saved.unit.mode === 'CLI' &&
    attempt.fingerprint !==
      materialFocusAnalysisHash({
        inputDigest: saved.unit.inputDigest,
        selection: saved.policy.selection,
        binding: saved.policy.cliBinding,
      })
  )
    throw new MaterialAnalysisConflict('The exact CLI invocation changed.');
  const admitted = await grantStore(database, context).admit(
    delegationGrantBinding(saved.grant),
    attempt
  );
  if (!admitted.dispatch)
    throw new MaterialAnalysisConflict('The unit already consumed its one provider request.');
  await database.materialAnalysisUnit.update({
    where: { id: context.unitId },
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
  context: MaterialAnalysisUnitAuthority,
  attemptInput: { id: string; fingerprint: string },
  outcome: 'succeeded' | 'failed' | 'unknown',
  receipt?: LearningPreparationResponseReceipt | LearningCliReceipt
) {
  const attempt = delegationAttemptInputSchema.parse(attemptInput),
    saved = await loadUnit(database, context);
  if (saved.unit.reuse !== null || !saved.grant)
    throw new MaterialAnalysisConflict('Inherited provider work cannot settle a new request.');
  if (saved.unit.attemptId !== attempt.id || saved.unit.attemptFingerprint !== attempt.fingerprint)
    throw new MaterialAnalysisConflict('The provider response belongs to another attempt.');
  if ((outcome === 'succeeded' && !receipt) || (outcome === 'unknown' && receipt))
    throw new MaterialAnalysisConflict('The provider outcome has no matching response receipt.');
  let bytes: Buffer | undefined, metadata: Prisma.InputJsonObject | undefined;
  if (receipt && saved.unit.mode === 'HTTP') {
    if (!('bodyBase64' in receipt))
      throw new MaterialAnalysisConflict('The response channel changed.');
    restoreLearningPreparationResponse(receipt);
    if ((receipt.status >= 200 && receipt.status < 300) !== (outcome === 'succeeded'))
      throw new MaterialAnalysisConflict('The response status changed its outcome.');
    bytes = Buffer.from(receipt.bodyBase64, 'base64');
    metadata = responseMetadata.parse({
      status: receipt.status,
      statusText: receipt.statusText,
      headers: receipt.headers,
    });
  } else if (receipt) {
    if (
      !('binding' in receipt) ||
      receipt.inputDigest !== saved.unit.inputDigest ||
      receipt.attempt.id !== attempt.id ||
      receipt.attempt.fingerprint !== attempt.fingerprint ||
      materialFocusAnalysisHash(receipt.binding) !==
        materialFocusAnalysisHash(saved.policy.cliBinding)
    )
      throw new MaterialAnalysisConflict('The CLI response identity changed.');
    const response = cliResponse.parse(receipt.response);
    if (response.model !== saved.policy.selection.model)
      throw new MaterialAnalysisConflict('The response model changed.');
    bytes = Buffer.from(JSON.stringify(response), 'utf8');
    metadata = { schemaVersion: 1 };
  }
  if (
    bytes &&
    (bytes.length > MATERIAL_FOCUS_ANALYSIS_LIMITS.responseBytes ||
      Buffer.byteLength(JSON.stringify(metadata)) > 32 * 1024)
  )
    throw new MaterialAnalysisConflict('The provider response exceeds its private receipt budget.');
  const status = outcome.toUpperCase();
  if (saved.unit.status !== 'DISPATCHING') {
    if (
      saved.unit.status !== status ||
      !!saved.unit.responseBytes !== !!bytes ||
      (bytes &&
        (materialAnalysisBytesHash(bytes) !== saved.unit.responseSha256 ||
          materialFocusAnalysisHash(metadata) !==
            materialFocusAnalysisHash(saved.unit.responseMetadata)))
    )
      throw new MaterialAnalysisConflict('A settled provider outcome cannot change.');
    return;
  }
  await grantStore(database, context).settle(delegationGrantBinding(saved.grant), attempt, outcome);
  await database.materialAnalysisUnit.update({
    where: { id: context.unitId },
    data: {
      status,
      settledAt: new Date(),
      ...(bytes
        ? {
            responseBytes: Uint8Array.from(bytes),
            responseSha256: materialAnalysisBytesHash(bytes),
            responseKind: saved.unit.mode,
            responseMetadata: metadata,
          }
        : {}),
    },
  });
}

export function materialAnalysisHttpStore(
  context: MaterialAnalysisUnitAuthority,
  ai: CapturedLearningAi
) {
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
export function materialAnalysisCliStore(
  context: MaterialAnalysisUnitAuthority,
  ai: CapturedLearningAi,
  validateBinding: (
    database: Prisma.TransactionClient,
    expected: LearningCliReceipt['binding']
  ) => Promise<void>
) {
  return {
    admit: (database: Prisma.TransactionClient, attempt: { id: string; fingerprint: string }) =>
      admit(database, context, ai, attempt),
    settle: (
      database: Prisma.TransactionClient,
      attempt: { id: string; fingerprint: string },
      outcome: 'succeeded' | 'failed' | 'unknown',
      receipt?: LearningCliReceipt
    ) => settle(database, context, attempt, outcome, receipt),
    validateBinding,
  };
}

export async function readMaterialAnalysisResponse(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisUnitAuthority
) {
  const saved = await loadUnit(database, context),
    unit = saved.unit;
  if (!unit.responseBytes) return { ...saved, receipt: null };
  if (
    !['SUCCEEDED', 'FAILED', 'ANALYZED', 'OUTPUT_INVALID'].includes(unit.status) ||
    materialAnalysisBytesHash(unit.responseBytes) !== unit.responseSha256 ||
    unit.responseBytes.byteLength > MATERIAL_FOCUS_ANALYSIS_LIMITS.responseBytes ||
    unit.responseKind !== unit.mode ||
    !unit.attemptId ||
    !unit.attemptFingerprint
  )
    throw new MaterialAnalysisConflict('The saved provider response checksum or identity changed.');
  if (unit.mode === 'HTTP') {
    const receipt = {
      ...responseMetadata.parse(unit.responseMetadata),
      bodyBase64: Buffer.from(unit.responseBytes).toString('base64'),
      bodySha256: unit.responseSha256!,
    };
    restoreLearningPreparationResponse(receipt);
    return { ...saved, receipt: { kind: 'HTTP' as const, value: receipt } };
  }
  return {
    ...saved,
    receipt: {
      kind: 'CLI' as const,
      value: cliResponse.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unit.responseBytes))
      ),
    },
  };
}

export async function publishMaterialAnalysisUnit(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisUnitAuthority,
  result: unknown
) {
  const saved = await loadUnit(database, context),
    output = materialFocusChunkResultSchema.parse(result);
  if (
    output.unitId !== saved.unit.unitKey ||
    output.inputDigest !== saved.unit.inputDigest ||
    output.analysisIdentityDigest !== saved.row.identityDigest
  )
    throw new MaterialAnalysisConflict('The analyzed result belongs to another source unit.');
  const bytes = Buffer.from(JSON.stringify(output), 'utf8'),
    digest = materialAnalysisBytesHash(bytes);
  if (bytes.length > MATERIAL_FOCUS_ANALYSIS_LIMITS.responseBytes)
    throw new MaterialAnalysisConflict('The result exceeds its byte budget.');
  if (saved.unit.status === 'ANALYZED') {
    if (saved.unit.outputSha256 !== digest)
      throw new MaterialAnalysisConflict('An analyzed result cannot be rewritten.');
    return;
  }
  if (
    saved.unit.status !== 'SUCCEEDED' ||
    !saved.unit.responseBytes ||
    !active.has(saved.row.status)
  )
    throw new MaterialAnalysisConflict('A result requires a retained successful response.');
  await database.materialAnalysisUnit.update({
    where: { id: context.unitId },
    data: { status: 'ANALYZED', outputBytes: Uint8Array.from(bytes), outputSha256: digest },
  });
}

export function decodeMaterialAnalysisUnitOutput(unit: MaterialAnalysisUnit) {
  if (
    unit.status !== 'ANALYZED' ||
    !unit.outputBytes ||
    materialAnalysisBytesHash(unit.outputBytes) !== unit.outputSha256
  )
    throw new MaterialAnalysisConflict('The published unit output checksum changed.');
  return materialFocusChunkResultSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(unit.outputBytes))
  );
}

export async function markMaterialAnalysisUnitInvalid(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisUnitAuthority
) {
  const saved = await loadUnit(database, context);
  if (saved.unit.status === 'SUCCEEDED')
    await database.materialAnalysisUnit.update({
      where: { id: context.unitId },
      data: { status: 'OUTPUT_INVALID' },
    });
}
export async function markMaterialAnalysisUnitUnknown(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisUnitAuthority
) {
  const saved = await loadUnit(database, context);
  if (saved.unit.status === 'DISPATCHING')
    await database.materialAnalysisUnit.update({
      where: { id: context.unitId },
      data: { status: 'UNKNOWN', settledAt: new Date() },
    });
  await database.materialAnalysis.update({
    where: { id: context.analysisId },
    data: {
      status: 'RECOVERY_REQUIRED',
      failureReason:
        'A provider request has an unknown outcome. Its paid request cannot be repeated.',
    },
  });
}
