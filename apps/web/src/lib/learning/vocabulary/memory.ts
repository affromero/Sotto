interface VocabularyExposure {
  reps: number;
  lastReviewed: Date | null;
  firstSeenClassId: string | null;
  introducedAt?: Date | null;
}

export function isVocabularyIntroduced(word: VocabularyExposure): boolean {
  return (
    word.reps > 0 ||
    word.lastReviewed !== null ||
    word.firstSeenClassId !== null ||
    word.introducedAt != null
  );
}

export function introducedVocabularyWhere() {
  return {
    OR: [
      { introducedAt: { not: null } },
      { lastReviewed: { not: null } },
      { reps: { gt: 0 } },
      { firstSeenClassId: { not: null } },
    ],
  };
}

export function unseenVocabularyWhere() {
  return { introducedAt: null, reps: 0, lastReviewed: null, firstSeenClassId: null };
}
