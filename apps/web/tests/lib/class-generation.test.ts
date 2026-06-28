/**
 * Unit tests for src/lib/class-generation.ts.
 * Verifies MCQ generation and, for sourced READING sections, that the leveled
 * passage flows into the prompt ({{SOURCE}}) and onto each returned question
 * (passageText). Curriculum sections (no sourceContent) behave as before.
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
vi.mock('@/lib/course-notes', () => ({
  formatNotesForPrompt: (n: string) => (n ? `\nNOTE: ${n}\n` : ''),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateSectionQuestions } from '@/lib/class-generation';
import type { SectionGenParams } from '@/lib/class-generation';
import type { SkillType } from '@sotto/shared';

const SAMPLE = JSON.stringify([
  {
    question: '¿Qué descubrió el científico?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'x',
    passageRef: 'L1',
  },
  {
    question: '¿Cuándo ocurrió?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 1,
    explanation: 'y',
  },
]);

const BASE: SectionGenParams = {
  userId: 'u1',
  skill: 'READING' as SkillType,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Read a short article',
  grammarPoints: ['past tense'],
  targetVocab: [{ lemma: 'descubrir', gloss: 'to discover' }],
  seed: 'class-1-READING-1',
};

const PASSAGE = 'Una vez un científico descubrió algo importante en el laboratorio.';

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  mockLoadAndRender.mockReturnValue('system prompt');
  mockGenerateResponse.mockResolvedValue({
    content: SAMPLE,
    inputTokens: 10,
    outputTokens: 20,
    model: 'm',
  });
});

describe('generateSectionQuestions', () => {
  it('returns parsed MCQs for a curriculum READING section without a passage', async () => {
    const qs = await generateSectionQuestions(BASE);

    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ question: expect.any(String), correctIndex: 0 });
    // No source → no passageText attached.
    expect(qs[0].passageText).toBeUndefined();
    // The {{SOURCE}} placeholder is rendered empty.
    expect(mockLoadAndRender).toHaveBeenCalledWith(
      'class/generate-section-quiz.md',
      expect.objectContaining({ SOURCE: '' })
    );
  });

  it('attaches the leveled passage as passageText for a sourced READING section', async () => {
    const qs = await generateSectionQuestions({ ...BASE, sourceContent: PASSAGE });

    expect(qs).toHaveLength(2);
    for (const q of qs) {
      expect(q.passageText).toBe(PASSAGE);
    }
    // The passage is rendered into the {{SOURCE}} block of the prompt.
    expect(mockLoadAndRender).toHaveBeenCalledWith(
      'class/generate-section-quiz.md',
      expect.objectContaining({ SOURCE: expect.stringContaining(PASSAGE) })
    );
  });

  it('does NOT attach passageText for a GRAMMAR section even if sourceContent is present', async () => {
    const qs = await generateSectionQuestions({
      ...BASE,
      skill: 'GRAMMAR' as SkillType,
      sourceContent: PASSAGE,
    });

    for (const q of qs) {
      expect(q.passageText).toBeUndefined();
    }
    expect(mockLoadAndRender).toHaveBeenCalledWith(
      'class/generate-section-quiz.md',
      expect.objectContaining({ SOURCE: '' })
    );
  });

  it('throws when the model returns no usable questions', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: '[]',
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });
    await expect(generateSectionQuestions(BASE)).rejects.toThrow(/no usable questions/i);
  });

  it('accepts a wrapped questions object from stricter JSON providers', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ questions: JSON.parse(SAMPLE) }),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });

    const qs = await generateSectionQuestions(BASE);

    expect(qs).toHaveLength(2);
    expect(qs[0].question).toBe('¿Qué descubrió el científico?');
  });

  it('extracts the first JSON array when a model adds surrounding prose', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: `Here are the questions:\n${SAMPLE}\nDone.`,
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });

    const qs = await generateSectionQuestions(BASE);

    expect(qs).toHaveLength(2);
    expect(qs[1].correctIndex).toBe(1);
  });

  it('retries with stricter JSON instructions when the first response is malformed', async () => {
    mockGenerateResponse
      .mockResolvedValueOnce({
        content: '[{"question":"broken"',
        inputTokens: 1,
        outputTokens: 1,
        model: 'm',
      })
      .mockResolvedValueOnce({
        content: SAMPLE,
        inputTokens: 2,
        outputTokens: 2,
        model: 'm',
      });

    const qs = await generateSectionQuestions(BASE);

    expect(qs).toHaveLength(2);
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockGenerateResponse.mock.calls[1][1][0].content).toContain(
      'Return ONLY a valid JSON array'
    );
  });
});
