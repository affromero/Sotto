import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  WEB_SEARCH_TOOL: { type: 'web_search_20250305', name: 'web_search' },
}));

// ---- Import under test ----
import { verifyScript } from '@/lib/script-verifier';

// ---- Tests ----

describe('verifyScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes web search tool to generateResponse', async () => {
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
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      })
    );
  });

  it('includes web search instructions in system prompt', async () => {
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
    expect(systemPrompt).toContain('web search');
    expect(systemPrompt).toContain('Verify whether cited sources actually exist');
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
      references: [],
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

  it('fails when script exceeds word count bounds', async () => {
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
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      maxDurationMinutes: 10,
    });

    expect(result.passed).toBe(false);
    expect(result.durationFeedback).toContain('exceeds');
    expect(result.durationFeedback).toContain('Reduce');
  });

  it('fails when script is too short', async () => {
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
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      maxDurationMinutes: 10,
    });

    expect(result.passed).toBe(false);
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
      references: [],
      depth: 'standard',
      audienceLevel: 'beginner',
      attemptNumber: 1,
      maxDurationMinutes: 10,
    });

    expect(result.passed).toBe(true);
    expect(result.durationFeedback).toBeNull();
  });

  it('handles unparseable AI response', async () => {
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
