/**
 * Unit tests for src/lib/writing-grader.ts — synchronous LLM grading of a
 * learner's writing: parses + clamps the score, filters corrections, and
 * rejects malformed output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveLearningAi = vi.fn();
vi.mock('@/lib/learning-ai', () => ({
  resolveLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a),
}));

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: mockGenerateResponse }),
}));

const mockLoadAndRender = vi.fn();
vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: (...a: unknown[]) => mockLoadAndRender(...a),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { gradeWriting } from '@/lib/writing-grader';

const PARAMS = {
  userId: 'u1',
  nativeLang: 'en',
  targetLang: 'es',
  level: 'A2',
  task: 'Reply to the dinner invite.',
  text: 'Si, yo quiero ir a la cena.',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  mockLoadAndRender.mockReturnValue('grade prompt');
});

describe('gradeWriting', () => {
  it('parses score, corrections, and feedback', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        overallScore: 0.8,
        corrections: [{ old: 'Si', new: 'Sí', why: 'accent on the affirmation' }],
        feedback: 'Great reply!',
      }),
      inputTokens: 10,
      outputTokens: 20,
      model: 'm',
    });

    const grade = await gradeWriting(PARAMS);
    expect(grade.overallScore).toBe(0.8);
    expect(grade.corrections).toEqual([{ old: 'Si', new: 'Sí', why: 'accent on the affirmation' }]);
    expect(grade.feedback).toBe('Great reply!');
  });

  it('clamps the score to 0..1 and filters malformed corrections', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        overallScore: 1.7,
        corrections: [{ old: 'x', new: 'y', why: 'z' }, { old: 'bad' }, 'nope'],
        feedback: 42,
      }),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });

    const grade = await gradeWriting(PARAMS);
    expect(grade.overallScore).toBe(1);
    expect(grade.corrections).toEqual([{ old: 'x', new: 'y', why: 'z' }]);
    expect(grade.feedback).toBe('');
  });

  it('throws on malformed (non-JSON) output', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'not json',
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });
    await expect(gradeWriting(PARAMS)).rejects.toThrow(/malformed/i);
  });
});
