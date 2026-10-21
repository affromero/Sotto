import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { enqueueDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import { isTextMaterial } from '@/lib/note-upload';
import { materialRecognitionHash } from '../recognition/protocol';
import type { MaterialRecognitionPolicy } from '../recognition/policy';

export const materialExtractionPayloadSchema = z
  .object({
    userId: z.string().min(1),
    materialId: z.uuid(),
    runId: z.uuid(),
    processingRevision: z.number().int().positive(),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function materialExtractionRunKey(input: {
  materialId: string;
  processingRevision: number;
  originalSha256: string;
  extractorVersion: string;
  rendererVersion: string;
  recognition?: MaterialRecognitionPolicy;
}) {
  return materialRecognitionHash({
    materialId: input.materialId,
    revision: input.processingRevision,
    original: input.originalSha256,
    extractor: input.extractorVersion,
    renderer: input.rendererVersion,
    recognition: input.recognition ?? 'EXPLICIT_CONFIGURATION_REQUIRED',
  });
}

/** Retention and extraction admission commit together, without an external model call. */
export async function enqueueMaterialExtraction(
  database: Prisma.TransactionClient,
  materialId: string,
  options: { policy?: MaterialRecognitionPolicy; requestId?: string } = {}
) {
  const material = await database.courseMaterial.findUniqueOrThrow({ where: { id: materialId } });
  if (!material.originalUrl || !material.originalSha256)
    throw new Error('Retain and verify the original before admitting extraction.');
  const textSource = isTextMaterial(material.name, material.mimeType);
  const extractorVersion = textSource
    ? 'sotto-complete-utf8-extraction-1'
    : 'sotto-pdf-page-extraction-1';
  const rendererVersion = textSource ? 'NO_VISUAL_LAYER:1' : 'sotto-pdf-display-render-1';
  const runKey = materialExtractionRunKey({
    materialId,
    processingRevision: material.processingRevision,
    originalSha256: material.originalSha256,
    extractorVersion,
    rendererVersion,
    recognition: options.policy,
  });
  const prior = await database.materialExtractionRun.findUnique({
    where: {
      materialId_processingRevision: {
        materialId,
        processingRevision: material.processingRevision,
      },
    },
  });
  if (prior && prior.runKey !== runKey)
    throw new Error('The admitted material extraction policy changed.');
  const run =
    prior ??
    (await database.materialExtractionRun.create({
      data: {
        id: randomUUID(),
        materialId,
        processingRevision: material.processingRevision,
        runKey,
        ...(options.requestId ? { requestId: options.requestId } : {}),
        originalSha256: material.originalSha256,
        extractorVersion,
        rendererVersion,
        recognitionPolicy: options.policy ?? {
          schemaVersion: 1,
          method: 'EXPLICIT_CONFIGURATION_REQUIRED',
        },
        ...(options.policy ? { providerSelection: options.policy.selection } : {}),
      },
    }));
  const payload = materialExtractionPayloadSchema.parse({
    userId: material.userId,
    materialId,
    runId: run.id,
    processingRevision: material.processingRevision,
    inputSha256: material.originalSha256,
  });
  if (!prior)
    await database.courseMaterial.update({
      where: { id: materialId },
      data: {
        processingStatus: 'QUEUED',
        processingError: null,
      },
    });
  await enqueueDurableQueueJob(database, {
    handler: 'material-extraction',
    type: 'extract_material_pages',
    payload,
    jobId: `material-extraction-${materialId}-${material.processingRevision}`,
    attempts: 2,
  });
  return run;
}
