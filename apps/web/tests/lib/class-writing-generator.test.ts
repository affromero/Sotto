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
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a),
  capturedLearningAiOptions: async (ai: { model: string; apiKey?: string }) => ({
    model: ai.model,
    apiKeyOverride: ai.apiKey,
  }),
}));

const mockGenerateResponse = vi.fn();
const mockTeachingResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: (...args: unknown[]) =>
      (args[2] as { jsonSchema?: { name: string } })?.jsonSchema?.name === 'class_teaching_quality'
        ? mockTeachingResponse(...args)
        : mockGenerateResponse(...args),
  }),
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

import { composeWritingPrompts, generateClassWriting } from '@/lib/class-writing-generator';
import { blockedProviderExecution } from '../helpers/runtime/provider-execution';

const SAMPLE = JSON.stringify([
  {
    taskType: 'guided_reply',
    sourceText: 'Dinner invitation for Thursday. Accept. You can arrive at 19:00.',
    task: 'Reply to a friend inviting you to dinner.',
    guidance: 'Accept and suggest a time.',
    ideas: ['Gracias, me encantaría.', 'El jueves me viene bien.'],
  },
  { task: 'Correct the sentence.', taskType: 'correction', sourceText: 'Ayer yo va al cine.' },
]);

const PARAMS = {
  userId: 'u1',
  execution: blockedProviderExecution('u1'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Everyday messages',
  targetVocab: [{ lemma: 'cena', gloss: 'dinner' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  mockTeachingResponse.mockImplementation(async (_system, messages) => ({
    content: JSON.stringify({
      items: JSON.parse(messages[0].content).items.map((item: { index: number }) => ({
        index: item.index,
        acceptable: true,
        issues: [],
      })),
    }),
    model: 'm',
  }));
  mockLoadAndRender.mockReturnValue('system prompt');
  mockGenerateResponse.mockResolvedValue({
    content: SAMPLE,
    inputTokens: 10,
    outputTokens: 20,
    model: 'm',
  });
  mockClassSectionCreate.mockResolvedValue({ id: 'section-w' });
  mockWritingPromptCreateMany.mockResolvedValue({ count: 2 });
});

describe('composeWritingPrompts', () => {
  it('rejects incomplete teaching coverage rather than accepting unreviewed writing', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({ items: [{ index: 0, acceptable: true, issues: [] }] }),
      model: 'm',
    });
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow('educational quality');
    expect(mockWritingPromptCreateMany).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalledTimes(1);
  });

  it('propagates writing review budget denial before persistence without redispatch', async () => {
    mockTeachingResponse.mockRejectedValue(new Error('Budget exhausted'));
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow('Budget exhausted');
    expect(mockWritingPromptCreateMany).not.toHaveBeenCalled();
    expect(mockGenerateResponse.mock.calls).toHaveLength(1);
  });
  it('reviews intentional correction exercises with exact published content and task type', async () => {
    const prompts = await composeWritingPrompts(PARAMS);
    const reviewed = JSON.parse(mockTeachingResponse.mock.calls[0][1][0].content);
    expect(reviewed.items.map((item: { content: unknown }) => item.content)).toEqual([
      { ...prompts[0], taskType: 'guided_reply' },
      { ...prompts[1], taskType: 'correction' },
    ]);
  });

  it('rejects instructions requiring incorrect output before writing prompts are persisted', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: [
          { index: 0, acceptable: false, issues: ['infeasible'] },
          { index: 1, acceptable: true, issues: [] },
        ],
      }),
      model: 'm',
    });
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow('educational quality');
    expect(mockWritingPromptCreateMany).not.toHaveBeenCalled();
    expect(mockGenerateResponse.mock.calls).toHaveLength(2);
  });

  it('replaces a rejected writing set once and requires the replacement to pass review', async () => {
    const replacement = JSON.stringify([
      {
        taskType: 'completion',
        sourceText: 'Mañana ___ una cena con Ana a las ocho.',
        task: 'Complete the supplied sentence with the correct form of tener.',
        guidance: 'Use the near future.',
      },
    ]);
    mockGenerateResponse
      .mockResolvedValueOnce({ content: SAMPLE, inputTokens: 10, outputTokens: 20, model: 'm' })
      .mockResolvedValueOnce({ content: replacement, inputTokens: 11, outputTokens: 21, model: 'm' });
    mockTeachingResponse
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            { index: 0, acceptable: false, issues: ['unnatural'] },
            { index: 1, acceptable: true, issues: [] },
          ],
        }),
        model: 'm',
      })
      .mockImplementationOnce(async (_system, messages) => ({
        content: JSON.stringify({
          items: JSON.parse(messages[0].content).items.map((item: { index: number }) => ({
            index: item.index,
            acceptable: true,
            issues: [],
          })),
        }),
        model: 'm',
      }));

    const prompts = await composeWritingPrompts(PARAMS);

    expect(prompts).toEqual([
      {
        task: 'Complete the supplied sentence with the correct form of tener.\n\nMañana ___ una cena con Ana a las ocho.',
        guidance: 'Use the near future.',
        ideas: [],
      },
    ]);
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockTeachingResponse.mock.calls[1][1][0].content).items[0].content).toEqual({
      ...prompts[0],
      taskType: 'completion',
    });
    expect(mockGenerateResponse.mock.calls[1][1][0].content).toContain(
      'supply every fact the learner needs'
    );
    expect(mockGenerateResponse.mock.calls[1][2]).toEqual(
      expect.objectContaining({ temperature: 0, model: 'm', apiKeyOverride: 'k' })
    );
  });

  it('fails when the bounded replacement is malformed without another review', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: [
          { index: 0, acceptable: false, issues: ['unnatural'] },
          { index: 1, acceptable: true, issues: [] },
        ],
      }),
      model: 'm',
    });
    mockGenerateResponse
      .mockResolvedValueOnce({ content: SAMPLE, inputTokens: 10, outputTokens: 20, model: 'm' })
      .mockResolvedValueOnce({
        content: JSON.stringify([{ task: 'Missing source.', taskType: 'completion' }]),
        inputTokens: 1,
        outputTokens: 1,
        model: 'm',
      });

    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow(/source text/i);
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
  });

  it('propagates a second-review cancellation without another dispatch', async () => {
    mockTeachingResponse
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            { index: 0, acceptable: false, issues: ['unnatural'] },
            { index: 1, acceptable: true, issues: [] },
          ],
        }),
        model: 'm',
      })
      .mockRejectedValueOnce(new Error('Preparation cancelled'));

    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow('Preparation cancelled');
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
  });

  it('propagates a replacement provider failure without another dispatch', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: [
          { index: 0, acceptable: false, issues: ['unnatural'] },
          { index: 1, acceptable: true, issues: [] },
        ],
      }),
      model: 'm',
    });
    mockGenerateResponse
      .mockResolvedValueOnce({ content: SAMPLE, inputTokens: 10, outputTokens: 20, model: 'm' })
      .mockRejectedValueOnce(new Error('Provider unavailable'));

    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow('Provider unavailable');
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
  });
  it('returns parsed tasks without persisting class rows', async () => {
    const prompts = await composeWritingPrompts(PARAMS);
    expect(prompts).toEqual([
      {
        task: 'Reply to a friend inviting you to dinner.\n\nDinner invitation for Thursday. Accept. You can arrive at 19:00.',
        guidance: 'Accept and suggest a time.',
        ideas: ['Gracias, me encantaría.', 'El jueves me viene bien.'],
      },
      { task: 'Correct the sentence.\n\nAyer yo va al cine.', guidance: null, ideas: [] },
    ]);
    expect(mockClassSectionCreate).not.toHaveBeenCalled();
    expect(mockWritingPromptCreateMany).not.toHaveBeenCalled();
  });

  it('keeps at most three ideas and drops entries that are not text', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify([
        {
          task: 'Reply to the message.',
          taskType: 'guided_reply',
          sourceText: 'Accept dinner on Thursday at 19:00.',
          ideas: ['one', 2, '  ', 'two', 'three', 'four'],
        },
      ]),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });

    const [prompt] = await composeWritingPrompts(PARAMS);

    expect(prompt.ideas).toEqual(['one', 'two', 'three']);
  });

  it('falls back to no ideas rather than failing when the field is malformed', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify([
        {
          task: 'Reply to the message.',
          taskType: 'guided_reply',
          sourceText: 'Accept dinner on Thursday at 19:00.',
          ideas: 'not a list',
        },
      ]),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });

    const [prompt] = await composeWritingPrompts(PARAMS);

    expect(prompt.task).toContain('Accept dinner on Thursday at 19:00.');
    expect(prompt.ideas).toEqual([]);
  });

  it('throws when the model returns no usable tasks', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: '[]',
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow(/no usable tasks/i);
  });

  it('rejects personal writing prompts without supplied source material', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify([{ task: 'What did you do yesterday?', taskType: 'guided_reply' }]),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow(/source text/i);
    expect(mockWritingPromptCreateMany).not.toHaveBeenCalled();
  });
});

describe('generateClassWriting', () => {
  it('creates a WRITING ClassSection + WritingPrompt rows', async () => {
    const res = await generateClassWriting({ ...PARAMS, classId: 'class-1' });
    expect(res).toEqual({ sectionId: 'section-w' });
    expect(mockClassSectionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ classId: 'class-1', skill: 'WRITING', status: 'READY' }),
      })
    );
    expect(mockWritingPromptCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ sectionId: 'section-w', order: 1 }),
        ]),
      })
    );
  });
});
