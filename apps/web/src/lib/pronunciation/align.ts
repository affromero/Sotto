// Pure token-level alignment between an expected phrase and an STT transcript.
// Needleman–Wunsch (global) alignment over normalized word tokens, producing
// per-token operations and coverage/error metrics. No I/O, no provider calls —
// this is the deterministic, unit-tested core of the pronunciation scorer.

export type AlignOp = 'match' | 'substitute' | 'delete' | 'insert';

export interface AlignedToken {
  op: AlignOp;
  /** Expected token (undefined for an inserted token the learner added). */
  expected?: string;
  /** Actual transcribed token (undefined for a deleted/omitted token). */
  actual?: string;
}

export interface AlignmentResult {
  tokens: AlignedToken[];
  matched: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  expectedCount: number;
  actualCount: number;
  /** Share of expected tokens correctly produced: matched / expectedCount (0..1). */
  accuracy: number;
  /** Word error rate: (sub + del + ins) / expectedCount, clamped to [0, 1]. */
  wordErrorRate: number;
}

/** Lowercase, NFC-normalize, and strip punctuation so "Straße," matches "strasse". */
export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}']/gu, '');
}

/** Split a phrase into normalized, non-empty word tokens. */
export function tokenize(phrase: string): string[] {
  return phrase
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

/**
 * Align two normalized token sequences with unit edit costs (sub = del = ins = 1,
 * match = 0). Backtraces the DP table to recover the operation list, preferring
 * diagonal moves on ties so matches/substitutions read left-to-right.
 */
export function alignTokens(expected: string[], actual: string[]): AlignmentResult {
  const m = expected.length;
  const n = actual.length;

  // cost[i][j] = min edits to align expected[0..i) with actual[0..j).
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) cost[i][0] = i;
  for (let j = 0; j <= n; j++) cost[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = cost[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1);
      const del = cost[i - 1][j] + 1;
      const ins = cost[i][j - 1] + 1;
      cost[i][j] = Math.min(sub, del, ins);
    }
  }

  const tokens: AlignedToken[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const isMatch = expected[i - 1] === actual[j - 1];
      const sub = cost[i - 1][j - 1] + (isMatch ? 0 : 1);
      if (cost[i][j] === sub) {
        tokens.push({
          op: isMatch ? 'match' : 'substitute',
          expected: expected[i - 1],
          actual: actual[j - 1],
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      tokens.push({ op: 'delete', expected: expected[i - 1] });
      i--;
      continue;
    }
    // Remaining case: insertion.
    tokens.push({ op: 'insert', actual: actual[j - 1] });
    j--;
  }
  tokens.reverse();

  let matched = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  for (const t of tokens) {
    if (t.op === 'match') matched++;
    else if (t.op === 'substitute') substitutions++;
    else if (t.op === 'delete') deletions++;
    else insertions++;
  }

  const expectedCount = m;
  const accuracy = expectedCount === 0 ? (actual.length === 0 ? 1 : 0) : matched / expectedCount;
  const errors = substitutions + deletions + insertions;
  const wordErrorRate = expectedCount === 0 ? (errors > 0 ? 1 : 0) : Math.min(1, errors / expectedCount);

  return {
    tokens,
    matched,
    substitutions,
    deletions,
    insertions,
    expectedCount,
    actualCount: n,
    accuracy,
    wordErrorRate,
  };
}

/** Convenience: tokenize both inputs, then align. */
export function alignPhrase(expectedPhrase: string, actualTranscript: string): AlignmentResult {
  return alignTokens(tokenize(expectedPhrase), tokenize(actualTranscript));
}
