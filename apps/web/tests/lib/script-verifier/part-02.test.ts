import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  }),
}));

// ---- Import under test ----
import {
  verifyScript as verifyScriptImpl,
  assessReferenceQuality,
  getMinReferenceCount,
  getMinSeriousRatio,
  type ClaimAnalysis,
} from '@/lib/script-verifier';
import { hashTurn } from '@/lib/turn-diff';
import type { GeneratedReference } from '@/lib/script-generator';

const AI_RUNTIME = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
type VerifyScriptParams = Parameters<typeof verifyScriptImpl>[0];

function verifyScript(
  params: Omit<VerifyScriptParams, 'provider' | 'model'> &
    Partial<Pick<VerifyScriptParams, 'provider' | 'model'>>
) {
  return verifyScriptImpl({ ...AI_RUNTIME, ...params });
}

function makeRef(num: number, type: GeneratedReference['type']): GeneratedReference {
  return {
    number: num,
    title: `Reference ${num}`,
    authors: [`Author ${num}`],
    year: 2023,
    url: `https://example.com/ref${num}`,
    type,
    publisher: null,
    doi: type === 'PAPER' ? `10.1234/ref${num}` : null,
  };
}

function makePaperRefs(count: number, startNum = 1): GeneratedReference[] {
  return Array.from({ length: count }, (_, i) => makeRef(startNum + i, 'PAPER'));
}

// ---- Tests ----

describe('incremental verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends only changed turns to AI when previousClaims match unchanged turns', async () => {
    const unchangedTurn = { speaker: 'HOST', text: 'The sky is blue.' };
    const changedTurn = { speaker: 'EXPERT', text: 'New research shows X [1].' };

    const previousClaims: ClaimAnalysis[] = [
      {
        claimText: 'The sky is blue',
        turnIndex: 0,
        speaker: 'HOST',
        isCommonKnowledge: true,
        existingCitations: [],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'Common knowledge',
        turnHash: hashTurn('HOST', 'The sky is blue.'),
      },
    ];

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'New research shows X',
            turnIndex: 1,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [1],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'Well sourced',
          },
        ],
        overallScore: 0.9,
        feedback: '',
      }),
      inputTokens: 300,
      outputTokens: 150,
    });

    const result = await verifyScript({
      topic: 'Test',
      turns: [unchangedTurn, changedTurn],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 2,
      previousClaims,
    });

    // AI was called (for the changed turn)
    expect(mockGenerateResponse).toHaveBeenCalledTimes(1);
    // System prompt should contain incremental instructions
    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    expect(systemPrompt).toContain('INCREMENTAL VERIFICATION');
    expect(systemPrompt).toContain('Pre-verified turns');
    // Result should include both carried and new claims
    expect(result.totalClaims).toBe(2);
    expect(result.allClaims).toHaveLength(2);
  });

  it('skips AI call entirely when all turns are unchanged', async () => {
    const turns = [
      { speaker: 'HOST', text: 'Water boils at 100C.' },
      { speaker: 'EXPERT', text: 'That is correct [1].' },
    ];

    const previousClaims: ClaimAnalysis[] = [
      {
        claimText: 'Water boils at 100C',
        turnIndex: 0,
        speaker: 'HOST',
        isCommonKnowledge: true,
        existingCitations: [],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'Common knowledge',
        turnHash: hashTurn('HOST', 'Water boils at 100C.'),
      },
      {
        claimText: 'That is correct',
        turnIndex: 1,
        speaker: 'EXPERT',
        isCommonKnowledge: true,
        existingCitations: [1],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'Verified',
        turnHash: hashTurn('EXPERT', 'That is correct [1].'),
      },
    ];

    const result = await verifyScript({
      topic: 'Test',
      turns,
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 2,
      previousClaims,
    });

    // AI should NOT have been called
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(result.totalClaims).toBe(2);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.allClaims).toHaveLength(2);
  });

  it('carried claims have remapped turnIndex values', async () => {
    // Original: [A at 0, B at 1] → New: [NEW at 0, A at 1, B at 2]
    const turns = [
      { speaker: 'HOST', text: 'New intro.' },
      { speaker: 'HOST', text: 'Turn A.' },
      { speaker: 'EXPERT', text: 'Turn B [1].' },
    ];

    const previousClaims: ClaimAnalysis[] = [
      {
        claimText: 'claim A',
        turnIndex: 0,
        speaker: 'HOST',
        isCommonKnowledge: true,
        existingCitations: [],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'ok',
        turnHash: hashTurn('HOST', 'Turn A.'),
      },
      {
        claimText: 'claim B',
        turnIndex: 1,
        speaker: 'EXPERT',
        isCommonKnowledge: false,
        existingCitations: [1],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'ok',
        turnHash: hashTurn('EXPERT', 'Turn B [1].'),
      },
    ];

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'new intro claim',
            turnIndex: 0,
            speaker: 'HOST',
            isCommonKnowledge: true,
            existingCitations: [],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'ok',
          },
        ],
        overallScore: 0.9,
        feedback: '',
      }),
      inputTokens: 200,
      outputTokens: 100,
    });

    const result = await verifyScript({
      topic: 'Test',
      turns,
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 2,
      previousClaims,
    });

    expect(result.totalClaims).toBe(3);
    const claimA = result.allClaims.find((c) => c.claimText === 'claim A');
    const claimB = result.allClaims.find((c) => c.claimText === 'claim B');
    expect(claimA?.turnIndex).toBe(1); // remapped from 0→1
    expect(claimB?.turnIndex).toBe(2); // remapped from 1→2
  });

  it('re-analyzes turns whose carried claim had hasUnreliableSource even if turn text is unchanged', async () => {
    // Scenario: generator fixed reference [3] (blog → paper) but kept the sentence
    // text identical. The turn hash matches, so matchClaimsToTurns would carry the
    // old claim forward. Without the eviction logic the hard-fail on
    // unreliableSourceClaims.length > 0 would trigger even though the source is now good.
    const fixedTurn = { speaker: 'EXPERT', text: 'Serif fonts signal trustworthiness [3].' };
    const otherTurn = { speaker: 'HOST', text: 'Interesting!' };

    const previousClaims: ClaimAnalysis[] = [
      {
        claimText: 'Serif fonts signal trustworthiness',
        turnIndex: 0,
        speaker: 'EXPERT',
        isCommonKnowledge: false,
        existingCitations: [3],
        needsMoreCitations: false,
        hasUnreliableSource: true, // old blog source — now replaced by generator
        hasMisattribution: false,
        verificationNote: 'interviewguys.com is not acceptable for empirical claims',
        turnHash: hashTurn('EXPERT', fixedTurn.text), // same text → same hash
      },
      {
        claimText: 'filler',
        turnIndex: 1,
        speaker: 'HOST',
        isCommonKnowledge: true,
        existingCitations: [],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'ok',
        turnHash: hashTurn('HOST', otherTurn.text),
      },
    ];

    // AI re-analyzes turn 0 and now reports it as clean (reference fixed)
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Serif fonts signal trustworthiness',
            turnIndex: 0,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [3],
            needsMoreCitations: false,
            hasUnreliableSource: false, // fixed
            hasMisattribution: false,
            verificationNote: 'Monotype 2021 is a credible industry report',
          },
        ],
        overallScore: 0.9,
        feedback: 'PASS: sourcing improved',
      }),
      inputTokens: 300,
      outputTokens: 150,
    });

    const result = await verifyScript({
      topic: 'Font Psychology',
      turns: [fixedTurn, otherTurn],
      references: makePaperRefs(5),
      depth: 'quick_overview',
      audienceLevel: 'intermediate',
      attemptNumber: 2,
      previousClaims,
    });

    // AI must have been called (turn 0 evicted from carried and re-analyzed)
    expect(mockGenerateResponse).toHaveBeenCalledTimes(1);
    expect(result.unreliableSourceClaims).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it('falls back to full verification when previousClaims is empty', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Water boils at 100C',
            turnIndex: 0,
            speaker: 'HOST',
            isCommonKnowledge: true,
            existingCitations: [],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'Common knowledge',
          },
        ],
        overallScore: 1.0,
        feedback: '',
      }),
      inputTokens: 500,
      outputTokens: 300,
    });

    const result = await verifyScript({
      topic: 'Test',
      turns: [{ speaker: 'HOST', text: 'Water boils at 100C.' }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 2,
      previousClaims: [],
    });

    // Full verification — no incremental instructions
    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    expect(systemPrompt).not.toContain('INCREMENTAL VERIFICATION');
    expect(result.passed).toBe(true);
  });

  it('falls back to full verification when previousClaims is undefined', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [],
        overallScore: 1.0,
        feedback: '',
      }),
      inputTokens: 400,
      outputTokens: 200,
    });

    await verifyScript({
      topic: 'Test',
      turns: [{ speaker: 'HOST', text: 'Hello.' }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      previousClaims: undefined,
    });

    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    expect(systemPrompt).not.toContain('INCREMENTAL VERIFICATION');
  });

  it('computes correct merged score from carried + new claims', async () => {
    const turns = [
      { speaker: 'HOST', text: 'Unchanged turn.' },
      { speaker: 'EXPERT', text: 'Changed turn with bad sourcing.' },
    ];

    const previousClaims: ClaimAnalysis[] = [
      {
        claimText: 'carried claim',
        turnIndex: 0,
        speaker: 'HOST',
        isCommonKnowledge: false,
        existingCitations: [1],
        needsMoreCitations: false,
        hasUnreliableSource: false,
        hasMisattribution: false,
        verificationNote: 'ok',
        turnHash: hashTurn('HOST', 'Unchanged turn.'),
      },
    ];

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'unsourced claim',
            turnIndex: 1,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [],
            needsMoreCitations: true,
            hasUnreliableSource: false,
            verificationNote: 'No citation',
          },
        ],
        overallScore: 0.5,
        feedback: 'Add citations.',
      }),
      inputTokens: 300,
      outputTokens: 150,
    });

    const result = await verifyScript({
      topic: 'Test',
      turns,
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 2,
      previousClaims,
    });

    // 2 sourcing-required claims: 1 adequate + 1 unsupported = 0.5 score
    expect(result.score).toBe(0.5);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.allClaims).toHaveLength(2);
  });

  it('populates allClaims on full verification path', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'The earth is round',
            turnIndex: 0,
            speaker: 'HOST',
            isCommonKnowledge: true,
            existingCitations: [],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'Common knowledge',
          },
        ],
        overallScore: 1.0,
        feedback: '',
      }),
      inputTokens: 500,
      outputTokens: 300,
    });

    const result = await verifyScript({
      topic: 'Geography',
      turns: [{ speaker: 'HOST', text: 'The earth is round.' }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(result.allClaims).toHaveLength(1);
    expect(result.allClaims[0].turnHash).toBeDefined();
    expect(result.allClaims[0].turnHash).toHaveLength(64);
  });

  it('prepends FAIL: to feedback when reference ratio gate fails despite clean claims', async () => {
    // AI returns clean claims (no unreliable sources, score 0.9), but all WEB refs
    // for a standard depth that requires 40% serious (PAPER/BOOK/REPORT).
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Exercise improves cognition',
            turnIndex: 0,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [1, 2, 3, 4, 5],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            hasMisattribution: false,
            verificationNote: 'Well sourced',
          },
        ],
        overallScore: 0.9,
        feedback: 'Great sourcing overall.',
      }),
      inputTokens: 400,
      outputTokens: 200,
    });

    // All 5 refs are WEB — standard depth requires 40% serious, so ratioPassed=false
    const webRefs: GeneratedReference[] = Array.from({ length: 5 }, (_, i) =>
      makeRef(i + 1, 'WEB')
    );

    const result = await verifyScript({
      topic: 'Exercise',
      turns: [{ speaker: 'EXPERT', text: 'Exercise improves cognition [1,2,3,4,5].' }],
      references: webRefs,
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.referenceQuality.ratioPassed).toBe(false);
    expect(result.feedback).toMatch(/^FAIL:/);
  });

  it('lists correct unchanged turn indices for a 10-turn script with 2 changed turns', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'HOST' : 'EXPERT',
      text: `Turn ${i} content.`,
    }));

    // Previous claims for turns 0, 1, 2, 3, 4, 5, 6, 7 (8 unchanged, turns 8 and 9 changed)
    const previousClaims: ClaimAnalysis[] = Array.from({ length: 8 }, (_, i) => ({
      claimText: `Claim for turn ${i}`,
      turnIndex: i,
      speaker: i % 2 === 0 ? 'HOST' : 'EXPERT',
      isCommonKnowledge: true,
      existingCitations: [],
      needsMoreCitations: false,
      hasUnreliableSource: false,
      hasMisattribution: false,
      verificationNote: 'ok',
      turnHash: hashTurn(turns[i].speaker, turns[i].text),
    }));

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Claim for turn 8',
            turnIndex: 8,
            speaker: 'HOST',
            isCommonKnowledge: true,
            existingCitations: [],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            hasMisattribution: false,
            verificationNote: 'ok',
          },
          {
            claimText: 'Claim for turn 9',
            turnIndex: 9,
            speaker: 'EXPERT',
            isCommonKnowledge: true,
            existingCitations: [],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            hasMisattribution: false,
            verificationNote: 'ok',
          },
        ],
        overallScore: 1.0,
        feedback: '',
      }),
      inputTokens: 300,
      outputTokens: 150,
    });

    await verifyScript({
      topic: 'Test',
      turns,
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 2,
      previousClaims,
    });

    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    // Pre-verified should list turns 0-7 (all except 8 and 9)
    expect(systemPrompt).toContain('0, 1, 2, 3, 4, 5, 6, 7');
    // Turns requiring analysis should be 8 and 9
    expect(systemPrompt).toContain('8, 9');
    // Turns 8 and 9 should NOT appear in the pre-verified section (they are the changed ones)
    expect(systemPrompt).toContain('INCREMENTAL VERIFICATION');
  });

  it('stamps turnHash on claims from full verification', async () => {
    const turnText = 'Quantum computing uses qubits [1].';

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Quantum computing uses qubits',
            turnIndex: 0,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [1],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'ok',
          },
        ],
        overallScore: 0.95,
        feedback: '',
      }),
      inputTokens: 600,
      outputTokens: 300,
    });

    const result = await verifyScript({
      topic: 'Quantum',
      turns: [{ speaker: 'EXPERT', text: turnText }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    const expectedHash = hashTurn('EXPERT', turnText);
    expect(result.allClaims[0].turnHash).toBe(expectedHash);
  });
});

describe('getMinReferenceCount', () => {
  it('returns base count when no duration provided', () => {
    expect(getMinReferenceCount('standard')).toBe(5);
    expect(getMinReferenceCount('deep_dive')).toBe(10);
    expect(getMinReferenceCount('eli5')).toBe(2);
  });

  it('scales with duration', () => {
    expect(getMinReferenceCount('standard', 10)).toBe(10);
    expect(getMinReferenceCount('standard', 20)).toBe(20);
    expect(getMinReferenceCount('deep_dive', 10)).toBe(15);
    expect(getMinReferenceCount('quick_overview', 10)).toBe(7);
    expect(getMinReferenceCount('eli5', 10)).toBe(5);
  });

  it('uses base as floor for short durations', () => {
    expect(getMinReferenceCount('standard', 3)).toBe(5);
    expect(getMinReferenceCount('deep_dive', 5)).toBe(10);
    expect(getMinReferenceCount('eli5', 2)).toBe(2);
  });

  it('scales without cap', () => {
    expect(getMinReferenceCount('deep_dive', 30)).toBe(45);
    expect(getMinReferenceCount('standard', 60)).toBe(60);
    expect(getMinReferenceCount('deep_dive', 100)).toBe(150);
  });

  it('handles unknown depth with defaults', () => {
    expect(getMinReferenceCount('unknown')).toBe(5);
    expect(getMinReferenceCount('unknown', 15)).toBe(15);
  });
});

describe('getMinSeriousRatio', () => {
  it('returns base ratio when no tone provided', () => {
    expect(getMinSeriousRatio('standard')).toBe(0.4);
    expect(getMinSeriousRatio('deep_dive')).toBe(0.6);
    expect(getMinSeriousRatio('eli5')).toBe(0);
  });

  it('returns base ratio for non-creative tones', () => {
    expect(getMinSeriousRatio('standard', 'casual')).toBe(0.4);
    expect(getMinSeriousRatio('standard', 'professional')).toBe(0.4);
    expect(getMinSeriousRatio('standard', 'socratic')).toBe(0.4);
  });

  it('halves ratio for comedic/satirical/storytelling tones', () => {
    expect(getMinSeriousRatio('standard', 'satirical')).toBe(0.2);
    expect(getMinSeriousRatio('standard', 'comedic')).toBe(0.2);
    expect(getMinSeriousRatio('standard', 'storytelling')).toBe(0.2);
    expect(getMinSeriousRatio('deep_dive', 'satirical')).toBe(0.3);
  });

  it('never goes below zero', () => {
    expect(getMinSeriousRatio('eli5', 'satirical')).toBe(0);
    expect(getMinSeriousRatio('eli5', 'comedic')).toBe(0);
  });
});

describe('assessReferenceQuality with duration and tone', () => {
  it('requires more refs for longer episodes', () => {
    const refs = Array.from({ length: 5 }, (_, i) => makeRef(i + 1, 'PAPER'));
    const result = assessReferenceQuality(refs, 'standard', 15);
    expect(result.requiredCount).toBe(15);
    expect(result.countPassed).toBe(false);
  });

  it('passes when ref count meets duration-scaled minimum', () => {
    const refs = Array.from({ length: 10 }, (_, i) => makeRef(i + 1, 'PAPER'));
    const result = assessReferenceQuality(refs, 'standard', 10);
    expect(result.requiredCount).toBe(10);
    expect(result.countPassed).toBe(true);
  });

  it('lowers serious ratio for satirical tone', () => {
    const refs = [
      makeRef(1, 'PAPER'),
      makeRef(2, 'ARTICLE'),
      makeRef(3, 'ARTICLE'),
      makeRef(4, 'ARTICLE'),
      makeRef(5, 'ARTICLE'),
    ];
    const withoutTone = assessReferenceQuality(refs, 'standard');
    expect(withoutTone.requiredSeriousRatio).toBe(0.4);
    expect(withoutTone.ratioPassed).toBe(false);

    const withTone = assessReferenceQuality(refs, 'standard', undefined, 'satirical');
    expect(withTone.requiredSeriousRatio).toBe(0.2);
    expect(withTone.ratioPassed).toBe(true);
  });
});
