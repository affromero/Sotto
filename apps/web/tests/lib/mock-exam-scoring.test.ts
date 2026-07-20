/**
 * Exam scoring: the pure weighting + band helpers, and scoreExam, which blends MC
 * (inline), writing (already graded), and speaking (latest SCORED recording, async)
 * into a blueprint-weighted overall + a mock band, then marks the exam SCORED. The
 * real exam-blueprint is used; the AI feedback call is mocked at the boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExamFindFirst = vi.fn();
const mockTransaction = vi.fn();
const mockExamSectionUpdate = vi.fn();
const mockExamSubmissionUpsert = vi.fn();
const mockMockExamUpdate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mockExam: {
      findFirst: (...a: unknown[]) => mockExamFindFirst(...a),
      update: (...a: unknown[]) => mockMockExamUpdate(...a),
    },
    examSection: { update: (...a: unknown[]) => mockExamSectionUpdate(...a) },
    examSubmission: { upsert: (...a: unknown[]) => mockExamSubmissionUpsert(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

const mockResolveLearningAi = vi.fn();
vi.mock('@/lib/learning-ai', () => ({
  resolveLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a),
}));
const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: mockGenerateResponse }),
}));
vi.mock('@/lib/prompt-loader', () => ({ loadAndRender: () => 'system prompt' }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  weightedOverall,
  computeBand,
  scoreExam,
  ExamNotFoundError,
} from '@/lib/mock-exam-scoring';

describe('weightedOverall', () => {
  it('weights section scores by their weight', () => {
    expect(
      weightedOverall([
        { score: 0.5, weight: 0.5 },
        { score: 0.8, weight: 0.5 },
      ])
    ).toBeCloseTo(0.65, 5);
  });
  it('is 0 for no sections', () => {
    expect(weightedOverall([])).toBe(0);
  });
  it('falls back to a plain mean when weights are all 0', () => {
    expect(
      weightedOverall([
        { score: 0.4, weight: 0 },
        { score: 0.6, weight: 0 },
      ])
    ).toBeCloseTo(0.5, 5);
  });
});

describe('computeBand', () => {
  it('passes at 0.6, borderline at 0.45, below otherwise', () => {
    expect(computeBand(0.7, 'B1')).toBe('B1 pass (mock)');
    expect(computeBand(0.5, 'B1')).toBe('B1 borderline (mock)');
    expect(computeBand(0.2, 'B1')).toBe('below B1 (mock)');
  });
});

describe('scoreExam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExamFindFirst.mockResolvedValue({
      id: 'exam1',
      institution: 'GOETHE',
      level: 'B1',
      sections: [
        {
          id: 's1',
          skill: 'READING',
          weight: 0.5,
          questions: [
            { id: 'q1', correctIndex: 0 },
            { id: 'q2', correctIndex: 1 },
          ],
          speakingPrompts: [],
          writingPrompts: [],
        },
        {
          id: 's2',
          skill: 'SPEAKING',
          weight: 0.5,
          questions: [],
          speakingPrompts: [{ recordings: [{ status: 'SCORED', overallScore: 0.8 }] }],
          writingPrompts: [],
        },
      ],
    });
    mockExamSectionUpdate.mockReturnValue({});
    mockExamSubmissionUpsert.mockReturnValue({});
    mockMockExamUpdate.mockReturnValue({});
    mockTransaction.mockResolvedValue([]);
    mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        overall: 'Solid work.',
        sections: [{ skill: 'READING', feedback: 'Good gist.' }],
      }),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });
  });

  it('throws when the exam is not owned by the caller', async () => {
    mockExamFindFirst.mockResolvedValue(null);
    await expect(scoreExam('exam1', 'u1', [])).rejects.toBeInstanceOf(ExamNotFoundError);
  });

  it('blends MC + speaking into the weighted overall and a mock band', async () => {
    const result = await scoreExam('exam1', 'u1', [
      { questionId: 'q1', selectedIndex: 0 }, // correct
      { questionId: 'q2', selectedIndex: 0 }, // wrong (correct is 1)
    ]);
    // reading 0.5 * 0.5 + speaking 0.8 * 0.5 = 0.65
    expect(result.overallScore).toBeCloseTo(0.65, 5);
    expect(result.band).toBe('B1 pass (mock)');
    expect(result.sections.find((s) => s.skill === 'READING')?.score).toBeCloseTo(0.5, 5);
    expect(result.sections.find((s) => s.skill === 'SPEAKING')?.score).toBeCloseTo(0.8, 5);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('counts an unscored speaking recording as 0', async () => {
    mockExamFindFirst.mockResolvedValue({
      id: 'exam1',
      institution: 'GOETHE',
      level: 'B1',
      sections: [
        {
          id: 's2',
          skill: 'SPEAKING',
          weight: 1,
          questions: [],
          speakingPrompts: [{ recordings: [{ status: 'PENDING', overallScore: null }] }],
          writingPrompts: [],
        },
      ],
    });
    const result = await scoreExam('exam1', 'u1', []);
    expect(result.sections[0].score).toBe(0);
    expect(result.band).toBe('below B1 (mock)');
  });
});
