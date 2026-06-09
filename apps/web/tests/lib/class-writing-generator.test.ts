/**
 * Unit tests for src/lib/class-writing-generator.ts.
 * Verifies the content-only core (composeWritingPrompts) returns parsed tasks
 * and persists no class rows, and the class wrapper (generateClassWriting)
 * creates the ClassSection + WritingPrompt rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClassSectionCreate = vi.fn();
const mockWritingPromptCreateMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classSection: { create: (...a: unknown[]) => mockClassSectionCreate(...a) },
    writingPrompt: { createMany: (...a: unknown[]) => mockWritingPromptCreateMany(...a) },
  },
}));

const mockResolveLearningAi = vi.fn();
vi.mock('@/lib/learning-ai', () => ({ resolveLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a) }));

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({ createAIProvider: () => ({ generateResponse: mockGenerateResponse }) }));

const mockLoadAndRender = vi.fn();
vi.mock('@/lib/prompt-loader', () => ({ loadAndRender: (...a: unknown[]) => mockLoadAndRender(...a) }));
vi.mock('@/lib/course-notes', () => ({ formatNotesForPrompt: (n: string) => (n ? `\nNOTE: ${n}\n` : '') }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { composeWritingPrompts, generateClassWriting } from '@/lib/class-writing-generator';

const SAMPLE = JSON.stringify([
  { task: 'Reply to a friend inviting you to dinner.', guidance: 'Accept and suggest a time.' },
  { task: 'Write a short note to your neighbour.' },
]);

const PARAMS = {
  userId: 'u1',
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Everyday messages',
  targetVocab: [{ lemma: 'cena', gloss: 'dinner' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  mockLoadAndRender.mockReturnValue('system prompt');
  mockGenerateResponse.mockResolvedValue({ content: SAMPLE, inputTokens: 10, outputTokens: 20, model: 'm' });
  mockClassSectionCreate.mockResolvedValue({ id: 'section-w' });
  mockWritingPromptCreateMany.mockResolvedValue({ count: 2 });
});

describe('composeWritingPrompts', () => {
  it('returns parsed tasks without persisting class rows', async () => {
    const prompts = await composeWritingPrompts(PARAMS);
    expect(prompts).toEqual([
      { task: 'Reply to a friend inviting you to dinner.', guidance: 'Accept and suggest a time.' },
      { task: 'Write a short note to your neighbour.', guidance: null },
    ]);
    expect(mockClassSectionCreate).not.toHaveBeenCalled();
    expect(mockWritingPromptCreateMany).not.toHaveBeenCalled();
  });

  it('throws when the model returns no usable tasks', async () => {
    mockGenerateResponse.mockResolvedValue({ content: '[]', inputTokens: 1, outputTokens: 1, model: 'm' });
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow(/no usable tasks/i);
  });
});

describe('generateClassWriting', () => {
  it('creates a WRITING ClassSection + WritingPrompt rows', async () => {
    const res = await generateClassWriting({ ...PARAMS, classId: 'class-1' });
    expect(res).toEqual({ sectionId: 'section-w' });
    expect(mockClassSectionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classId: 'class-1', skill: 'WRITING', status: 'READY' }) }),
    );
    expect(mockWritingPromptCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ sectionId: 'section-w', order: 1 })]),
      }),
    );
  });
});
