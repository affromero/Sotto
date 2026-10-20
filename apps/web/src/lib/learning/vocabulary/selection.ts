import { isVocabularyIntroduced } from './memory';

export interface VocabularyTarget {
  lemma: string;
  gloss: string;
  pos?: string;
}

export interface VocabularyMemory {
  lemma: string;
  translation: string;
  partOfSpeech: string | null;
  mastery: number;
  reps: number;
  lastReviewed: Date | null;
  firstSeenClassId: string | null;
  introducedAt?: Date | null;
  dueAt: Date;
}

type RankedWord = { lemma: string; translation: string; mastery: number };
const SOLID_MASTERY = 0.85;
const WEAK_MASTERY = 0.5;

/** Weak active words set the pace; an unassessed import is only a new-word candidate. */
export function selectVocabularyTargets(
  candidates: readonly VocabularyTarget[],
  rankedDue: readonly RankedWord[],
  memory: readonly VocabularyMemory[],
  limit: number,
  now: Date
): VocabularyTarget[] {
  const previous = new Map(memory.map((word) => [word.lemma, word]));
  const active = memory.filter(isVocabularyIntroduced);
  const frontier = [...active].sort((a, b) => a.mastery - b.mastery).slice(0, limit);
  const readiness = frontier.length
    ? frontier.reduce((sum, word) => sum + word.mastery, 0) / frontier.length
    : SOLID_MASTERY;
  const allowance = Math.floor(
    Math.ceil(limit / 2) *
      Math.max(0, Math.min(1, (readiness - WEAK_MASTERY) / (SOLID_MASTERY - WEAK_MASTERY)))
  );
  const toTarget = (word: VocabularyMemory): VocabularyTarget => ({
    lemma: word.lemma,
    gloss: word.translation,
    ...(word.partOfSpeech ? { pos: word.partOfSpeech } : {}),
  });
  const review = new Map<string, VocabularyTarget>();
  for (const due of rankedDue) {
    const word = previous.get(due.lemma);
    if (word && isVocabularyIntroduced(word)) review.set(word.lemma, toTarget(word));
  }
  for (const word of frontier)
    if (
      !review.has(word.lemma) &&
      (word.mastery < SOLID_MASTERY || word.dueAt.getTime() <= now.getTime())
    )
      review.set(word.lemma, toTarget(word));

  const fresh = new Map<string, VocabularyTarget>();
  for (const word of [
    ...memory.filter((word) => !isVocabularyIntroduced(word)).map(toTarget),
    ...candidates,
  ]) {
    const stored = previous.get(word.lemma);
    if (word.lemma.trim() && !fresh.has(word.lemma) && (!stored || !isVocabularyIntroduced(stored)))
      fresh.set(word.lemma, word);
  }
  const newWords = [...fresh.values()].slice(0, allowance);
  const reviews = [...review.values()];
  return [...reviews.slice(0, limit - newWords.length), ...newWords].slice(0, limit);
}
