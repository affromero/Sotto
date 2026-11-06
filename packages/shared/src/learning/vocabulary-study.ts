import { z } from 'zod';

export const vocabularyStudyModeSchema = z.enum([
  'FLASHCARDS',
  'MEANING_RECALL',
  'WORD_RECALL',
  'LISTENING_RECALL',
]);
export type VocabularyStudyMode = z.infer<typeof vocabularyStudyModeSchema>;

export const vocabularyStudyRequestSchema = z
  .object({
    requestId: z.uuid(),
    mode: vocabularyStudyModeSchema.optional(),
    wordIds: z.array(z.string().min(1)).min(1).max(24).optional(),
  })
  .strict();

const actionFields = { expectedRevision: z.number().int().nonnegative() };
export const vocabularyStudyActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...actionFields,
      action: z.literal('ANSWER'),
      itemId: z.uuid(),
      answer: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z.object({ ...actionFields, action: z.literal('REVEAL'), itemId: z.uuid() }).strict(),
  z
    .object({
      ...actionFields,
      action: z.literal('RATE'),
      itemId: z.uuid(),
      rating: z.enum(['KNOWN', 'UNKNOWN']),
    })
    .strict(),
  z.object({ ...actionFields, action: z.literal('COMPLETE') }).strict(),
]);
export type VocabularyStudyAction = z.infer<typeof vocabularyStudyActionSchema>;

export const vocabularyExamplesRequestSchema = z
  .object({
    operationId: z.uuid(),
    retryOf: z.uuid().nullable(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const vocabularyExamplesResponseSchema = z
  .object({
    status: z.enum(['AVAILABLE', 'PENDING', 'READY', 'FAILED']),
    request: vocabularyExamplesRequestSchema,
    canRetry: z.boolean(),
    error: z.string().optional(),
    examples: z
      .array(z.object({ sentence: z.string(), translation: z.string().nullable() }).strict())
      .length(2)
      .optional(),
  })
  .strict();
export type VocabularyExamplesResponse = z.infer<typeof vocabularyExamplesResponseSchema>;

export const vocabularyRefillRequestSchema = z
  .object({
    operationId: z.uuid(),
    generation: z.number().int().positive(),
    triggerSessionId: z.string().nullable(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const vocabularyRefillResponseSchema = z
  .object({
    status: z.enum(['NOT_NEEDED', 'AVAILABLE', 'PENDING', 'READY', 'FAILED']),
    canRetry: z.boolean(),
    request: vocabularyRefillRequestSchema.optional(),
    added: z.number().int().nonnegative().optional(),
    nextSessionId: z.uuid().optional(),
    wordIds: z.array(z.string().min(1)).min(1).max(8).optional(),
    error: z.string().optional(),
  })
  .strict();
export type VocabularyRefillResponse = z.infer<typeof vocabularyRefillResponseSchema>;

export const vocabularyStudyFeedbackSchema = z.object({
  outcome: z.enum(['STUDIED', 'ANSWERED', 'REVEALED']),
  lemma: z.string(),
  meaning: z.string(),
  acceptedMeanings: z.array(z.string()),
  answer: z.string(),
  correct: z.boolean().nullable(),
  selfRating: z.enum(['KNOWN', 'UNKNOWN']).optional(),
  reviewedAt: z.iso.datetime(),
});

export const vocabularyStudyCardSchema = z.object({
  id: z.uuid(),
  prompt: z.string(),
  feedback: vocabularyStudyFeedbackSchema.nullable(),
});

export const vocabularyStudyReceiptSchema = z.object({
  version: z.literal(1),
  type: z.literal('VOCABULARY_STUDY'),
  mode: vocabularyStudyModeSchema,
  score: z.number().min(0).max(1).nullable(),
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  reviewed: z.number().int().nonnegative(),
  studied: z.number().int().nonnegative(),
  completedAt: z.iso.datetime(),
});

export const vocabularyStudySessionSchema = z.object({
  status: z.literal('ready_vocabulary'),
  kind: z.literal('VOCAB'),
  sessionId: z.uuid(),
  courseId: z.string(),
  profileId: z.string().optional(),
  mode: vocabularyStudyModeSchema,
  selfRatingSupported: z.boolean().optional(),
  ratingSummary: z
    .object({
      known: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
      studied: z.number().int().nonnegative(),
    })
    .optional(),
  nativeLang: z.string(),
  targetLang: z.string(),
  progressRevision: z.number().int().nonnegative(),
  writingDrafts: z.record(z.string(), z.string()),
  cards: z.array(vocabularyStudyCardSchema).min(1).max(24),
  receipt: vocabularyStudyReceiptSchema.nullable(),
});
export type VocabularyStudySession = z.infer<typeof vocabularyStudySessionSchema>;
