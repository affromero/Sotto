/**
 * Tests for src/lib/pronunciation/scorer.ts
 *
 * Mocked boundaries:
 *   - '@/lib/prompt-loader'     — avoids filesystem reads in unit tests
 *   - '@/lib/providers/ai'      — avoids real network calls
 *   - '@/lib/usage-logger'      — avoids DB writes
 *
 * Internal helpers (alignPhrase, parseLlmRubric logic) are exercised
 * indirectly through score() — we assert on outputs, not call counts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SelfContainedScorer,
  resolvePronunciationScorer,
  type PronunciationInput,
} from '@/lib/pronunciation/scorer';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: vi.fn(() => 'You are a pronunciation coach. Score this.'),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn(() => Promise.resolve()),
}));

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: vi.fn(() => ({
    generateResponse: mockGenerateResponse,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<PronunciationInput> = {}): PronunciationInput {
  return {
    targetPhrase: 'Ich heiße Anna',
    transcript: 'Ich heiße Anna',
    targetLang: 'de',
    aiProvider: 'anthropic',
    aiModel: 'claude-3-5-haiku-20241022',
    userId: 'user-test-1',
    ...overrides,
  };
}

function rubricResponse(
  accuracy: number,
  fluency: number,
  completeness: number,
  feedback = 'Well done!'
): { content: string; model: string; inputTokens: number; outputTokens: number } {
  return {
    content: JSON.stringify({ accuracy, fluency, completeness, feedback }),
    model: 'claude-3-5-haiku-20241022',
    inputTokens: 100,
    outputTokens: 50,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SelfContainedScorer', () => {
  it('preserves an explicitly captured isolated adapter at the provider boundary', async () => {
    const isolated = {
      image: 'fixture-image',
      cliVersion: '2.1.283' as const,
      executionId: 'fixture-execution',
      endpoint: 'https://api.anthropic.com',
      credential: 'fixture-key',
      expiresAt: Date.now() + 60_000,
      maxOutputTokens: 256,
      admit: async () => {},
      authenticatedFetch: globalThis.fetch,
      recordIdentity: async () => {},
      recordCleanup: async () => {},
    };
    mockGenerateResponse.mockResolvedValue(rubricResponse(0.9, 0.8, 0.9));
    const result = await new SelfContainedScorer().score(
      makeInput({
        aiOptions: {
          model: 'fixture',
          apiKeyOverride: undefined,
          endpoint: undefined,
          fetch: undefined,
          moderation: undefined,
          signal: undefined,
          isolated,
        },
      })
    );
    expect(result.overallScore).toBeGreaterThan(0.8);
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ isolated })
    );
  });
  let scorer: SelfContainedScorer;

  beforeEach(() => {
    scorer = new SelfContainedScorer();
    vi.clearAllMocks();
  });

  it('has id "self-contained"', () => {
    expect(scorer.id).toBe('self-contained');
  });

  it('grades with the captured local endpoint', async () => {
    const endpoint = 'http://localhost:11434/v1';
    mockGenerateResponse.mockImplementation(async (_prompt, _messages, options) => {
      if (options.endpoint !== endpoint) throw new Error('Wrong provider destination');
      return rubricResponse(1, 1, 1, 'Clear pronunciation.');
    });
    const result = await scorer.score(
      makeInput({ aiProvider: 'local', aiModel: 'local:fixture', aiEndpoint: endpoint })
    );
    expect(result.overallScore).toBeGreaterThan(0.9);
    expect(result.feedback).toContain('Clear pronunciation.');
    expect(result.rubricScores).not.toHaveProperty('fluency');
    expect(result.feedback).toContain('unmeasured');
  });

  describe('perfect transcript', () => {
    it('scores above 0.9 overall', async () => {
      mockGenerateResponse.mockResolvedValue(rubricResponse(1, 1, 1, 'Perfect!'));

      const result = await scorer.score(makeInput());

      expect(result.overallScore).toBeGreaterThan(0.9);
    });

    it('returns all-match phonemeScores', async () => {
      mockGenerateResponse.mockResolvedValue(rubricResponse(1, 1, 1));

      const result = await scorer.score(makeInput());

      expect(result.phonemeScores.every((t) => t.op === 'match')).toBe(true);
    });

    it('passes the transcript through unchanged', async () => {
      mockGenerateResponse.mockResolvedValue(rubricResponse(1, 1, 1));

      const result = await scorer.score(makeInput({ transcript: 'Ich heiße Anna' }));

      expect(result.transcript).toBe('Ich heiße Anna');
    });
  });

  describe('wrong transcript', () => {
    it('scores below 0.5 overall when most words are wrong', async () => {
      mockGenerateResponse.mockResolvedValue(
        rubricResponse(0.1, 0.5, 0.3, 'Focus on the missing words.')
      );

      const result = await scorer.score(
        makeInput({
          targetPhrase: 'Ich heiße Anna gut Morgen',
          transcript: 'hello world',
        })
      );

      expect(result.overallScore).toBeLessThan(0.5);
    });

    it('includes non-match tokens in phonemeScores', async () => {
      mockGenerateResponse.mockResolvedValue(rubricResponse(0.3, 0.5, 0.3));

      const result = await scorer.score(
        makeInput({
          targetPhrase: 'Ich heiße Anna',
          transcript: 'I am Bob',
        })
      );

      const nonMatches = result.phonemeScores.filter((t) => t.op !== 'match');
      expect(nonMatches.length).toBeGreaterThan(0);
    });
  });

  describe('word timings — fluency proxy', () => {
    it('uses timing data when provided', async () => {
      mockGenerateResponse.mockResolvedValue(rubricResponse(1, 1, 1));

      // Tight timings — should score well
      const result = await scorer.score(
        makeInput({
          wordTimings: [
            { word: 'Ich', start: 0.0, end: 0.3 },
            { word: 'heiße', start: 0.35, end: 0.8 },
            { word: 'Anna', start: 0.85, end: 1.2 },
          ],
        })
      );

      expect(result.rubricScores.fluency).toBeGreaterThan(0.7);
    });

    it('penalises long internal pauses', async () => {
      // Use low LLM fluency to isolate the deterministic signal in the blend
      mockGenerateResponse.mockResolvedValue(rubricResponse(1, 0.4, 1));

      const result = await scorer.score(
        makeInput({
          wordTimings: [
            { word: 'Ich', start: 0.0, end: 0.3 },
            { word: 'heiße', start: 2.5, end: 3.0 }, // 2.2 s gap
            { word: 'Anna', start: 5.5, end: 6.0 }, // 2.5 s gap
          ],
        })
      );

      // Both LLM and deterministic signals are low → blend should be below 0.7
      expect(result.rubricScores.fluency).toBeLessThan(0.7);
    });
  });

  describe('provider failures', () => {
    it('surfaces malformed rubric output', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'I cannot score this.',
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 50,
        outputTokens: 10,
      });

      await expect(scorer.score(makeInput())).rejects.toThrow(
        'Pronunciation rubric provider returned invalid JSON'
      );
    });

    it('surfaces provider errors', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('Network error'));

      await expect(scorer.score(makeInput())).rejects.toThrow('Network error');
    });
  });

  describe('invalid rubric scores', () => {
    it.each([-0.2, 1.5])('rejects out-of-range LLM score %s', async (accuracy) => {
      mockGenerateResponse.mockResolvedValue(rubricResponse(accuracy, 0.5, 1));
      await expect(scorer.score(makeInput())).rejects.toThrow('invalid JSON');
    });
  });

  describe('code-fenced JSON response', () => {
    it('parses JSON wrapped in markdown code fences', async () => {
      mockGenerateResponse.mockResolvedValue({
        content:
          '```json\n{"accuracy":0.9,"fluency":0.8,"completeness":1.0,"feedback":"Nice!"}\n```',
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 80,
        outputTokens: 30,
      });

      const result = await scorer.score(makeInput());

      expect(result.feedback).toContain('Nice!');
      expect(result.rubricScores.accuracy).toBeGreaterThan(0.8);
    });
  });
});

// ---------------------------------------------------------------------------
// resolvePronunciationScorer
// ---------------------------------------------------------------------------

describe('resolvePronunciationScorer', () => {
  it('returns SelfContainedScorer for undefined provider', () => {
    const scorer = resolvePronunciationScorer({});
    expect(scorer.id).toBe('self-contained');
  });

  it('returns SelfContainedScorer for explicit "self-contained"', () => {
    const scorer = resolvePronunciationScorer({ provider: 'self-contained' });
    expect(scorer.id).toBe('self-contained');
  });

  it('throws for an unknown provider', () => {
    expect(() => resolvePronunciationScorer({ provider: 'azure' })).toThrow(
      /unknown pronunciation scorer provider.*azure/i
    );
  });

  it('throws for another unknown provider value', () => {
    expect(() => resolvePronunciationScorer({ provider: 'speechace' })).toThrow(
      /unknown pronunciation scorer provider.*speechace/i
    );
  });
});
