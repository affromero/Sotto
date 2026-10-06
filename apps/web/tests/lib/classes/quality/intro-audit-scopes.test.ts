import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  capturedLearningAiOptions: async (ai: { model: string; signal: AbortSignal }) => ({
    model: ai.model,
    signal: ai.signal,
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
  reviewTeachingContent,
} from '@/lib/classes/quality/teaching-quality';

const candidate = {
  purpose: 'Erzähle von Erlebnissen und fertigen Aktivitäten.',
  about: 'Das Perfekt besteht aus Hilfsverb und Partizip.',
  focus: ['Wähle haben oder sein.'],
  examples: [
    {
      target: 'Wir sind gegangen.',
      meaning: 'Wir sind zu Fuß unterwegs gewesen.',
      note: 'Gehen steht mit sein.',
    },
  ],
  tips: ['Das Partizip steht am Ende.'],
  visuals: { timeline: { title: 'Gestern', steps: ['Wir sind gegangen.'] } },
};
const options = {
  ai: {
    provider: 'fixture',
    model: 'captured-luna',
    signal: new AbortController().signal,
    execution: blockedProviderExecution('fixture'),
  },
  provider: {
    generateResponse: boundary.generate,
  } as never,
  userId: 'fixture',
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  lessonContext: {
    title: 'Unterwegs',
    objective: 'Erzähle, was du auf einer Reise erlebt hast.',
    grammarPoints: ['Perfekt mit haben und sein'],
  },
  kind: 'intro' as const,
  items: [candidate],
};

function verdict(items: Array<{ index: number; acceptable?: boolean; feedback?: string[] }>) {
  return {
    items: items.map(({ index, acceptable = true, feedback = [] }) => ({
      index,
      acceptable,
      issues: acceptable ? [] : ['unnatural'],
      feedback,
    })),
  };
}

describe('intro audit scopes', () => {
  beforeEach(() => boundary.generate.mockReset());

  it('keeps exact scope evidence and gives repair field-qualified feedback for every rejected scope', async () => {
    const rawVerdict = verdict([
      { index: 0, acceptable: false, feedback: ['“fertigen Aktivitäten” is unnatural here.'] },
      { index: 1 },
      { index: 2 },
      {
        index: 3,
        acceptable: false,
        feedback: [
          'examples[0].meaning adds being on foot, which is not stated.',
          'examples[0].note does not describe the supplied example.',
        ],
      },
      { index: 4 },
    ]);
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(rawVerdict),
      model: 'captured-luna',
      inputTokens: 12,
      outputTokens: 8,
    });

    const result = await reviewTeachingContent(options).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(result instanceof TeachingQualityRejectionError)) throw result;
    const requestItems = JSON.parse(boundary.generate.mock.calls[0]![1][0].content).items;
    const reviewPrompt = boundary.generate.mock.calls[0]![0] as string;
    expect(reviewPrompt).toContain('Title: Unterwegs');
    expect(reviewPrompt).toContain('Objective: Erzähle, was du auf einer Reise erlebt hast.');
    expect(reviewPrompt).toContain('Grammar focus: Perfekt mit haben und sein');
    expect(reviewPrompt).toContain('every supplied subfield in assigned visuals');
    expect(reviewPrompt).not.toContain('For writing items');
    expect(reviewPrompt).not.toContain('For vocabulary items');
    expect(requestItems).toHaveLength(5);
    expect(requestItems.map(({ content }: { content: unknown }) => content)).toEqual([
      { auditFields: ['purpose'], introContext: candidate, fields: { purpose: candidate.purpose } },
      { auditFields: ['about'], introContext: candidate, fields: { about: candidate.about } },
      {
        auditFields: ['focus', 'tips'],
        introContext: candidate,
        fields: { focus: candidate.focus, tips: candidate.tips },
      },
      {
        auditFields: ['examples'],
        introContext: candidate,
        fields: { examples: candidate.examples },
      },
      { auditFields: ['visuals'], introContext: candidate, fields: { visuals: candidate.visuals } },
    ]);
    expect(result.teachingFailure?.reviews).toEqual([
      {
        candidate: JSON.stringify(requestItems.map(({ content }: { content: unknown }) => content)),
        verdict: rawVerdict,
      },
    ]);
    expect(result.feedback).toEqual([
      {
        index: 0,
        feedback: [
          'purpose: “fertigen Aktivitäten” is unnatural here.',
          'examples: examples[0].meaning adds being on foot, which is not stated. examples[0].note does not describe the supplied example.',
        ],
      },
    ]);
  });

  it('reviews the four required prose groups when visuals are absent', async () => {
    const candidateWithoutVisuals = { ...candidate };
    delete (candidateWithoutVisuals as Partial<typeof candidate>).visuals;
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(verdict([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }])),
      model: 'captured-luna',
      inputTokens: 12,
      outputTokens: 8,
    });

    await expect(
      reviewTeachingContent({ ...options, items: [candidateWithoutVisuals] })
    ).resolves.toBeUndefined();

    const { items } = JSON.parse(boundary.generate.mock.calls[0]![1][0].content);
    expect(
      items.map(({ index, content }: { index: number; content: { auditFields: string[] } }) => [
        index,
        content.auditFields,
      ])
    ).toEqual([
      [0, ['purpose']],
      [1, ['about']],
      [2, ['focus', 'tips']],
      [3, ['examples']],
    ]);
  });

  it.each([
    verdict([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]),
    verdict([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 3 }]),
  ])('fails closed when an intro review omits or duplicates a scope', async (response) => {
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(response),
      model: 'captured-luna',
      inputTokens: 12,
      outputTokens: 8,
    });

    await expect(reviewTeachingContent(options)).rejects.toBeInstanceOf(ReviewerProtocolError);
  });

  it('fails closed rather than truncating scope feedback beyond the repair bound', async () => {
    const tooMuchFeedback = ['x'.repeat(170), 'y'.repeat(170)];
    const rawVerdict = verdict([
      { index: 0, acceptable: false, feedback: tooMuchFeedback },
      { index: 1 },
      { index: 2 },
      { index: 3 },
      { index: 4 },
    ]);
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(rawVerdict),
      model: 'captured-luna',
      inputTokens: 12,
      outputTokens: 8,
    });

    const error = await reviewTeachingContent(options).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ReviewerProtocolError);
    if (!(error instanceof ReviewerProtocolError)) throw error;
    expect(error.teachingFailure?.reviews).toEqual([
      {
        candidate: expect.any(String),
        verdict: rawVerdict,
      },
    ]);
    expect(JSON.parse(error.teachingFailure!.reviews[0]!.candidate!)).toEqual(
      JSON.parse(boundary.generate.mock.calls[0]![1][0].content).items.map(
        ({ content }: { content: unknown }) => content
      )
    );
  });
});
