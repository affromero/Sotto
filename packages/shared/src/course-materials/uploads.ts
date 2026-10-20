import { z } from 'zod';

export const materialUploadLimits = {
  version: 1,
  maxFiles: 10,
  maxFileBytes: 100 * 1024 * 1024,
  maxBatchBytes: 250 * 1024 * 1024,
  partBytes: 4 * 1024 * 1024,
} as const;

export const materialUploadLimitsSchema = z
  .object({
    version: z.literal(materialUploadLimits.version),
    maxFiles: z.literal(materialUploadLimits.maxFiles),
    maxFileBytes: z.literal(materialUploadLimits.maxFileBytes),
    maxBatchBytes: z.literal(materialUploadLimits.maxBatchBytes),
    partBytes: z.literal(materialUploadLimits.partBytes),
  })
  .strict();

export const materialUploadCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocol: z.literal('SOTTO_PARTS'),
    limits: materialUploadLimitsSchema,
    checksumAlgorithm: z.literal('sha256'),
    resumable: z.literal(true),
  })
  .strict();

export const materialUploadCapabilities = materialUploadCapabilitiesSchema.parse({
  schemaVersion: 1,
  protocol: 'SOTTO_PARTS',
  limits: materialUploadLimits,
  checksumAlgorithm: 'sha256',
  resumable: true,
});

export const materialUploadPartHeaders = {
  offset: 'x-sotto-upload-offset',
  byteSize: 'x-sotto-upload-bytes',
  sha256: 'x-sotto-upload-sha256',
} as const;

export const materialUploadSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const materialUploadFileSizeSchema = z
  .number()
  .int()
  .positive()
  .max(materialUploadLimits.maxFileBytes);
const partSize = z.number().int().positive().max(materialUploadLimits.partBytes);
const position = z.number().int().nonnegative();
const maximumParts = Math.ceil(materialUploadLimits.maxFileBytes / materialUploadLimits.partBytes);

export const materialUploadFileDeclarationSchema = z
  .object({
    clientId: z.uuid(),
    name: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(160),
    byteSize: materialUploadFileSizeSchema,
    sha256: materialUploadSha256Schema.optional(),
  })
  .strict();

/** This validates one declaration set. Admission must reserve the whole batch atomically. */
export const materialUploadBatchRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    files: z.array(materialUploadFileDeclarationSchema).min(1).max(materialUploadLimits.maxFiles),
  })
  .strict()
  .superRefine((batch, context) => {
    if (new Set(batch.files.map((file) => file.clientId)).size !== batch.files.length)
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'File client identities must be unique within an upload batch.',
      });
    if (
      batch.files.reduce((total, file) => total + file.byteSize, 0) >
      materialUploadLimits.maxBatchBytes
    )
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Declared materials exceed the upload batch byte limit.',
      });
  });

export const materialUploadStatusSchema = z.enum([
  'UPLOADING',
  'FINALIZING',
  'COMPLETE',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
]);

export const materialUploadPartMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    index: position,
    offset: position,
    byteSize: partSize,
    sha256: materialUploadSha256Schema,
  })
  .strict();

export const materialUploadPartIdentitySchema = materialUploadPartMetadataSchema
  .extend({ uploadId: z.uuid() })
  .strict();

export const materialUploadPartReceiptSchema = materialUploadPartIdentitySchema
  .extend({ committedAt: z.iso.datetime() })
  .strict();

export const materialUploadOriginalReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    uploadId: z.uuid(),
    materialId: z.uuid(),
    byteSize: materialUploadFileSizeSchema,
    sha256: materialUploadSha256Schema,
    publishedAt: z.iso.datetime(),
  })
  .strict();

export const materialUploadResumeSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.uuid(),
    uploadId: z.uuid(),
    materialId: z.uuid(),
    limitsVersion: z.literal(1),
    file: materialUploadFileDeclarationSchema,
    status: materialUploadStatusSchema,
    failureReason: z.string().max(1000).nullable().default(null),
    revision: position,
    expiresAt: z.iso.datetime(),
    parts: z.array(materialUploadPartReceiptSchema).max(maximumParts),
    original: materialUploadOriginalReceiptSchema.nullable(),
  })
  .strict()
  .superRefine((upload, context) => {
    if ((upload.status === 'COMPLETE') !== (upload.original !== null))
      context.addIssue({
        code: 'custom',
        path: ['original'],
        message: 'A completed upload requires its original publication receipt.',
      });
    if (
      upload.original &&
      (upload.original.uploadId !== upload.uploadId ||
        upload.original.materialId !== upload.materialId ||
        upload.original.byteSize !== upload.file.byteSize ||
        (upload.file.sha256 !== undefined && upload.original.sha256 !== upload.file.sha256))
    )
      context.addIssue({
        code: 'custom',
        path: ['original'],
        message: 'The original publication receipt must match this declared upload.',
      });
    if (upload.parts.some((part) => part.uploadId !== upload.uploadId))
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'Part receipts must belong to this upload.',
      });
    if (new Set(upload.parts.map((part) => part.index)).size !== upload.parts.length)
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'An upload can contain only one committed receipt for each part.',
      });
  });

export const materialUploadBatchReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.uuid(),
    requestId: z.uuid(),
    uploads: z.array(materialUploadResumeSchema).min(1).max(materialUploadLimits.maxFiles),
  })
  .strict()
  .superRefine((batch, context) => {
    if (batch.uploads.some((upload) => upload.batchId !== batch.batchId))
      context.addIssue({
        code: 'custom',
        path: ['uploads'],
        message: 'Upload batch identities differ.',
      });
    for (const identities of [
      batch.uploads.map((upload) => upload.uploadId),
      batch.uploads.map((upload) => upload.materialId),
      batch.uploads.map((upload) => upload.file.clientId),
    ])
      if (new Set(identities).size !== identities.length)
        context.addIssue({
          code: 'custom',
          path: ['uploads'],
          message: 'Upload, material, and client identities must be unique within a batch.',
        });
    if (
      batch.uploads.reduce((total, upload) => total + upload.file.byteSize, 0) >
      materialUploadLimits.maxBatchBytes
    )
      context.addIssue({
        code: 'custom',
        path: ['uploads'],
        message: 'Upload batch exceeds its byte limit.',
      });
  });

export const materialUploadCompletionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    expectedRevision: position,
  })
  .strict();

export type MaterialUploadCapabilities = z.infer<typeof materialUploadCapabilitiesSchema>;
export type MaterialUploadFileDeclaration = z.infer<typeof materialUploadFileDeclarationSchema>;
export type MaterialUploadBatchRequest = z.infer<typeof materialUploadBatchRequestSchema>;
export type MaterialUploadStatus = z.infer<typeof materialUploadStatusSchema>;
export type MaterialUploadPartMetadata = z.infer<typeof materialUploadPartMetadataSchema>;
export type MaterialUploadPartIdentity = z.infer<typeof materialUploadPartIdentitySchema>;
export type MaterialUploadPartReceipt = z.infer<typeof materialUploadPartReceiptSchema>;
export type MaterialUploadOriginalReceipt = z.infer<typeof materialUploadOriginalReceiptSchema>;
export type MaterialUploadResume = z.infer<typeof materialUploadResumeSchema>;
export type MaterialUploadBatchReceipt = z.infer<typeof materialUploadBatchReceiptSchema>;
export type MaterialUploadCompletionRequest = z.infer<typeof materialUploadCompletionRequestSchema>;
