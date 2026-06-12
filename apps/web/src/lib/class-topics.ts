import { prisma } from './prisma';

export interface ClassTopic {
  /** Display label for the suggestion chip. */
  label: string;
  /** The `topic` string passed to `createNextClass({ topic })`. */
  query: string;
}

// Shown when the learner has no stated interests yet; curiosity-driven fallback topics.
const FALLBACK_TOPICS: ClassTopic[] = [
  { label: 'Space exploration', query: 'space exploration' },
  { label: 'How memory works', query: 'how human memory works' },
  { label: 'Ocean life', query: 'ocean life and deep-sea creatures' },
  { label: 'A turning point in history', query: 'a fascinating turning point in world history' },
  { label: 'Everyday science', query: 'a surprising fact about everyday science' },
];

/**
 * Suggest class topics from the learner's stated interests (highest-weighted
 * first), so they can build a class about something they care about. Deterministic
 * and fast (no LLM) — the "interesting" part comes from the sourced content built
 * around the topic. Falls back to curiosity starters when there are no interests.
 */
export async function suggestClassTopics(userId: string, limit = 6): Promise<{ topics: ClassTopic[] }> {
  const interests = await prisma.userInterest.findMany({
    where: { userId },
    select: { tag: { select: { name: true } } },
    orderBy: { weight: 'desc' },
    take: limit,
  });

  const topics: ClassTopic[] = interests
    .map((i) => i.tag?.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ label: name, query: name }));

  return { topics: topics.length > 0 ? topics : FALLBACK_TOPICS };
}
