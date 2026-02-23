import { describe, it, expect } from 'vitest';
import { hashTurn, matchClaimsToTurns } from '@/lib/turn-diff';
import type { ClaimAnalysis } from '@/lib/script-verifier';

function makeClaim(overrides: Partial<ClaimAnalysis> & Pick<ClaimAnalysis, 'turnIndex' | 'turnHash'>): ClaimAnalysis {
  return {
    claimText: 'some claim',
    speaker: 'HOST',
    isCommonKnowledge: false,
    existingCitations: [1],
    needsMoreCitations: false,
    hasUnreliableSource: false,
    hasMisattribution: false,
    verificationNote: 'verified',
    ...overrides,
  };
}

describe('hashTurn', () => {
  it('produces stable hashes for identical input', () => {
    const h1 = hashTurn('HOST', 'Water boils at 100C.');
    const h2 = hashTurn('HOST', 'Water boils at 100C.');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it('produces different hashes for different text', () => {
    const h1 = hashTurn('HOST', 'Water boils at 100C.');
    const h2 = hashTurn('HOST', 'Water freezes at 0C.');
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different speakers', () => {
    const h1 = hashTurn('HOST', 'Hello world.');
    const h2 = hashTurn('EXPERT', 'Hello world.');
    expect(h1).not.toBe(h2);
  });

  it('is case-insensitive for speaker', () => {
    const h1 = hashTurn('HOST', 'Hello.');
    const h2 = hashTurn('host', 'Hello.');
    expect(h1).toBe(h2);
  });

  it('trims whitespace from text', () => {
    const h1 = hashTurn('HOST', 'Hello.');
    const h2 = hashTurn('HOST', '  Hello.  ');
    expect(h1).toBe(h2);
  });

  it('preserves citation markers in hash (sourcing matters)', () => {
    const h1 = hashTurn('HOST', 'Studies show X [1].');
    const h2 = hashTurn('HOST', 'Studies show X [2].');
    expect(h1).not.toBe(h2);
  });

  it('changes hash when citation is added', () => {
    const h1 = hashTurn('HOST', 'Studies show X.');
    const h2 = hashTurn('HOST', 'Studies show X [1].');
    expect(h1).not.toBe(h2);
  });
});

describe('matchClaimsToTurns', () => {
  it('carries all claims when turns are identical', () => {
    const turns = [
      { speaker: 'HOST', text: 'Hello world.' },
      { speaker: 'EXPERT', text: 'Interesting fact [1].' },
    ];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hashTurn('HOST', 'Hello world.'), claimText: 'claim A' }),
      makeClaim({ turnIndex: 1, turnHash: hashTurn('EXPERT', 'Interesting fact [1].'), claimText: 'claim B' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(carried).toHaveLength(2);
    expect(changedIndices.size).toBe(0);
    expect(carried[0].turnIndex).toBe(0);
    expect(carried[1].turnIndex).toBe(1);
  });

  it('flags all turns as changed when all are new', () => {
    const turns = [
      { speaker: 'HOST', text: 'Brand new turn.' },
      { speaker: 'EXPERT', text: 'Another new turn.' },
    ];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hashTurn('HOST', 'Old turn.'), claimText: 'old claim' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(carried).toHaveLength(0);
    expect(changedIndices.size).toBe(2);
    expect(changedIndices.has(0)).toBe(true);
    expect(changedIndices.has(1)).toBe(true);
  });

  it('remaps turnIndex correctly when a turn is inserted', () => {
    // Original: [A, B] → New: [NEW, A, B]
    const turns = [
      { speaker: 'HOST', text: 'New intro.' },
      { speaker: 'HOST', text: 'Turn A.' },
      { speaker: 'EXPERT', text: 'Turn B.' },
    ];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hashTurn('HOST', 'Turn A.'), claimText: 'claim A' }),
      makeClaim({ turnIndex: 1, turnHash: hashTurn('EXPERT', 'Turn B.'), claimText: 'claim B' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(changedIndices).toEqual(new Set([0])); // only the new intro
    expect(carried).toHaveLength(2);
    expect(carried[0].turnIndex).toBe(1); // A remapped from 0→1
    expect(carried[1].turnIndex).toBe(2); // B remapped from 1→2
  });

  it('remaps turnIndex when a turn is deleted', () => {
    // Original: [A, B, C] → New: [A, C] (B deleted)
    const turns = [
      { speaker: 'HOST', text: 'Turn A.' },
      { speaker: 'EXPERT', text: 'Turn C.' },
    ];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hashTurn('HOST', 'Turn A.'), claimText: 'claim A' }),
      makeClaim({ turnIndex: 1, turnHash: hashTurn('HOST', 'Turn B.'), claimText: 'claim B' }),
      makeClaim({ turnIndex: 2, turnHash: hashTurn('EXPERT', 'Turn C.'), claimText: 'claim C' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(changedIndices.size).toBe(0);
    expect(carried).toHaveLength(2);
    expect(carried[0].turnIndex).toBe(0); // A stays 0
    expect(carried[0].claimText).toBe('claim A');
    expect(carried[1].turnIndex).toBe(1); // C remapped from 2→1
    expect(carried[1].claimText).toBe('claim C');
  });

  it('handles duplicate turns with greedy consumption', () => {
    // Two identical turns in both old and new
    const turns = [
      { speaker: 'HOST', text: 'Repeated line.' },
      { speaker: 'HOST', text: 'Repeated line.' },
    ];
    const hash = hashTurn('HOST', 'Repeated line.');
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hash, claimText: 'claim from first' }),
      makeClaim({ turnIndex: 1, turnHash: hash, claimText: 'claim from second' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(changedIndices.size).toBe(0);
    expect(carried).toHaveLength(2);
    expect(carried[0].turnIndex).toBe(0);
    expect(carried[0].claimText).toBe('claim from first');
    expect(carried[1].turnIndex).toBe(1);
    expect(carried[1].claimText).toBe('claim from second');
  });

  it('marks extra duplicate turns as changed', () => {
    // New has 3 copies, old had 2
    const turns = [
      { speaker: 'HOST', text: 'Repeated.' },
      { speaker: 'HOST', text: 'Repeated.' },
      { speaker: 'HOST', text: 'Repeated.' },
    ];
    const hash = hashTurn('HOST', 'Repeated.');
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hash, claimText: 'first' }),
      makeClaim({ turnIndex: 1, turnHash: hash, claimText: 'second' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(carried).toHaveLength(2);
    expect(changedIndices).toEqual(new Set([2])); // third copy is new
  });

  it('handles reordered turns with remapped indices', () => {
    // Original: [A, B] → New: [B, A]
    const turns = [
      { speaker: 'EXPERT', text: 'Turn B.' },
      { speaker: 'HOST', text: 'Turn A.' },
    ];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hashTurn('HOST', 'Turn A.'), claimText: 'claim A' }),
      makeClaim({ turnIndex: 1, turnHash: hashTurn('EXPERT', 'Turn B.'), claimText: 'claim B' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(changedIndices.size).toBe(0);
    expect(carried).toHaveLength(2);
    // B is now at index 0, A at index 1
    const claimB = carried.find((c) => c.claimText === 'claim B');
    const claimA = carried.find((c) => c.claimText === 'claim A');
    expect(claimB?.turnIndex).toBe(0);
    expect(claimA?.turnIndex).toBe(1);
  });

  it('skips claims without turnHash', () => {
    const turns = [{ speaker: 'HOST', text: 'Hello.' }];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: undefined, claimText: 'no hash claim' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(carried).toHaveLength(0);
    expect(changedIndices).toEqual(new Set([0]));
  });

  it('handles empty previousClaims', () => {
    const turns = [
      { speaker: 'HOST', text: 'Hello.' },
      { speaker: 'EXPERT', text: 'World.' },
    ];

    const { carried, changedIndices } = matchClaimsToTurns([], turns);
    expect(carried).toHaveLength(0);
    expect(changedIndices.size).toBe(2);
  });

  it('carries multiple claims from the same turn', () => {
    const hash = hashTurn('EXPERT', 'Two facts here [1][2].');
    const turns = [{ speaker: 'EXPERT', text: 'Two facts here [1][2].' }];
    const prevClaims: ClaimAnalysis[] = [
      makeClaim({ turnIndex: 0, turnHash: hash, claimText: 'fact 1' }),
      makeClaim({ turnIndex: 0, turnHash: hash, claimText: 'fact 2' }),
    ];

    const { carried, changedIndices } = matchClaimsToTurns(prevClaims, turns);
    expect(carried).toHaveLength(2);
    expect(changedIndices.size).toBe(0);
  });
});
