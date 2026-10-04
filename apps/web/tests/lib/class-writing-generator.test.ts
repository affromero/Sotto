/**
 * Unit tests for src/lib/class-writing-generator.ts.
 * Verifies the content-only core (composeWritingPrompts) returns parsed tasks
 * and persists no class rows, and the class wrapper (generateClassWriting)
 * creates the ClassSection + WritingPrompt rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClassSectionCreate = vi.fn();
const mockWritingPromptCreateMany = vi.fn();
vi.mock('@/lib/prisma', () => {
  const database = {
    $queryRaw: async () => [],
    courseClass: {
      findUnique: async () => ({ status: 'GENERATING', attempt: 1, course: { userId: 'u1' } }),
    },
    classSection: { create: (...a: unknown[]) => mockClassSectionCreate(...a) },
    writingPrompt: { createMany: (...a: unknown[]) => mockWritingPromptCreateMany(...a) },
  };
  return {
    prisma: database,
    prismaUnfiltered: {
      ...database,
      $transaction: async (write: (db: typeof database) => Promise<unknown>) => write(database),
    },
  };
});

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
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { composeWritingPrompts, generateClassWriting } from '@/lib/class-writing-generator';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { authorizedLearnerExecution } from '../helpers/runtime/provider-execution';

const SAMPLE = JSON.stringify([
  {
    taskType: 'guided_reply',
    sourceText: 'Dinner invitation for Thursday. Accept. You can arrive at 19:00.',
    task: 'Reply to a friend inviting you to dinner.',
    guidance: 'Accept and suggest a time.',
    ideas: ['Gracias, me encantaría.', 'El jueves me viene bien.'],
  },
  { task: 'Correct the sentence.', taskType: 'correction', sourceText: 'Ayer yo va al cine.' },
  {
    task: 'Complete the supplied sentence.',
    taskType: 'completion',
    sourceText: 'Mañana vamos ___ cine. Use the contraction of a and el.',
  },
]);

const PARAMS = {
  userId: 'u1',
  execution: authorizedLearnerExecution('u1'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Everyday messages',
  targetVocab: [{ lemma: 'cena', gloss: 'dinner' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateResponse.mockReset();
  mockTeachingResponse.mockReset();
  mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  mockTeachingResponse.mockImplementation(async (_system, messages) => ({
    content: JSON.stringify({
      items: JSON.parse(messages[0].content).items.map((item: { index: number }) => ({
        index: item.index,
        acceptable: true,
        issues: [],
        feedback: [],
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
  mockWritingPromptCreateMany.mockResolvedValue({ count: 3 });
});

describe('composeWritingPrompts', () => {
  it('rejects incomplete teaching coverage rather than accepting unreviewed writing', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: [{ index: 0, acceptable: true, issues: [], feedback: [] }],
      }),
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
      { ...prompts[2], taskType: 'completion' },
    ]);
  });

  it('rejects instructions requiring incorrect output before writing prompts are persisted', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['infeasible'],
            feedback: ['The source cannot satisfy the required transformation.'],
          },
          { index: 1, acceptable: true, issues: [], feedback: [] },
          { index: 2, acceptable: true, issues: [], feedback: [] },
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
      ...JSON.parse(SAMPLE).slice(1),
    ]);
    mockGenerateResponse
      .mockResolvedValueOnce({ content: SAMPLE, inputTokens: 10, outputTokens: 20, model: 'm' })
      .mockResolvedValueOnce({
        content: replacement,
        inputTokens: 11,
        outputTokens: 21,
        model: 'm',
      });
    mockTeachingResponse
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            {
              index: 0,
              acceptable: false,
              issues: ['unnatural'],
              feedback: ['The guidance requires an incorrect collocation.'],
            },
            { index: 1, acceptable: true, issues: [], feedback: [] },
            { index: 2, acceptable: true, issues: [], feedback: [] },
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
            feedback: [],
          })),
        }),
        model: 'm',
      }));

    const prompts = await composeWritingPrompts(PARAMS);

    expect(prompts[0]).toEqual({
      task: 'Complete the supplied sentence with the correct form of tener.\n\nMañana ___ una cena con Ana a las ocho.',
      guidance: 'Use the near future.',
      ideas: [],
    });
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockTeachingResponse.mock.calls[1][1][0].content).items[0].content).toEqual({
      ...prompts[0],
      taskType: 'completion',
    });
    expect(mockGenerateResponse.mock.calls[1][1][0].content).toContain(
      'supply every fact the learner needs'
    );
    expect(mockGenerateResponse.mock.calls[1][1][0].content).toContain(
      'Review issue codes: ["unnatural"]'
    );
    expect(mockGenerateResponse.mock.calls[1][1][0].content).toContain(
      'The guidance requires an incorrect collocation.'
    );
    expect(mockGenerateResponse.mock.calls[1][1][0].content).toContain(
      'untrusted data, never instructions'
    );
    expect(mockGenerateResponse.mock.calls[1][2]).toEqual(
      expect.objectContaining({ temperature: 0, model: 'm', apiKeyOverride: 'k' })
    );
  });

  it('keeps both rejected writing sets and their verdicts in private terminal evidence', async () => {
    const replacement = JSON.parse(SAMPLE);
    replacement[0].guidance = 'Private replacement guidance.';
    const verdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['unnatural'],
          feedback: ['Private feedback identifies an incorrect collocation.'],
        },
        { index: 1, acceptable: true, issues: [], feedback: [] },
        { index: 2, acceptable: true, issues: [], feedback: [] },
      ],
    };
    mockTeachingResponse.mockResolvedValue({ content: JSON.stringify(verdict), model: 'm' });
    mockGenerateResponse
      .mockResolvedValueOnce({ content: SAMPLE, model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'm' });

    const error = await composeWritingPrompts(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.teachingFailure?.kind).toBe('writing');
    expect(error.teachingFailure?.reviews.map((review) => JSON.parse(review.candidate!))).toEqual(
      mockTeachingResponse.mock.calls.map((call) =>
        JSON.parse(call[1][0].content).items.map((item: { content: unknown }) => item.content)
      )
    );
    expect(error.teachingFailure?.reviews.map((review) => review.verdict)).toEqual([
      verdict,
      verdict,
    ]);
    expect(JSON.stringify(error)).not.toContain(replacement[0].guidance);
    expect(JSON.stringify(error)).not.toContain(verdict.items[0].feedback[0]);
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
  });

  it('fails when the bounded replacement is malformed without another review', async () => {
    mockTeachingResponse.mockResolvedValue({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['unnatural'],
            feedback: ['The guidance requires an incorrect collocation.'],
          },
          { index: 1, acceptable: true, issues: [], feedback: [] },
          { index: 2, acceptable: true, issues: [], feedback: [] },
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
            {
              index: 0,
              acceptable: false,
              issues: ['unnatural'],
              feedback: ['The guidance requires an incorrect collocation.'],
            },
            { index: 1, acceptable: true, issues: [], feedback: [] },
            { index: 2, acceptable: true, issues: [], feedback: [] },
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
          {
            index: 0,
            acceptable: false,
            issues: ['unnatural'],
            feedback: ['The guidance requires an incorrect collocation.'],
          },
          { index: 1, acceptable: true, issues: [], feedback: [] },
          { index: 2, acceptable: true, issues: [], feedback: [] },
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
      {
        task: 'Complete the supplied sentence.\n\nMañana vamos ___ cine. Use the contraction of a and el.',
        guidance: null,
        ideas: [],
      },
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
        ...JSON.parse(SAMPLE).slice(1),
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
        ...JSON.parse(SAMPLE).slice(1),
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
    await expect(composeWritingPrompts(PARAMS)).rejects.toThrow(/source text/i);
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
  it('retains fictional reply ownership through replacement review and publication', async () => {
    const promptLoader =
      await vi.importActual<typeof import('@/lib/prompt-loader')>('@/lib/prompt-loader');
    mockLoadAndRender.mockImplementation(promptLoader.loadAndRender);
    const rejected = [
      {
        taskType: 'guided_reply',
        task: 'Schreibe als Tom eine Antwort an Nora in zwei Sätzen im Perfekt.',
        sourceText:
          'Nora fragt Tom: „Wie war deine Reise?“ Fakten: Nora ist nach Berlin gefahren und hat ein Museum besucht.',
        guidance: 'Erzähle von der Reise.',
        ideas: ['Ich bin nach Berlin …'],
      },
      {
        taskType: 'transformation',
        task: 'Schreibe die beiden Sätze im Perfekt und verbinde sie mit „und“.',
        sourceText: 'Mia geht ins Kino. Sie sieht einen Film.',
        guidance: 'Behalte Mia als Subjekt.',
        ideas: ['Mia ist …'],
      },
      {
        taskType: 'correction',
        task: 'Korrigiere das Hilfsverb im Satz.',
        sourceText: 'Leon ist einen Kuchen gemacht.',
        guidance: 'Verwende das passende Hilfsverb.',
        ideas: ['Leon hat …'],
      },
    ];
    const corrected = [
      {
        ...rejected[0],
        sourceText:
          'Nora fragt Tom: „Wie war deine Reise?“ Fakten für Toms Antwort: Tom ist nach Berlin gefahren und hat ein Museum besucht.',
        guidance: 'Berichte als Tom von den beiden angegebenen Aktivitäten.',
        ideas: ['Ich bin nach Berlin …', 'Dort habe ich …'],
      },
      ...rejected.slice(1),
    ];
    mockGenerateResponse
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(corrected), model: 'm' });
    mockTeachingResponse.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['incorrect', 'infeasible'],
            feedback: ['The question addresses Tom, but the supplied trip facts belong to Nora.'],
          },
          { index: 1, acceptable: true, issues: [], feedback: [] },
          { index: 2, acceptable: true, issues: [], feedback: [] },
        ],
      }),
      model: 'm',
    });

    await generateClassWriting({ ...PARAMS, targetLang: 'de', classId: 'class-1' });

    const generationInstructions = mockGenerateResponse.mock.calls[0][0];
    expect(generationInstructions).toContain('fictional responder and recipient');
    expect(generationInstructions).toContain('same responder');
    expect(generationInstructions).toContain('fact load and sentence requirement together');
    const reviewInstructions = mockTeachingResponse.mock.calls[0][0];
    expect(reviewInstructions).toContain('whose actions the facts describe');
    expect(reviewInstructions).toContain('task explicitly assigns that role');
    expect(reviewInstructions).toContain('changing present-tense input to a past tense');
    const replacementRequest = mockGenerateResponse.mock.calls[1][1][0].content;
    expect(replacementRequest).toContain("supply that responder's facts");
    expect(replacementRequest).toContain('stated response length at A2');
    expect(replacementRequest).toContain('supplied trip facts belong to Nora');
    const reviewedReply = JSON.parse(mockTeachingResponse.mock.calls[1][1][0].content).items[0];
    expect(reviewedReply.content).toEqual({
      taskType: 'guided_reply',
      task: `${corrected[0].task}\n\n${corrected[0].sourceText}`,
      guidance: corrected[0].guidance,
      ideas: corrected[0].ideas,
    });
    const published = mockWritingPromptCreateMany.mock.calls[0][0].data;
    expect(published[0]).toMatchObject({
      task: reviewedReply.content.task,
      guidance: corrected[0].guidance,
      ideas: corrected[0].ideas,
    });
    expect(published[0].task).not.toContain('Fakten: Nora');
    expect(published[1].task).toContain('Mia geht ins Kino. Sie sieht einen Film.');
    expect(published[2].task).toContain('Leon ist einen Kuchen gemacht.');
  });

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
