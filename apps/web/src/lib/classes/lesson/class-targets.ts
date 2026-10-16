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

interface MemoryWord {
  lemma: string;
  mastery: number;
  reps: number;
  lastReviewed: Date | null;
}

/** Preserve the canonical due order and reserve room for new source-backed words. */
export function selectClassVocabulary(
  candidates: ClassTargets['vocab'],
  rankedDue: Array<{ lemma: string; translation: string; mastery: number }>,
  memory: readonly MemoryWord[],
  imported: boolean
): ClassTargets['vocab'] {
  const byLemma = new Map(candidates.map((word) => [word.lemma, word]));
  const previous = new Map(memory.map((word) => [word.lemma, word]));
  const review = rankedDue
    .filter((word) => {
      const stored = previous.get(word.lemma);
      return (
        word.mastery < 0.5 &&
        stored &&
        (stored.reps > 0 || stored.lastReviewed !== null) &&
        (!imported || byLemma.has(word.lemma))
      );
    })
    .map((word) => byLemma.get(word.lemma) ?? { lemma: word.lemma, gloss: word.translation });
  const fresh = [...byLemma.values()].filter((word) => {
    const stored = previous.get(word.lemma);
    return !stored || (stored.reps === 0 && stored.lastReviewed === null);
  });
  const selected = new Map<string, ClassTargets['vocab'][number]>();
  const add = (words: ClassTargets['vocab']) => {
    for (const word of words)
      if (selected.size < 8 && !selected.has(word.lemma)) selected.set(word.lemma, word);
  };
  add(review.slice(0, fresh.length ? 4 : 8));
  add(fresh);
  add(review);
  // When no new/struggling word is available, due words still provide useful retrieval.
  if (!selected.size)
    add(
      rankedDue
        .filter((word) => !imported || byLemma.has(word.lemma))
        .map((word) => byLemma.get(word.lemma) ?? { lemma: word.lemma, gloss: word.translation })
    );
  return [...selected.values()];
}

export function classTargetsFromSeed(seed: unknown): ClassTargets | undefined {
  if (!seed || typeof seed !== 'object' || !('classTargets' in seed)) return undefined;
  return classTargetsSchema.parse(seed.classTargets);
}
