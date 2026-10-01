import { z } from 'zod';

export const readingVocabularySchema = z.object({
  sourceHash: z.string().length(64),
  passageText: z.string().min(1),
  words: z
    .array(
      z.object({
        lemma: z.string().trim().min(1),
        gloss: z.string().trim().min(1),
        pos: z.string().trim().min(1),
        sourceForm: z.string().min(1),
        questionIds: z.array(z.string().min(1)),
      })
    )
    .min(1)
    .max(12),
});

export type ReadingVocabulary = z.infer<typeof readingVocabularySchema>;
