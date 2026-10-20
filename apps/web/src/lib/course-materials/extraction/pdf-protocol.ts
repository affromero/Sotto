import { z } from 'zod';
import { materialPageTextManifestSchema } from '@sotto/shared';

export const materialPdfDefaultLimits = Object.freeze({
  maxFileBytes: 100 * 1024 * 1024,
  maxPages: 1000,
  maxPixels: 8_000_000,
  maxDimension: 8192,
  renderScale: 1,
  maxPageTextBytes: 64 * 1024 * 1024,
  maxArtifactBytes: 512 * 1024 * 1024,
  heapMiB: 512,
  timeoutMs: 600_000,
  maxProcessOutputBytes: 65_536,
});
const bounded = (maximum: number) => z.number().int().positive().max(maximum);
export const materialPdfLimitsSchema = z
  .object({
    maxFileBytes: bounded(materialPdfDefaultLimits.maxFileBytes),
    maxPages: bounded(materialPdfDefaultLimits.maxPages),
    maxPixels: bounded(materialPdfDefaultLimits.maxPixels),
    maxDimension: bounded(materialPdfDefaultLimits.maxDimension),
    renderScale: z.number().min(0.25).max(4),
    maxPageTextBytes: bounded(materialPdfDefaultLimits.maxPageTextBytes),
    maxArtifactBytes: bounded(materialPdfDefaultLimits.maxArtifactBytes),
    heapMiB: z.number().int().min(128).max(materialPdfDefaultLimits.heapMiB),
    timeoutMs: bounded(materialPdfDefaultLimits.timeoutMs),
    maxProcessOutputBytes: bounded(materialPdfDefaultLimits.maxProcessOutputBytes),
  })
  .strict();

export const materialPdfRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pdfPath: z.string().min(1),
    directory: z.string().min(1),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    limits: materialPdfLimitsSchema,
  })
  .strict();

const artifact = z
  .object({
    file: z.string().regex(/^[a-z0-9.-]+$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().nonnegative(),
  })
  .strict();
const diagnostic = z.enum([
  'TEXT_EXTRACTION_FAILED',
  'TEXT_EXTRACTION_WARNING',
  'RENDER_FAILED',
  'RENDER_WARNING',
  'RENDER_BOUNDS',
  'PAGE_FAILED',
  'ANNOTATIONS_UNSUPPORTED',
  'PARSER_WARNING',
]);
export const materialPdfPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageNumber: z.number().int().positive(),
    width: z.number().positive().nullable(),
    height: z.number().positive().nullable(),
    rotation: z.number().finite().nullable(),
    text: z
      .object({
        state: z.enum(['EXTRACTED', 'FAILED']),
        manifest: materialPageTextManifestSchema.nullable(),
        artifact: artifact.nullable(),
        chunksArtifact: artifact.nullable(),
        positionsArtifact: artifact.nullable(),
      })
      .strict(),
    image: artifact
      .extend({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        scale: z.number().positive(),
        mimeType: z.literal('image/png'),
        rgbaSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .nullable(),
    annotationsArtifact: artifact.nullable(),
    annotationMeaningSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    annotationCount: z.number().int().nonnegative(),
    visualState: z.enum(['RECOGNITION_NEEDED', 'UNRESOLVED']),
    diagnostics: z.array(diagnostic).max(8),
  })
  .strict();

export const materialPdfResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
    originalBytes: z.number().int().positive(),
    pageCount: z.number().int().positive(),
    pages: z.array(artifact.extend({ pageNumber: z.number().int().positive() }).strict()).max(1000),
    unprocessed: z
      .object({
        firstPage: z.number().int().positive(),
        lastPage: z.number().int().positive(),
        reason: z.literal('UNSUPPORTED_PAGE_LIMIT'),
      })
      .strict()
      .nullable(),
    provenance: z
      .object({
        method: z.literal('PDFJS_PAGE_TEXT_AND_DISPLAY_RENDER'),
        version: z.string().min(1),
        renderIntent: z.literal('display'),
        annotationMode: z.literal('ENABLE'),
        textNormalization: z.literal('DISABLED'),
        recognition: z.literal('NOT_PERFORMED'),
        limits: materialPdfLimitsSchema,
        warningPolicyVersion: z.literal(1).optional(),
        warningReceipts: z
          .array(
            z
              .object({
                pageNumber: z.number().int().positive().nullable(),
                code: z.enum(['ANNOTATION_BORDER_WIDTH_NORMALIZED', 'UNKNOWN']),
                count: z.number().int().positive(),
                disposition: z.enum(['BLOCKING', 'APPEARANCE_AND_RAW_WIDTH_PRESERVED']),
              })
              .strict()
          )
          .max(2001)
          .optional(),
        documentFeatures: z
          .object({
            encrypted: z.boolean(),
            formsPresent: z.boolean(),
            xfaPresent: z.boolean(),
            signaturesPresent: z.boolean(),
            outlinePresent: z.boolean(),
            verificationUnsupported: z.array(
              z.enum([
                'ENCRYPTION',
                'FORMS',
                'XFA',
                'SIGNATURES',
                'OUTLINE',
                'ANNOTATION_RELATIONSHIPS',
                'ANNOTATION_REFERENCES',
                'PARSER_WARNINGS',
              ])
            ),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    const visited = Math.min(result.pageCount, result.provenance.limits.maxPages);
    if (
      result.pages.length !== visited ||
      result.pages.some((page, i) => page.pageNumber !== i + 1)
    )
      context.addIssue({
        code: 'custom',
        message: 'Every admitted PDF page needs its result.',
      });
    if (
      result.unprocessed
        ? result.unprocessed.firstPage !== visited + 1 ||
          result.unprocessed.lastPage !== result.pageCount
        : visited !== result.pageCount
    )
      context.addIssue({
        code: 'custom',
        message: 'Unprocessed PDF pages require exact coverage.',
      });
  });

export type MaterialPdfLimits = z.infer<typeof materialPdfLimitsSchema>;
export type MaterialPdfRequest = z.infer<typeof materialPdfRequestSchema>;
export type MaterialPdfPage = z.infer<typeof materialPdfPageSchema>;
export type MaterialPdfResult = z.infer<typeof materialPdfResultSchema>;
