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
  getIntroRepairPlan,
  ReviewerProtocolError,
  TeachingQualityRejectionError,
  reviewTeachingContent,
  requestTeachingReview,
  TEACHING_QUALITY_JSON_SCHEMA,
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
const options = {
  ai: {
    provider: 'fixture',
    model: 'captured-luna',
    signal: new AbortController().signal,
    execution: blockedProviderExecution('fixture'),
  },
  provider: { generateResponse: boundary.generate } as never,
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

function reviewedBatch(callIndex: number) {
  return JSON.parse(boundary.generate.mock.calls[callIndex]![1][0].content).items as Array<{
    index: number;
    content: { address: { field: string; index?: number }; fields: unknown };
  }>;
}

function acceptedBatch(size: number) {
  return verdict(Array.from({ length: size }, (_, index) => ({ index })));
}

async function rejectedExamples(reviewOptions = options): Promise<TeachingQualityRejectionError> {
  boundary.generate.mockResolvedValueOnce({
    content: JSON.stringify(
      verdict([
        { index: 0 },
        { index: 1 },
        { index: 2 },
        { index: 3 },
        { index: 4, acceptable: false, feedback: ['examples[0].meaning is unsupported.'] },
      ])
    ),
    model: 'captured-luna',
  });
  const failure = await reviewTeachingContent(reviewOptions).catch((error: unknown) => error);
  if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
  return failure;
}

describe('intro audit addresses', () => {
  beforeEach(() => {
    boundary.generate
      .mockReset()
      .mockImplementation(async (_system: string, messages: Array<{ content: string }>) => {
        const count = JSON.parse(messages[0]!.content).items.length;
        return { content: JSON.stringify(acceptedBatch(count)), model: 'captured-luna' };
      });
  });

  it('rejects intro context attached to another teaching audit before provider dispatch', async () => {
    await expect(
      requestTeachingReview({
        ai: options.ai,
        provider: options.provider,
        userId: options.userId,
        prompt: 'class/review-teaching-content.md',
        variables: {},
        items: [{ explanation: 'Reviewed explanation.' }],
        introContext: candidate,
        jsonSchema: TEACHING_QUALITY_JSON_SCHEMA,
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it('reviews all atomic addresses in sequential batches of at most five', async () => {
    const fullCandidate = {
      ...candidate,
      focus: Array.from({ length: 6 }, (_, index) => `focus ${index}`),
      tips: Array.from({ length: 5 }, (_, index) => `tip ${index}`),
      examples: Array.from({ length: 5 }, (_, index) => ({
        target: `target ${index}`,
        meaning: `meaning ${index}`,
        note: `note ${index}`,
      })),
    };
    const expectedAddresses = [
      { field: 'purpose' },
      { field: 'about' },
      ...Array.from({ length: 6 }, (_, index) => ({ field: 'focus', index })),
      ...Array.from({ length: 5 }, (_, index) => ({ field: 'tips', index })),
      ...Array.from({ length: 5 }, (_, index) => ({ field: 'examples', index })),
      { field: 'visuals' },
    ];
    for (const length of [5, 5, 5, 4])
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify(acceptedBatch(length)),
        model: 'captured-luna',
      });

    await expect(
      reviewTeachingContent({ ...options, items: [fullCandidate] })
    ).resolves.toBeUndefined();

    expect(boundary.generate).toHaveBeenCalledTimes(4);
    expect(
      boundary.generate.mock.calls.map((call) => JSON.parse(call[1][0].content).items.length)
    ).toEqual([5, 5, 5, 4]);
    expect(
      boundary.generate.mock.calls.flatMap((_, index) =>
        reviewedBatch(index).map(({ content }) => content.address)
      )
    ).toEqual(expectedAddresses);
    expect(reviewedBatch(3).map(({ index, content }) => [index, content.address])).toEqual([
      [0, { field: 'examples', index: 2 }],
      [1, { field: 'examples', index: 3 }],
      [2, { field: 'examples', index: 4 }],
      [3, { field: 'visuals' }],
    ]);
    for (const call of boundary.generate.mock.calls) {
      const request = JSON.parse(call[1][0].content);
      expect(request.introContext).toEqual(fullCandidate);
      expect(
        request.items.every(
          ({ content }: { content: object }) => !Object.hasOwn(content, 'introContext')
        )
      ).toBe(true);
    }
  });

  it('captures the final global address in bounded intro failure evidence', async () => {
    const fullCandidate = {
      ...candidate,
      focus: Array.from({ length: 6 }, (_, index) => `focus ${index}`),
      tips: Array.from({ length: 5 }, (_, index) => `tip ${index}`),
      examples: Array.from({ length: 5 }, (_, index) => ({
        target: `target ${index}`,
        meaning: `meaning ${index}`,
        note: `note ${index}`,
      })),
    };
    for (const length of [5, 5, 5])
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify(acceptedBatch(length)),
        model: 'captured-luna',
      });
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(
        verdict([
          { index: 0 },
          { index: 1 },
          { index: 2 },
          { index: 3, acceptable: false, feedback: ['The visual is unsupported.'] },
        ])
      ),
      model: 'captured-luna',
    });

    const failure = await reviewTeachingContent({ ...options, items: [fullCandidate] }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(getIntroRepairPlan(failure)).toEqual({
      rejectedAddresses: [{ field: 'visuals' }],
      rejectedFields: ['visuals'],
      preserveVisuals: false,
    });
    expect(failure.teachingFailure?.reviews[0]?.verdict.items).toHaveLength(19);
    expect(failure.teachingFailure?.reviews[0]?.verdict.items.at(-1)).toEqual({
      index: 18,
      acceptable: false,
      issues: ['unnatural'],
      feedback: ['The visual is unsupported.'],
    });
  });

  it.each([
    verdict([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]),
    verdict([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 2 }, { index: 4 }]),
  ])('fails closed when a batch omits or duplicates an address', async (response) => {
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(response),
      model: 'captured-luna',
    });

    await expect(reviewTeachingContent(options)).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(boundary.generate).toHaveBeenCalledTimes(1);
  });

  it('accepts a complete batch verdict returned in a different order', async () => {
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(
        verdict([{ index: 4 }, { index: 3 }, { index: 2 }, { index: 1 }, { index: 0 }])
      ),
      model: 'captured-luna',
    });

    await expect(reviewTeachingContent(options)).resolves.toBeUndefined();
  });

  it('maps exact rejected addresses into the authenticated repair plan and retains full feedback', async () => {
    const rawVerdict = verdict([
      { index: 0 },
      { index: 1 },
      { index: 2, acceptable: false, feedback: ['focus entry has an unsupported rule.'] },
      { index: 3 },
      { index: 4, acceptable: false, feedback: ['example meaning adds an event.'] },
    ]);
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(rawVerdict), model: 'captured-luna' })
      .mockResolvedValueOnce({
        content: JSON.stringify(verdict([{ index: 0 }])),
        model: 'captured-luna',
      });

    const failure = await reviewTeachingContent(options).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(getIntroRepairPlan(failure)).toEqual({
      rejectedAddresses: [
        { field: 'focus', index: 0 },
        { field: 'examples', index: 0 },
      ],
      rejectedFields: ['focus', 'examples'],
      preserveVisuals: true,
    });
    expect(failure.feedback).toEqual([
      {
        index: 0,
        feedback: [
          'focus: focus[0]: focus entry has an unsupported rule.',
          'examples: examples[0]: example meaning adds an event.',
        ],
      },
    ]);
    expect(failure.teachingFailure?.reviews[0]?.verdict).toEqual({
      items: [
        ...rawVerdict.items.slice(0, 3),
        { ...rawVerdict.items[3], index: 3 },
        { ...rawVerdict.items[4], index: 4 },
        { index: 5, acceptable: true, issues: [], feedback: [] },
      ],
    });
    expect(captureGenerationFailure(failure).category).toBe('teaching_rejected');
  });

  it('does not expose authenticated addresses through an oversized failure repair plan', async () => {
    const oversizedCandidate = { ...candidate, purpose: 'x'.repeat(40_000) };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(
        verdict([
          { index: 0, acceptable: false, feedback: ['The purpose is unclear.'] },
          { index: 1 },
          { index: 2 },
          { index: 3 },
          { index: 4 },
        ])
      ),
      model: 'captured-luna',
    });

    const failure = await reviewTeachingContent({ ...options, items: [oversizedCandidate] }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(failure.teachingFailure?.reviews[0]).toMatchObject({
      candidate: null,
      omitted: 'size_limit',
    });

    const firstPlan = getIntroRepairPlan(failure);
    (firstPlan.rejectedAddresses[0] as { field: string }).field = 'visuals';
    expect(getIntroRepairPlan(failure)).toEqual({
      rejectedAddresses: [{ field: 'purpose' }],
      rejectedFields: ['purpose'],
      preserveVisuals: true,
    });
  });

  it('re-audits every address after repair and catches an initially missed defect', async () => {
    const manyExamples = {
      ...candidate,
      examples: Array.from({ length: 5 }, (_, index) => ({
        target: `target ${index}`,
        meaning: `meaning ${index}`,
        note: `note ${index}`,
      })),
    };
    const initial = (
      items: Array<{ index: number; content: { address: { field: string; index?: number } } }>
    ) =>
      verdict(
        items.map(({ index, content }) => ({
          index,
          acceptable: !(content.address.field === 'examples' && content.address.index === 4),
          feedback:
            content.address.field === 'examples' && content.address.index === 4
              ? ['This example has a meaning defect.']
              : [],
        }))
      );
    const final = (
      items: Array<{ index: number; content: { address: { field: string; index?: number } } }>
    ) =>
      verdict(
        items.map(({ index, content }) => {
          const missed =
            (content.address.field === 'examples' && content.address.index === 2) ||
            content.address.field === 'visuals';
          return {
            index,
            acceptable: !missed,
            feedback: missed
              ? [`Defect at ${content.address.field}[${content.address.index ?? ''}].`]
              : [],
          };
        })
      );
    let initialReview = true;
    boundary.generate.mockImplementation(
      async (_system: string, messages: Array<{ content: string }>) => {
        const items = JSON.parse(messages[0]!.content).items;
        return {
          content: JSON.stringify(initialReview ? initial(items) : final(items)),
          model: 'captured-luna',
        };
      }
    );
    const firstFailure = await reviewTeachingContent({ ...options, items: [manyExamples] }).catch(
      (error: unknown) => error
    );
    expect(firstFailure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(firstFailure instanceof TeachingQualityRejectionError)) throw firstFailure;
    expect(getIntroRepairPlan(firstFailure).rejectedAddresses).toEqual([
      { field: 'examples', index: 4 },
    ]);
    initialReview = false;

    const finalFailure = await reviewTeachingContent({
      ...options,
      items: [manyExamples],
      previousIntroRejection: firstFailure,
    }).catch((error: unknown) => error);
    expect(finalFailure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(finalFailure instanceof TeachingQualityRejectionError)) throw finalFailure;
    expect(boundary.generate).toHaveBeenCalledTimes(4);
    expect(reviewedBatch(2)).toHaveLength(5);
    expect(reviewedBatch(3)).toHaveLength(5);
    expect(finalFailure.feedback[0]?.feedback).toEqual([
      'examples: examples[2]: Defect at examples[2].',
      'visuals: visuals: Defect at visuals[].',
    ]);
    expect(firstFailure.teachingFailure?.reviews).toHaveLength(1);
    expect(finalFailure.teachingFailure?.reviews).toHaveLength(1);
    expect(captureGenerationFailure(finalFailure).teachingFailure?.reviews).toHaveLength(1);
  });

  it('rejects fabricated or reused repair authority before sending another review', async () => {
    const fabricated = new TeachingQualityRejectionError(['incorrect'], [], {
      kind: 'intro',
      reviews: [
        {
          candidate: 'Fabricated review input',
          verdict: {
            items: [
              { index: 0, acceptable: false, issues: ['incorrect'], feedback: ['Fabricated'] },
            ],
          },
        },
      ],
    });
    await expect(
      reviewTeachingContent({ ...options, previousIntroRejection: fabricated })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it('re-audits every exact address with the changed complete intro after repair', async () => {
    const previousIntroRejection = await rejectedExamples();
    const changed = structuredClone(candidate);
    changed.examples[0].target += ' Heute.';
    changed.purpose += ' Heute.';
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(acceptedBatch(5)), model: 'captured-luna' })
      .mockResolvedValueOnce({ content: JSON.stringify(acceptedBatch(1)), model: 'captured-luna' });

    await expect(
      reviewTeachingContent({ ...options, items: [changed], previousIntroRejection })
    ).resolves.toBeUndefined();
    const supplied = [...reviewedBatch(2), ...reviewedBatch(3)];
    expect(supplied.map(({ content }) => content.address)).toEqual([
      { field: 'purpose' },
      { field: 'about' },
      { field: 'focus', index: 0 },
      { field: 'tips', index: 0 },
      { field: 'examples', index: 0 },
      { field: 'visuals' },
    ]);
    for (const callIndex of [2, 3]) {
      expect(
        JSON.parse(boundary.generate.mock.calls[callIndex]![1][0].content).introContext
      ).toEqual(changed);
    }
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
  ])('rejects a prior receipt after changing %s identity', async (identity) => {
    const ai = {
      ...options.ai,
      apiKey: undefined as string | undefined,
      execution: { ...options.ai.execution },
    };
    const initial = { ...options, ai };
    const previousIntroRejection = await rejectedExamples(initial);
    const replacement = { ...initial, previousIntroRejection };
    if (identity === 'learner') replacement.userId = 'another-learner';
    if (identity === 'context')
      replacement.lessonContext = { ...initial.lessonContext, objective: 'Different objective' };
    if (identity === 'provider')
      replacement.provider = { generateResponse: boundary.generate } as never;
    if (identity === 'model') ai.model = 'another-model';
    if (identity === 'key') ai.apiKey = 'different-fixture-key';
    if (identity === 'authority')
      ai.execution.authorize = async () => {
        throw new Error('Different authority');
      };
    if (identity === 'transport') ai.execution.providerRequest = async () => new Response();
    if (identity === 'selection')
      ai.execution.learningSelection = {
        provider: 'fixture',
        model: 'captured-luna',
        credentialFingerprint: 'different-selection',
      };
    boundary.generate.mockImplementation(() => {
      throw new Error('No provider dispatch expected');
    });
    await expect(reviewTeachingContent(replacement)).rejects.toBeInstanceOf(ReviewerProtocolError);
  });

  it('retains the authentic initial evidence when mutable rejection evidence is tampered with', async () => {
    const previousIntroRejection = await rejectedExamples();
    const authentic = structuredClone(previousIntroRejection.teachingFailure);
    previousIntroRejection.teachingFailure!.reviews[0]!.candidate = 'Tampered candidate';

    const failure = await reviewTeachingContent({
      ...options,
      previousIntroRejection,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ReviewerProtocolError);
    if (!(failure instanceof ReviewerProtocolError)) throw failure;
    expect(failure.teachingFailure).toEqual(authentic);
    expect(failure.teachingFailure?.reviews).toHaveLength(1);
  });
});
