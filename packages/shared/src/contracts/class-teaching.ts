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
