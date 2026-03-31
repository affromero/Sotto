import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  }),
}));

// ---- Import under test ----
import { verifyScript, assessReferenceQuality, getMinReferenceCount, getMinSeriousRatio, type ClaimAnalysis } from '@/lib/script-verifier';
import { hashTurn } from '@/lib/turn-diff';
import type { GeneratedReference } from '@/lib/script-generator';

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

describe('verifyScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables web search for fast verification', async () => {
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
        overallScore: 0.95,
        feedback: '',
      }),
      inputTokens: 500,
      outputTokens: 300,
    });

    await verifyScript({
      topic: 'Water Properties',
      turns: [{ speaker: 'HOST', text: 'Water boils at 100C.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        useWebSearch: false,
      })
    );
  });

  it('includes no-search verification instructions in system prompt', async () => {
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
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    expect(systemPrompt).toContain('do NOT have web search');
  });

  it('returns passed=true when all claims are common knowledge', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'The earth orbits the sun',
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
      topic: 'Astronomy Basics',
      turns: [{ speaker: 'HOST', text: 'The earth orbits the sun.' }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.commonKnowledgeClaims).toBe(1);
  });

  it('returns passed=false when unsupported claims exist', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: '73% of scientists agree',
            turnIndex: 0,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [],
            needsMoreCitations: true,
            hasUnreliableSource: false,
            verificationNote: 'No citation provided for specific statistic',
          },
        ],
        overallScore: 0.3,
        feedback: 'Add citation for the 73% statistic.',
      }),
      inputTokens: 600,
      outputTokens: 400,
    });

    const result = await verifyScript({
      topic: 'Science Survey',
      turns: [{ speaker: 'EXPERT', text: '73% of scientists agree.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.feedback).toContain('73%');
  });

  it('returns passed=false when unreliable sources are cited', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'AI will replace jobs',
            turnIndex: 0,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [1],
            needsMoreCitations: false,
            hasUnreliableSource: true,
            verificationNote: 'Wikipedia is not a reliable source',
          },
        ],
        overallScore: 0.4,
        feedback: 'Replace Wikipedia citation with peer-reviewed source.',
      }),
      inputTokens: 700,
      outputTokens: 350,
    });

    const result = await verifyScript({
      topic: 'AI Impact',
      turns: [{ speaker: 'EXPERT', text: 'AI will replace jobs [1].' }],
      references: [
        {
          number: 1,
          title: 'AI Wikipedia',
          authors: [],
          year: 2024,
          url: 'https://wikipedia.org/wiki/AI',
          type: 'WEB',
          publisher: null,
          doi: null,
        },
      ],
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.unreliableSourceClaims).toHaveLength(1);
  });

  it('passes but flags durationFeedback when script exceeds word count bounds', async () => {
    const longText = 'word '.repeat(2000); // ~2000 words, well above 1575 max for 10 min

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [],
        overallScore: 0.9,
        feedback: '',
      }),
      inputTokens: 800,
      outputTokens: 200,
    });

    const result = await verifyScript({
      topic: 'Long Script',
      turns: [{ speaker: 'HOST', text: longText }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      maxDurationMinutes: 10,
    });

    expect(result.passed).toBe(true);
    expect(result.durationFeedback).toContain('exceeds');
    expect(result.durationFeedback).toContain('Reduce');
  });

  it('passes but flags durationFeedback when script is too short', async () => {
    const shortText = 'word '.repeat(500); // ~500 words, well below 1425 min for 10 min

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [],
        overallScore: 0.9,
        feedback: '',
      }),
      inputTokens: 800,
      outputTokens: 200,
    });

    const result = await verifyScript({
      topic: 'Short Script',
      turns: [{ speaker: 'HOST', text: shortText }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      maxDurationMinutes: 10,
    });

    expect(result.passed).toBe(true);
    expect(result.durationFeedback).toContain('below');
    expect(result.durationFeedback).toContain('Expand');
  });

  it('passes when script is within tolerance', async () => {
    const okText = 'word '.repeat(1500); // ~1500 words, right at target for 10 min

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [],
        overallScore: 1.0,
        feedback: '',
      }),
      inputTokens: 800,
      outputTokens: 200,
    });

    const result = await verifyScript({
      topic: 'Good Script',
      turns: [{ speaker: 'HOST', text: okText }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      maxDurationMinutes: 10,
    });

    expect(result.passed).toBe(true);
    expect(result.durationFeedback).toBeNull();
  });

  it('handles unparseable AI response after retry', async () => {
    // Both calls return non-JSON — first attempt and stricter retry both fail
    mockGenerateResponse.mockResolvedValue({
      content: 'This is not valid JSON at all',
      inputTokens: 400,
      outputTokens: 100,
    });

    const result = await verifyScript({
      topic: 'Parse Error',
      turns: [{ speaker: 'HOST', text: 'Hello.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('could not parse');
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
  });

  it('passes jsonSchema to provider generateResponse', async () => {
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
      topic: 'Schema Test',
      turns: [{ speaker: 'HOST', text: 'Hello.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          name: 'verification_result',
          schema: expect.objectContaining({
            type: 'object',
            required: expect.arrayContaining(['claims', 'overallScore', 'feedback']),
          }),
        }),
      })
    );
  });

  it('sets failureType to parse_error on unparseable response', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Not JSON at all — just prose',
      inputTokens: 400,
      outputTokens: 100,
      model: 'test-model',
    });

    const result = await verifyScript({
      topic: 'Parse Error',
      turns: [{ speaker: 'HOST', text: 'Hello.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(result.failureType).toBe('parse_error');
    expect(result.feedback).toMatch(/^PARSE_ERROR:/);
  });

  it('does not set failureType on genuine verification failure', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Unsourced stat',
            turnIndex: 0,
            speaker: 'HOST',
            isCommonKnowledge: false,
            existingCitations: [],
            needsMoreCitations: true,
            hasUnreliableSource: false,
            verificationNote: 'No citation',
          },
        ],
        overallScore: 0.3,
        feedback: 'Add citations.',
      }),
      inputTokens: 600,
      outputTokens: 400,
    });

    const result = await verifyScript({
      topic: 'Real Failure',
      turns: [{ speaker: 'HOST', text: 'Some unsourced claim.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.failureType).toBeUndefined();
  });

  it('retries with stricter prompt when first response is not JSON, succeeds on retry', async () => {
    // First call returns prose, second returns valid JSON
    mockGenerateResponse
      .mockResolvedValueOnce({
        content: 'Here is my analysis of the script...',
        inputTokens: 400,
        outputTokens: 100,
        model: 'claude-haiku-4-5-20251001',
      })
      .mockResolvedValueOnce({
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
        model: 'claude-haiku-4-5-20251001',
      });

    const result = await verifyScript({
      topic: 'Water Properties',
      turns: [{ speaker: 'HOST', text: 'Water boils at 100C.' }],
      references: makePaperRefs(5),
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    // Second call should have stricter JSON instructions
    const secondSystemPrompt = mockGenerateResponse.mock.calls[1][0];
    expect(secondSystemPrompt).toContain('CRITICAL');
    // Result should have proper claims (not fallback)
    expect(result.passed).toBe(true);
    expect(result.totalClaims).toBe(1);
    expect(result.commonKnowledgeClaims).toBe(1);
    // Token counts should sum both calls
    expect(result.inputTokens).toBe(900); // 400 + 500
    expect(result.outputTokens).toBe(400); // 100 + 300
  });

  it('includes credential claim scrutiny in system prompt', async () => {
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
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    expect(systemPrompt).toContain('biographical claims');
    expect(systemPrompt).toContain('Credential Claims');
    expect(systemPrompt).toContain('REQUIRES_SOURCING');
    expect(systemPrompt).toContain('[VERIFIED]');
  });

  it('flags unverified credential claims as unsupported', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Dr. Smith is a professor of physics at MIT',
            turnIndex: 0,
            speaker: 'HOST',
            isCommonKnowledge: false,
            existingCitations: [],
            needsMoreCitations: true,
            hasUnreliableSource: false,
            verificationNote: 'Credential claim with no citation — cannot verify',
          },
        ],
        overallScore: 0.0,
        feedback: 'Remove or cite the credential claim about Dr. Smith.',
      }),
      inputTokens: 600,
      outputTokens: 400,
    });

    const result = await verifyScript({
      topic: 'Physics Discussion',
      turns: [{ speaker: 'HOST', text: 'Dr. Smith, a professor of physics at MIT, explains.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.unsupportedClaims[0].claimText).toContain('professor');
  });

  it('passes when verified credential claim has citations', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Dr. Smith is a professor of physics at MIT',
            turnIndex: 0,
            speaker: 'HOST',
            isCommonKnowledge: false,
            existingCitations: [1],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'Matches [VERIFIED] source in script — confirmed via MIT faculty page',
          },
        ],
        overallScore: 0.95,
        feedback: '',
      }),
      inputTokens: 700,
      outputTokens: 400,
    });

    const result = await verifyScript({
      topic: 'Physics Discussion',
      turns: [{ speaker: 'HOST', text: 'Dr. Smith, a professor of physics at MIT [1], explains.' }],
      references: [
        {
          number: 1,
          title: 'MIT Faculty Page - Dr. Smith',
          authors: [],
          year: 2025,
          url: 'https://mit.edu/physics/faculty/smith',
          type: 'WEB',
          publisher: null,
          doi: null,
        },
        ...makePaperRefs(4, 2),
      ],
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(true);
    expect(result.adequatelySourcedClaims).toBe(1);
  });

  it('includes reference attribution accuracy instructions in system prompt', async () => {
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
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
    });

    const systemPrompt = mockGenerateResponse.mock.calls[0][0];
    expect(systemPrompt).toContain('Reference Attribution Accuracy');
    expect(systemPrompt).toContain('hasMisattribution');
  });

  it('fails when claims have misattributed references', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'A paper from Google DeepMind shows transformers scale linearly',
            turnIndex: 2,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [1],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            hasMisattribution: true,
            verificationNote: 'Reference [1] is by OpenAI researchers, not Google DeepMind',
          },
        ],
        overallScore: 0.0,
        feedback: 'Fix misattribution: reference [1] is not from Google DeepMind.',
      }),
      inputTokens: 800,
      outputTokens: 500,
    });

    const result = await verifyScript({
      topic: 'Transformer Scaling',
      turns: [
        { speaker: 'HOST', text: 'So what does the research say?' },
        { speaker: 'EXPERT', text: 'Well, a paper from Google DeepMind [1] shows transformers scale linearly.' },
      ],
      references: [
        {
          number: 1,
          title: 'Scaling Laws for Neural Language Models',
          authors: ['Jared Kaplan', 'Sam McCandlish'],
          year: 2020,
          url: 'https://arxiv.org/abs/2001.08361',
          type: 'PAPER',
          publisher: 'OpenAI',
          doi: null,
        },
      ],
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.misattributedClaims).toHaveLength(1);
    expect(result.misattributedClaims[0].hasMisattribution).toBe(true);
    expect(result.feedback).toContain('MISATTRIBUTION');
  });

  it('passes apiKeyOverride to generateResponse', async () => {
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
      topic: 'BYOK Test',
      turns: [{ speaker: 'HOST', text: 'Test.' }],
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      apiKeyOverride: 'user-key-456',
    });

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ apiKeyOverride: 'user-key-456' })
    );
  });
});

describe('reference quality enforcement', () => {
  it('assessReferenceQuality passes for deep_dive with >= 10 refs and >= 60% serious', () => {
    const refs: GeneratedReference[] = [
      ...makePaperRefs(4),
      makeRef(5, 'BOOK'),
      makeRef(6, 'REPORT'),
      makeRef(7, 'PAPER'),
      makeRef(8, 'ARTICLE'),
      makeRef(9, 'WEB'),
      makeRef(10, 'PAPER'),
    ];
    const result = assessReferenceQuality(refs, 'deep_dive');
    expect(result.countPassed).toBe(true);
    expect(result.ratioPassed).toBe(true);
    expect(result.totalCount).toBe(10);
    expect(result.seriousCount).toBe(8);
    expect(result.feedback).toBeNull();
  });

  it('fails when reference count below minimum', () => {
    const refs = makePaperRefs(3);
    const result = assessReferenceQuality(refs, 'standard');
    expect(result.countPassed).toBe(false);
    expect(result.feedback).toContain('at least 5');
  });

  it('fails when serious ratio below minimum', () => {
    const refs: GeneratedReference[] = [
      ...Array.from({ length: 7 }, (_, i) => makeRef(i + 1, 'WEB')),
      ...makePaperRefs(3, 8),
    ];
    const result = assessReferenceQuality(refs, 'deep_dive');
    expect(result.ratioPassed).toBe(false);
    expect(result.seriousRatio).toBe(0.3);
    expect(result.feedback).toContain('60%');
  });

  it('eli5 passes with all WEB refs', () => {
    const refs = Array.from({ length: 3 }, (_, i) => makeRef(i + 1, 'WEB'));
    const result = assessReferenceQuality(refs, 'eli5');
    expect(result.countPassed).toBe(true);
    expect(result.ratioPassed).toBe(true);
    expect(result.feedback).toBeNull();
  });

  it('assessReferenceQuality returns countPassed=false for 0 references', () => {
    const result = assessReferenceQuality([], 'standard');
    expect(result.countPassed).toBe(false);
    expect(result.totalCount).toBe(0);
    expect(result.requiredCount).toBe(5);
    expect(result.qualityScore).toBe(0);
    expect(result.feedback).toContain('at least 5');
  });

  it('quality score is higher for PAPER-heavy sets', () => {
    const paperRefs = makePaperRefs(5);
    const webRefs = Array.from({ length: 5 }, (_, i) => makeRef(i + 1, 'WEB'));
    const paperResult = assessReferenceQuality(paperRefs, 'standard');
    const webResult = assessReferenceQuality(webRefs, 'standard');
    expect(paperResult.qualityScore).toBe(1.0);
    expect(webResult.qualityScore).toBe(0.4);
    expect(paperResult.qualityScore).toBeGreaterThan(webResult.qualityScore);
  });

  it('integration: verifyScript fails when reference count insufficient', async () => {
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
            verificationNote: 'Adequately sourced',
          },
        ],
        overallScore: 0.95,
        feedback: '',
      }),
      inputTokens: 600,
      outputTokens: 300,
    });

    const result = await verifyScript({
      topic: 'Quantum Computing',
      turns: [{ speaker: 'EXPERT', text: 'Quantum computing uses qubits [1].' }],
      references: [makeRef(1, 'PAPER')],
      depth: 'deep_dive',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.referenceQuality.countPassed).toBe(false);
    expect(result.feedback).toContain('REFERENCES');
  });

  it('integration: verifyScript passes when references meet thresholds', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        claims: [
          {
            claimText: 'Studies show exercise improves mood',
            turnIndex: 0,
            speaker: 'EXPERT',
            isCommonKnowledge: false,
            existingCitations: [1, 2],
            needsMoreCitations: false,
            hasUnreliableSource: false,
            verificationNote: 'Well sourced',
          },
        ],
        overallScore: 0.95,
        feedback: '',
      }),
      inputTokens: 600,
      outputTokens: 300,
    });

    const refs: GeneratedReference[] = [
      ...makePaperRefs(4),
      makeRef(5, 'ARTICLE'),
    ];

    const result = await verifyScript({
      topic: 'Exercise Benefits',
      turns: [{ speaker: 'EXPERT', text: 'Studies show exercise improves mood [1,2].' }],
      references: refs,
      depth: 'standard',
      audienceLevel: 'intermediate',
      attemptNumber: 1,
    });

    expect(result.passed).toBe(true);
    expect(result.referenceQuality.countPassed).toBe(true);
    expect(result.referenceQuality.ratioPassed).toBe(true);
    expect(result.referenceQuality.qualityScore).toBeGreaterThan(0.8);
  });
});

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
    const webRefs: GeneratedReference[] = Array.from({ length: 5 }, (_, i) => makeRef(i + 1, 'WEB'));

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
  it('requires more refs for longer podcasts', () => {
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
