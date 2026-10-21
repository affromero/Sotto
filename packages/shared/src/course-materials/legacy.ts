import { z } from 'zod';

export const retainedMaterialMetadataSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    fileUrl: z.string(),
    extractedText: z.literal(''),
    textRetained: z.boolean(),
    processingUrl: z.string(),
    legacyTextUrl: z.string().nullable(),
  })
  .strict();
export const courseNotesPageSchema = z
  .object({
    body: z.string().max(12000),
    materials: z.array(retainedMaterialMetadataSchema).max(20),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const legacyMaterialTextSchema = z
  .object({
    materialId: z.uuid(),
    origin: z.literal('LEGACY_EMBEDDED_TEXT'),
    offset: z.number().int().nonnegative(),
    totalCodePoints: z.number().int().nonnegative(),
    text: z.string().refine((text) => [...text].length <= 8192),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
