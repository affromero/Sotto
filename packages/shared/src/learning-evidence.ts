import { z } from 'zod';

export const writingFeedbackSchema = z.object({
  text: z.string(),
  overallScore: z.number().finite().min(0).max(1),
  corrections: z.array(
    z.object({ old: z.string().min(1), new: z.string(), why: z.string().min(1) })
  ),
  feedback: z.string().min(1),
});

export const speakingEvidenceSchema = z.object({
  recordingId: z.string(),
  status: z.enum(['PENDING', 'GRADING', 'SCORED', 'FAILED']),
  transcript: z.string().nullable().optional(),
  overallScore: z.number().finite().min(0).max(1).nullable().optional(),
  rubricScores: z
    .object({
      accuracy: z.number().finite().min(0).max(1).optional(),
      completeness: z.number().finite().min(0).max(1).optional(),
      fluency: z.number().finite().min(0).max(1).optional(),
    })
    .nullable()
    .optional(),
  feedback: z.string().nullable().optional(),
});

export const practiceReceiptSchema = z.object({
  score: z.number().finite().min(0).max(1),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative().optional(),
  graded: z.number().int().nonnegative().optional(),
  writingFeedback: z
    .array(z.object({ promptId: z.string(), task: z.string(), grade: writingFeedbackSchema }))
    .optional(),
  speakingFeedback: z
    .array(
      z.object({ promptId: z.string(), targetPhrase: z.string(), evidence: speakingEvidenceSchema })
    )
    .optional(),
  itemFeedback: z
    .array(
      z.object({
        itemId: z.string(),
        prompt: z.string(),
        selectedIndex: z.number().int().nonnegative(),
        correctIndex: z.number().int().nonnegative(),
        selectedAnswer: z.string(),
        correctAnswer: z.string(),
        correct: z.boolean(),
        explanation: z.string(),
      })
    )
    .optional(),
});

export type WritingFeedback = z.infer<typeof writingFeedbackSchema>;
export type SpeakingEvidence = z.infer<typeof speakingEvidenceSchema>;
export type PracticeReceipt = z.infer<typeof practiceReceiptSchema>;

export const classReceiptSchema = z.object({
  passed: z.boolean(),
  overallScore: z.number().finite().min(0).max(1),
  passedSections: z.number().int().nonnegative(),
  totalSections: z.number().int().positive(),
  sections: z.array(
    z.object({
      id: z.string(),
      skill: z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']),
      score: z.number().finite().min(0).max(1),
      passed: z.boolean(),
    })
  ),
});
export type ClassReceipt = z.infer<typeof classReceiptSchema>;

export const practicePreparingSchema = z.object({
  status: z.literal('preparing'),
  sessionId: z.string(),
  preparationStatus: z.enum([
    'QUEUED',
    'RUNNING',
    'CANCELLING',
    'CANCELLED',
    'COMPLETED',
    'FAILED',
    'UNRESOLVED',
  ]),
  message: z.string(),
  canRecover: z.boolean(),
});
export type PracticePreparing = z.infer<typeof practicePreparingSchema>;

export const learningProgressRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    answers: z.record(z.string().min(1), z.number().int().min(0).max(3)).optional(),
    writingDrafts: z.record(z.string().min(1), z.string().max(4000)).optional(),
  })
  .strict()
  .refine((value) => value.answers !== undefined || value.writingDrafts !== undefined);
export const learningProgressResponseSchema = z.object({
  saved: z.literal(true),
  progressRevision: z.number().int().positive(),
});
export const practiceGenerationActionSchema = z
  .object({
    action: z.enum(['cancel', 'recover']),
    acknowledgeUnknownOutcome: z.boolean().optional(),
  })
  .strict();

export const classRegenerationRequestSchema = z.object({
  scope: z.enum(['class', 'sections']).optional(),
  expectedAttempt: z.number().int().positive(),
  pristineSnapshot: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const classRegenerationAcceptedSchema = z.object({
  started: z.literal(true),
  scope: z.enum(['class', 'sections']),
  status: z.literal('GENERATING'),
  operationId: z.uuid(),
  courseId: z.string(),
});
