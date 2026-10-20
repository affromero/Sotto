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
  z.object({ ...actionFields, action: z.literal('COMPLETE') }).strict(),
]);
export type VocabularyStudyAction = z.infer<typeof vocabularyStudyActionSchema>;

export const vocabularyStudyFeedbackSchema = z.object({
  outcome: z.enum(['STUDIED', 'ANSWERED', 'REVEALED']),
  lemma: z.string(),
  meaning: z.string(),
  acceptedMeanings: z.array(z.string()),
  answer: z.string(),
  correct: z.boolean().nullable(),
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
  mode: vocabularyStudyModeSchema,
  nativeLang: z.string(),
  targetLang: z.string(),
  progressRevision: z.number().int().nonnegative(),
  writingDrafts: z.record(z.string(), z.string()),
  cards: z.array(vocabularyStudyCardSchema).min(1).max(24),
  receipt: vocabularyStudyReceiptSchema.nullable(),
});
export type VocabularyStudySession = z.infer<typeof vocabularyStudySessionSchema>;
