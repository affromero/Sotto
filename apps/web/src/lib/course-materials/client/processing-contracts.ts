import { z } from 'zod';
import {
  materialEmbeddedTextStateSchema,
  materialVisualCoverageSchema,
  materialPageTextManifestSchema,
} from '@sotto/shared';
import type { MaterialRecognitionCapability } from '@/lib/course-materials/recognition/protocol';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
export const optimizationReceiptSchema = z.object({
  status: z.enum([
    'QUEUED',
    'OPTIMIZED',
    'UNAVAILABLE',
    'UNCHANGED',
    'FAILED',
    'RECOVERY_REQUIRED',
  ]),
  originalSha256: sha,
  diagnostic: z.string().optional(),
  originalBytes: count.optional(),
  optimizedBytes: count.optional(),
  savedBytes: count.optional(),
});
const processingPageSchema = z.object({
  pageNumber: count.positive(),
  embeddedText: materialEmbeddedTextStateSchema,
  visual: materialVisualCoverageSchema,
  recognition: z.object({ id: z.uuid(), mode: z.string(), status: z.string() }).nullable(),
  textStreams: z.array(materialPageTextManifestSchema.safeExtend({ id: z.string().min(1) })),
});
export const materialProcessingSchema = z.object({
  materialId: z.uuid(),
  processingRevision: count.positive(),
  originalSha256: sha.nullable(),
  status: z.string(),
  diagnostic: z.string().nullable(),
  optimization: optimizationReceiptSchema.nullable(),
  run: z.object({ id: z.uuid(), status: z.string(), pageCount: count.nullable() }).nullable(),
  pages: z.array(processingPageSchema).max(100),
  nextPage: count.positive().nullable(),
});
export type MaterialProcessing = z.infer<typeof materialProcessingSchema>;
export type ProcessingPage = z.infer<typeof processingPageSchema>;
export const pageTextSchema = z.object({
  runId: z.uuid(),
  manifest: materialPageTextManifestSchema,
  chunks: z
    .array(
      z.object({
        index: count,
        codePointStart: count,
        codePointEnd: count,
        utf8ByteStart: count,
        utf8ByteEnd: count,
        sha256: sha,
        text: z.string(),
      })
    )
    .max(8),
  nextIndex: count.nullable(),
});
export const recognitionOptionsSchema = z.object({
  capabilitySha256: sha,
  provider: z.string().min(1),
  model: z.string().min(1),
  minimumDpi: count.positive(),
  maximumImageBytes: count.positive(),
  expectedProcessingRevision: count.positive(),
  maximumPageRequests: count.positive().nullable(),
  diagnostic: z.string(),
});
export type RecognitionOptions = z.infer<typeof recognitionOptionsSchema>;
export const recognitionReceiptSchema = z.object({
  materialId: z.uuid(),
  runId: z.uuid(),
  processingRevision: count.positive(),
  requestId: z.uuid(),
  status: z.string(),
});

/** Browser projection of the reviewed capability contract. The server revalidates every field. */
export const browserCapabilitySchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.literal('REVIEWED_MODEL_CAPABILITY'),
    reviewId: z.string().trim().min(1).max(200),
    revision: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
    endpoint: z.url().nullable(),
    vision: z.literal(true),
    handwriting: z.literal(true),
    maxImages: count.min(1).max(5),
    maxDecodedBytes: count.min(1).max(2_000_000),
    minimumDpi: count.min(72).max(1200),
    maxOutputTokens: count.min(256).max(32768),
  })
  .strict() satisfies z.ZodType<MaterialRecognitionCapability>;
export const recognitionRegistrySchema = z.object({
  revision: count,
  capabilities: z
    .array(
      z.object({
        capability: browserCapabilitySchema,
        documentationUrl: z.url(),
        active: z.boolean(),
      })
    )
    .max(100),
});
export type RecognitionRegistry = z.infer<typeof recognitionRegistrySchema>;

export async function materialResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      error.success ? error.data.error : `Material request failed (${response.status}).`
    );
  }
  return body;
}
