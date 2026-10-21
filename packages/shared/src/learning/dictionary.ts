import { z } from 'zod';
import { vocabularySupportSchema } from './vocabulary-support';

export const dictionaryQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  state: z.enum(['all', 'unseen', 'learning', 'due', 'strong']).default('all'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const dictionaryMeaningSchema = z
  .object({
    translation: z.string().trim().min(1).max(2000),
    acceptedMeanings: z.array(z.string().trim().min(1).max(2000)).max(20),
  })
  .strict();
export const dictionaryWordSchema = z.object({
  id: z.string(),
  lemma: z.string(),
  translation: z.string(),
  acceptedMeanings: z.array(z.string()),
  partOfSpeech: z.string().nullable(),
  pronunciation: z.string().nullable(),
  mastery: z.number(),
  state: z.enum(['unseen', 'introduced', 'learning', 'due', 'strong']),
  dueAt: z.iso.datetime().nullable(),
  lastReviewed: z.iso.datetime().nullable(),
  reviews: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  sources: z.array(
    z.object({
      materialId: z.string(),
      name: z.string(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().positive(),
      quote: z.string(),
      coordinateSystem: z.enum(['UTF16', 'MATERIAL_CODEPOINTS']).optional(),
      meaning: z.string(),
    })
  ),
});
export type DictionaryWord = z.infer<typeof dictionaryWordSchema>;

export const vocabularyImportSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum([
    'NOT_INDEXED',
    'PENDING',
    'ACTIVE',
    'COMPLETE',
    'FAILED',
    'NEEDS_TEXT',
    'UNRESOLVED',
  ]),
  error: z.string().nullable(),
  processedChunks: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
});
export const dictionaryResponseSchema = z.object({
  words: z.array(dictionaryWordSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pages: z.number().int().positive(),
  counts: z.object({
    unseen: z.number().int().nonnegative(),
    due: z.number().int().nonnegative(),
    strong: z.number().int().nonnegative(),
  }),
  vocabularySupport: vocabularySupportSchema.nullable(),
  materials: z.array(vocabularyImportSchema),
});
export const dictionaryMeaningResponseSchema = z.object({ saved: z.literal(true) });
export const vocabularyWorkRequestSchema = z.object({ retry: z.boolean().default(false) }).strict();
export const vocabularyIndexResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(['PENDING', 'ACTIVE', 'COMPLETE', 'FAILED', 'NEEDS_TEXT', 'UNRESOLVED']),
  error: z.string().nullable(),
});
export const vocabularyAudioResponseSchema = z.object({
  status: z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED', 'UNRESOLVED']),
  error: z.string().nullable(),
});
