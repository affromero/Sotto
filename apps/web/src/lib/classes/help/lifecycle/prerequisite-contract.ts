import { z } from 'zod';
import { classPrerequisiteContentSchema } from '@sotto/shared';

export const prerequisiteAddendumSchema = classPrerequisiteContentSchema;

const baseText = (limit: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\uD800-\uDFFF]*$/u);

/** Bound the author's complete output so the mandatory review always fits. */
export const prerequisiteBaseAddendumSchema = z
  .object({
    title: baseText(120),
    explanation: baseText(2800),
    examples: z
      .array(
        z
          .object({
            target: baseText(250),
            meaning: baseText(250),
            explanation: baseText(500),
          })
          .strict()
      )
      .min(1)
      .max(3),
  })
  .strict();

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const prerequisiteOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('READY'), sourceHash: digest, contentHash: digest }).strict(),
  z
    .object({
      status: z.literal('FAILED'),
      sourceHash: digest,
      failure: z.enum(['UNSAFE', 'FAILED']).optional(),
    })
    .strict(),
]);

export const storedPrerequisiteAddendumSchema = z
  .object({
    version: z.literal(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    content: prerequisiteAddendumSchema,
    acknowledgment: z
      .object({
        userId: z.string().min(1),
        sourceHash: digest,
        contentHash: digest,
        receiptId: z.uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();
