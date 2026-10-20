import { z } from 'zod';

/** Private learning targets shared by teaching and every skill in this class. */
const classTargetsSchema = z
  .object({
    vocab: z
      .array(
        z
          .object({
            lemma: z.string().trim().min(1),
            gloss: z.string(),
            pos: z.string().optional(),
          })
          .strict()
      )
      .max(8),
    grammarPoints: z.array(z.string().trim().min(1)),
  })
  .strict();

export type ClassTargets = z.infer<typeof classTargetsSchema>;

export function classTargetsFromSeed(seed: unknown): ClassTargets | undefined {
  if (!seed || typeof seed !== 'object' || !('classTargets' in seed)) return undefined;
  return classTargetsSchema.parse(seed.classTargets);
}
