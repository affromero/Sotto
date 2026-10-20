import { z } from 'zod';
import { MaterialRecognitionRequestError } from './errors';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import type { MaterialExtractionRun, Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { validateSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { enqueueMaterialExtraction } from '../extraction/admission';
import { materialOptimizationReceiptSchema } from '../optimization/admission';
import {
  captureMaterialRecognitionPolicy,
  materialRecognitionPolicySchema,
  type MaterialRecognitionPolicy,
} from './policy';
import { materialRecognitionHash } from './protocol';
import { validateMaterialRecognitionCapability } from './capabilities';

export const materialRecognitionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    expectedProcessingRevision: z.number().int().positive(),
    capabilitySha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

function response(run: MaterialExtractionRun) {
  return {
    materialId: run.materialId,
    runId: run.id,
    processingRevision: run.processingRevision,
    requestId: run.requestId,
    status: run.status,
    coverage: run.coverage,
  };
}

async function ownedMaterial(
  database: Prisma.TransactionClient,
  userId: string,
  materialId: string
) {
  await database.$queryRaw`SELECT id FROM "CourseMaterial" WHERE id = ${materialId} FOR UPDATE`;
  const material = await database.courseMaterial.findFirst({
    where: { id: materialId, userId, originalUrl: { not: null } },
  });
  if (!material?.originalSha256)
    throw new MaterialRecognitionRequestError(404, 'Material not found.');
  return material;
}

function replay(
  run: MaterialExtractionRun,
  input: z.infer<typeof materialRecognitionRequestSchema>
) {
  const policy = materialRecognitionPolicySchema.parse(run.recognitionPolicy);
  if (
    run.processingRevision !== input.expectedProcessingRevision + 1 ||
    materialRecognitionHash(policy.capability) !== input.capabilitySha256
  )
    throw new MaterialRecognitionRequestError(
      409,
      'This request ID belongs to a different recognition request.'
    );
  return response(run);
}

/** Explicit recognition creates a new source revision. A response replay never starts more page calls. */
export async function requestMaterialRecognition(
  request: Request,
  admission: AuthenticatedRequest,
  materialId: string,
  requestInput: z.infer<typeof materialRecognitionRequestSchema>
) {
  const input = materialRecognitionRequestSchema.parse(requestInput);
  const prior = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      await ownedMaterial(database, admission.userId, materialId);
      return database.materialExtractionRun.findUnique({
        where: { materialId_requestId: { materialId, requestId: input.requestId } },
      });
    },
    { signal: request.signal }
  );
  if (prior) return replay(prior, input);
  const execution = sottoRequestExecution(request, admission);
  const captured = await captureMaterialRecognitionPolicy(execution);
  if (materialRecognitionHash(captured.policy.capability) !== input.capabilitySha256)
    throw new MaterialRecognitionRequestError(
      409,
      'The reviewed configured model changed. Refresh recognition options.'
    );
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const material = await ownedMaterial(database, admission.userId, materialId);
      const existing = await database.materialExtractionRun.findUnique({
        where: { materialId_requestId: { materialId, requestId: input.requestId } },
      });
      if (existing) return replay(existing, input);
      if (material.processingRevision !== input.expectedProcessingRevision)
        throw new MaterialRecognitionRequestError(
          409,
          'This material processing revision changed. Refresh its status.'
        );
      if (material.mimeType !== 'application/pdf' && !/\.pdf$/i.test(material.name))
        throw new MaterialRecognitionRequestError(400, 'Page recognition requires a PDF original.');
      const current = await database.materialExtractionRun.findUnique({
        where: {
          materialId_processingRevision: {
            materialId,
            processingRevision: material.processingRevision,
          },
        },
      });
      if (!current || !['COMPLETE', 'PARTIAL'].includes(current.status))
        throw new MaterialRecognitionRequestError(
          409,
          'Finish or recover the current material processing before starting recognition.'
        );
      if (
        material.optimizationReceipt &&
        materialOptimizationReceiptSchema.parse(material.optimizationReceipt).status === 'QUEUED'
      )
        throw new MaterialRecognitionRequestError(
          409,
          'Wait for the admitted PDF optimization before starting recognition.'
        );
      await validateMaterialRecognitionCapability(database, captured.policy.capability);
      if (captured.ai.execution.credential)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          captured.ai.execution.credential,
          request.signal
        );
      await database.courseMaterial.update({
        where: { id: materialId },
        data: { processingRevision: { increment: 1 } },
      });
      const run = await enqueueMaterialExtraction(database, materialId, {
        policy: captured.policy,
        requestId: input.requestId,
      });
      return response(run);
    },
    { signal: request.signal }
  );
}

export function materialRecognitionOptions(policy: MaterialRecognitionPolicy) {
  return {
    capabilitySha256: materialRecognitionHash(policy.capability),
    provider: policy.selection.provider,
    model: policy.selection.model,
    minimumDpi: policy.capability.minimumDpi,
    maximumImageBytes: policy.capability.maxDecodedBytes,
    diagnostic:
      'Recognition makes one configured model request per supported page. Unreadable content remains unresolved.',
  };
}
