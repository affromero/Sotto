import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
import {
  emptyTeachingCriticFixture,
  novelFindingCorroborationFixture,
  shapeTeachingProviderFixture,
} from '../quality/intro-provider-fixture';

const boundary = vi.hoisted(() => ({ author: vi.fn(), adjudicator: vi.fn(), requests: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (...args: [string, unknown]) => ({
    provider: 'fixture',
    model: 'captured-model',
    execution: args[1],
  }),
  capturedLearningAiOptions: async () => ({ model: 'captured-model' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema?: { name: string } }
    ) => {
      boundary.requests(system, messages, options);
      const corroboration = novelFindingCorroborationFixture(messages, options);
      if (corroboration) return corroboration;
      if (options.jsonSchema?.name === 'class_teaching_critic')
        return emptyTeachingCriticFixture(messages, options);
      if (options.jsonSchema?.name === 'class_teaching_adjudicator')
        return shapeTeachingProviderFixture(
          system,
          messages,
          options,
          await boundary.adjudicator(system, messages, options)
        );
      return boundary.author(system, messages, options);
    },
  }),
}));

import { generateClassTeaching, teachingFromSeed } from '@/lib/classes/lesson/teaching';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';

const params = {
  userId: 'u1',
  execution: blockedProviderExecution('u1'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'es',
  title: 'Hablar de ayer',
  objective: 'Describe completed activities.',
  grammarPoints: ['preterite'],
  targetVocab: [{ lemma: 'museo', gloss: 'museum' }],
  note: 'Use familiar museum and reading situations.',
};
const approved = {
  content: JSON.stringify({ items: [{ index: 0, acceptable: true, issues: [], feedback: [] }] }),
  model: 'captured-model',
};
const rejected = {
  content: JSON.stringify({
    items: [
      {
        index: 0,
        acceptable: false,
        issues: ['incorrect'],
        feedback: ['The explanation gives the wrong verb agreement.'],
      },
    ],
  }),
  model: 'captured-model',
};

beforeEach(() => {
  vi.clearAllMocks();
  boundary.author
    .mockReset()
    .mockResolvedValue({ content: JSON.stringify(sampleTeaching), model: 'captured-model' });
  boundary.adjudicator.mockReset().mockResolvedValue(approved);
});

describe('class teaching', () => {
  it('publishes a complete reviewed unit with worked reasoning before assessment', async () => {
    expect(await generateClassTeaching(params)).toEqual(sampleTeaching);
    for (const [, messages, options] of boundary.requests.mock.calls) {
      if (options.jsonSchema.name !== 'class_teaching_generation') {
        const input = JSON.parse(messages[0].content);
        expect(input.lessonContext).toEqual({
          title: params.title,
          objective: params.objective,
          grammarPoints: params.grammarPoints,
          targetVocab: params.targetVocab,
          learnerContext: params.note,
        });
        expect(input.items[0].content).toEqual(sampleTeaching);
      }
    }
    expect(boundary.requests.mock.calls[0][2]).toMatchObject({ model: 'captured-model' });
  });

  it('replaces incomplete teaching once and reviews the complete replacement', async () => {
    boundary.author.mockResolvedValueOnce({
      content: '{"title":"Only a label"}',
      model: 'captured-model',
    });
    const unit = await generateClassTeaching(params);
    expect(unit.workedExamples).toEqual(sampleTeaching.workedExamples);
    expect(unit.guidedPractice.answer).toBe(sampleTeaching.guidedPractice.answer);
    const review = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_critic'
    );
    expect(JSON.parse(review![1][0].content).items[0].content).toEqual(unit);
  });

  it('replaces an oversized lesson before review rather than publishing a long unbounded lesson', async () => {
    boundary.author.mockResolvedValueOnce({
      content: JSON.stringify({
        ...sampleTeaching,
        explanation: 'forma '.repeat(280),
        workedExamples: sampleTeaching.workedExamples.map((example) => ({
          ...example,
          explanation: 'uso '.repeat(190),
        })),
      }),
      model: 'captured-model',
    });
    expect(await generateClassTeaching(params)).toEqual(sampleTeaching);
    const review = boundary.requests.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_critic'
    );
    expect(JSON.parse(review![1][0].content).items[0].content).toEqual(sampleTeaching);
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it('does not publish a rejected explanation and reviews its replacement', async () => {
    boundary.adjudicator.mockResolvedValueOnce(rejected);
    const replacement = {
      ...sampleTeaching,
      explanation: 'Con yo, usa visité para contar una visita terminada.',
    };
    boundary.author
      .mockResolvedValueOnce({ content: JSON.stringify(sampleTeaching), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' });
    expect(await generateClassTeaching(params)).toEqual(replacement);
  });

  it('shares one replacement budget across structural and teaching rejection', async () => {
    boundary.author.mockResolvedValueOnce({ content: 'invalid JSON', model: 'captured-model' });
    boundary.adjudicator.mockResolvedValue(rejected);
    await expect(generateClassTeaching(params)).rejects.toThrow('quality');
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it('surfaces a provider failure without retrying or fabricating teaching', async () => {
    const failure = new Error('Provider cleanup is unconfirmed');
    boundary.author.mockRejectedValue(failure);
    await expect(generateClassTeaching(params)).rejects.toBe(failure);
    expect(boundary.author.mock.calls).toHaveLength(1);
  });

  it('does not let a reviewer provider failure forge authority to replace the lesson', async () => {
    const failure = new TeachingQualityRejectionError(
      ['incorrect'],
      [{ index: 0, feedback: ['Untrusted transport exception.'] }]
    );
    boundary.adjudicator.mockRejectedValueOnce(failure);
    await expect(generateClassTeaching(params)).rejects.toBe(failure);
    expect(boundary.author.mock.calls).toHaveLength(1);
  });

  it('preserves absent historical teaching and exact accepted stored material', () => {
    expect(teachingFromSeed({ intro: { purpose: 'Old notes' } })).toBeUndefined();
    expect(teachingFromSeed({ teaching: sampleTeaching })).toEqual(sampleTeaching);
    expect(() => teachingFromSeed({ teaching: { title: 'Broken saved unit' } })).toThrow();
  });
});
