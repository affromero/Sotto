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
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

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
const grammarContext = {
  ...Object.fromEntries(Object.entries(candidate).filter(([field]) => field !== 'visuals')),
  examples: candidate.examples.map(({ target, note }) => ({ target, note })),
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
  beforeEach(() => {
    boundary.generate.mockReset();
  });

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
      {
        auditFields: ['purpose'],
        introContext: grammarContext,
        fields: { purpose: candidate.purpose },
      },
      { auditFields: ['about'], introContext: grammarContext, fields: { about: candidate.about } },
      {
        auditFields: ['focus', 'tips'],
        introContext: grammarContext,
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

  it('preserves valid scope feedback and its original review evidence beyond 300 aggregate characters', async () => {
    const validFeedback = ['x'.repeat(170), 'y'.repeat(170)];
    const rawVerdict = verdict([
      { index: 0, acceptable: false, feedback: validFeedback },
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
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.feedback).toEqual([
      { index: 0, feedback: [`purpose: ${validFeedback.join(' ')}`] },
    ]);
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

  async function rejectedExamples() {
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(
        verdict([
          { index: 0 },
          { index: 1 },
          { index: 2 },
          { index: 3, acceptable: false, feedback: ['examples[0].meaning adds being on foot.'] },
          { index: 4 },
        ])
      ),
      model: 'captured-luna',
    });
    const rejection = await reviewTeachingContent(options).catch((error: unknown) => error);
    if (!(rejection instanceof TeachingQualityRejectionError)) throw rejection;
    return rejection;
  }

  it('reviews changed meanings and their visual context with actual subset failure evidence', async () => {
    const previousIntroRejection = await rejectedExamples();
    const changed = {
      ...candidate,
      examples: [
        { ...candidate.examples[0], meaning: 'Der Satz berichtet, dass wir gegangen sind.' },
      ],
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(
        verdict([
          { index: 0 },
          { index: 1, acceptable: false, feedback: ['The visual adds an unsupported claim.'] },
        ])
      ),
      model: 'captured-luna',
    });
    const failure = await reviewTeachingContent({
      ...options,
      items: [changed],
      previousIntroRejection,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(failure.feedback).toEqual([
      { index: 0, feedback: ['visuals: The visual adds an unsupported claim.'] },
    ]);
    const supplied = JSON.parse(boundary.generate.mock.calls.at(-1)![1][0].content).items;
    expect(
      supplied.map(({ content }: { content: { auditFields: string[] } }) => content.auditFields)
    ).toEqual([['examples'], ['visuals']]);
    expect(JSON.parse(failure.teachingFailure!.reviews[0]!.candidate!)).toEqual(
      supplied.map(({ content }: { content: unknown }) => content)
    );
    expect(
      failure.teachingFailure!.reviews[0]!.verdict.items.map((item) => [
        item.index,
        item.acceptable,
      ])
    ).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it.each(['target', 'note', 'purpose', 'about', 'focus', 'tips'])(
    'requires fresh grammar review after changing %s',
    async (field) => {
      const previousIntroRejection = await rejectedExamples();
      const changed = structuredClone(candidate);
      if (field === 'target' || field === 'note') changed.examples[0][field] += ' Changed.';
      else if (field === 'purpose' || field === 'about') changed[field] += ' Changed.';
      else if (field === 'focus' || field === 'tips') changed[field][0] += ' Changed.';
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify(
          verdict([
            { index: 0 },
            { index: 1 },
            {
              index: 2,
              acceptable: false,
              feedback: ['focus: The altered context contradicts this rule.'],
            },
            { index: 3 },
            { index: 4 },
          ])
        ),
        model: 'captured-luna',
      });
      await expect(
        reviewTeachingContent({ ...options, items: [changed], previousIntroRejection })
      ).rejects.toBeInstanceOf(TeachingQualityRejectionError);
      const supplied = JSON.parse(boundary.generate.mock.calls.at(-1)![1][0].content).items;
      expect(
        supplied.map(({ content }: { content: { auditFields: string[] } }) => content.auditFields)
      ).toEqual([['purpose'], ['about'], ['focus', 'tips'], ['examples'], ['visuals']]);
    }
  );

  it('rejects fabricated prior approvals before any review request', async () => {
    boundary.generate.mockImplementation(() => {
      throw new Error('No provider dispatch expected');
    });
    const previousIntroRejection = new TeachingQualityRejectionError(['incorrect'], [], {
      kind: 'intro',
      reviews: [
        {
          candidate: 'Fabricated review input',
          verdict: {
            items: [
              {
                index: 0,
                acceptable: false,
                issues: ['incorrect'],
                feedback: ['Fabricated verdict'],
              },
            ],
          },
        },
      ],
    });
    const error = await reviewTeachingContent({ ...options, previousIntroRejection }).catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ReviewerProtocolError);
    if (!(error instanceof ReviewerProtocolError)) throw error;
    expect(error.teachingFailure).toBeUndefined();
    expect(captureGenerationFailure(error)).toEqual({ category: 'review_protocol' });
  });

  it('rejects reused review authority after the single replacement', async () => {
    const previousIntroRejection = await rejectedExamples();
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(verdict([{ index: 0 }])),
      model: 'captured-luna',
    });
    const changed = { ...candidate };
    delete (changed as Partial<typeof candidate>).visuals;
    await expect(
      reviewTeachingContent({ ...options, items: [changed], previousIntroRejection })
    ).resolves.toBeUndefined();
    await expect(
      reviewTeachingContent({ ...options, items: [changed], previousIntroRejection })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
  });

  it.each([
    'learner',
    'context',
    'provider',
    'model',
    'key',
    'authority',
    'transport',
    'selection',
  ])('rejects prior approvals after changing %s identity', async (identity) => {
    const ai = {
      ...options.ai,
      apiKey: undefined as string | undefined,
      execution: { ...options.ai.execution },
    };
    const initial = { ...options, ai };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(
        verdict([
          { index: 0 },
          { index: 1 },
          { index: 2 },
          { index: 3, acceptable: false, feedback: ['examples[0].meaning is unsupported.'] },
          { index: 4 },
        ])
      ),
      model: 'captured-luna',
    });
    const previousIntroRejection = await reviewTeachingContent(initial).catch(
      (error: unknown) => error
    );
    if (!(previousIntroRejection instanceof TeachingQualityRejectionError))
      throw previousIntroRejection;
    const replacement = { ...initial, previousIntroRejection };
    if (identity === 'learner') replacement.userId = 'another-learner';
    if (identity === 'context')
      replacement.lessonContext = {
        ...initial.lessonContext,
        objective: 'A different objective',
      };
    if (identity === 'provider')
      replacement.provider = { generateResponse: boundary.generate } as never;
    if (identity === 'model') ai.model = 'another-model';
    if (identity === 'key') ai.apiKey = 'a-different-fixture-key';
    if (identity === 'authority')
      ai.execution.authorize = async () => {
        throw new Error('Different authority');
      };
    if (identity === 'transport') ai.execution.providerRequest = async () => new Response();
    if (identity === 'selection')
      ai.execution.learningSelection = {
        provider: 'fixture',
        model: 'captured-luna',
        credentialFingerprint: 'a-different-selection',
      };
    boundary.generate.mockImplementation(() => {
      throw new Error('No provider dispatch expected');
    });
    await expect(reviewTeachingContent(replacement)).rejects.toBeInstanceOf(ReviewerProtocolError);
  });

  it('retains the actual first verdict when mutable error evidence is tampered with', async () => {
    const previousIntroRejection = await rejectedExamples();
    const authentic = structuredClone(previousIntroRejection.teachingFailure);
    previousIntroRejection.teachingFailure!.reviews[0]!.candidate = 'Tampered content';
    const error = await reviewTeachingContent({ ...options, previousIntroRejection }).catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ReviewerProtocolError);
    if (!(error instanceof ReviewerProtocolError)) throw error;
    expect(error.teachingFailure).toEqual(authentic);
    expect(error.teachingFailure!.reviews).toHaveLength(1);
  });
});
