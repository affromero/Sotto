import { z } from 'zod';

const phrase = z.string().trim().min(1).max(800);
const explanation = z.string().trim().min(1).max(1800);

/** A reviewed lesson, retained with the class that its exercises assess. */
export const classTeachingSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(160),
    explanation,
    workedExamples: z
      .array(z.object({ prompt: phrase, answer: phrase, explanation }).strict())
      .min(2)
      .max(3),
    commonMistake: z.object({ incorrect: phrase, correction: phrase, explanation }).strict(),
    guidedPractice: z
      .object({ prompt: phrase, hint: phrase, answer: phrase, explanation })
      .strict(),
  })
  .strict();

export type ClassTeaching = z.infer<typeof classTeachingSchema>;

/** Optional native-language scaffolding. Target sentences remain in the accepted lesson. */
export const classLessonHelpSchema = z
  .object({
    title: explanation,
    explanation: z.string().trim().min(1).max(6000),
    workedExamples: z
      .array(
        z
          .object({
            prompt: explanation,
            meaning: explanation,
            explanation,
          })
          .strict()
      )
      .min(2)
      .max(3),
    correctionExplanation: explanation,
    guidedPrompt: explanation,
    guidedHint: explanation,
  })
  .strict();

export type ClassLessonHelp = z.infer<typeof classLessonHelpSchema>;

export const classLessonHelpRequestSchema = z
  .object({
    operationId: z.uuid(),
    attempt: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    retryOf: z.uuid().nullable(),
  })
  .strict();

export const classLessonHelpResponseSchema = z
  .object({
    status: z.enum(['AVAILABLE', 'PENDING', 'READY', 'FAILED']),
    request: classLessonHelpRequestSchema,
    nativeLang: z.string().min(1),
    targetLang: z.string().min(1),
    canRetry: z.boolean(),
    help: classLessonHelpSchema.optional(),
    error: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'READY' && !value.help)
      context.addIssue({ code: 'custom', message: 'Ready help requires its saved content.' });
    if (value.status === 'FAILED' && !value.error)
      context.addIssue({ code: 'custom', message: 'Failed help requires an explanation.' });
  });

export type ClassLessonHelpResponse = z.infer<typeof classLessonHelpResponseSchema>;
