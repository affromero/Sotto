import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceDocuments } from '@/lib/providers/ai';
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
  capturedLearningAiOptions: async (
    ai: { execution: { sourceDocuments?: SourceDocuments } },
    scope?: { includeSourceDocuments?: boolean }
  ) => ({
    model: 'captured-model',
    ...(scope?.includeSourceDocuments ? { sourceDocuments: ai.execution.sourceDocuments } : {}),
  }),
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
import { SectionQualityError } from '@/lib/classes/section-quality';
import {
  captureGenerationFailure,
  durableGenerationFailure,
} from '@/lib/classes/quality/generation-failure';

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
  it('reads the original workbook when authoring while keeping critic and adjudicator inputs isolated', async () => {
    const sourceDocuments: SourceDocuments = {
      parts: [
        {
          type: 'document',
          mediaType: 'application/pdf',
          name: 'Workbook.pdf',
          data: Buffer.from('%PDF-1.7'),
        },
      ],
      validate: async () => {},
    };
    expect(
      await generateClassTeaching({
        ...params,
        execution: { ...params.execution, sourceDocuments },
      })
    ).toEqual(sampleTeaching);
    expect(boundary.author.mock.calls[0][2].sourceDocuments).toBe(sourceDocuments);
    for (const [, , options] of boundary.requests.mock.calls)
      if (options.jsonSchema?.name !== 'class_teaching_generation')
        expect(options.sourceDocuments).toBeUndefined();
  });
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
    expect(boundary.author.mock.calls[0][0]).toContain(
      'Write the returned learner-visible title in the language required by this policy'
    );
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

  it('repairs coupled teaching fields with indexed feedback and reviews the complete replacement', async () => {
    boundary.adjudicator.mockResolvedValueOnce(rejected);
    const candidate = {
      ...sampleTeaching,
      guidedPractice: {
        prompt: 'Cuenta que Ana comió en el museo ayer.',
        hint: 'Usa comió.',
        answer: 'Ana pidió comida en el museo ayer.',
        explanation: 'Pedir comida significa comerla.',
      },
    };
    const replacement = {
      ...sampleTeaching,
      guidedPractice: {
        prompt: 'Cuenta que Ana comió en el museo ayer.',
        hint: 'Relaciona el verbo con Ana y una actividad terminada.',
        answer: 'Ana comió en el museo ayer.',
        explanation: 'Comió expresa la actividad terminada de Ana.',
      },
    };
    boundary.author
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(replacement), model: 'captured-model' });
    expect(await generateClassTeaching(params)).toEqual(replacement);
    const [system, messages, options] = boundary.author.mock.calls[1];
    expect(system).toContain(params.objective);
    expect(system).toContain('every required fact');
    expect(messages[0].content).toContain(
      'Repair the prompt, answer, explanation and hint together'
    );
    expect(JSON.parse(messages[0].content.slice(messages[0].content.indexOf('\n') + 1))).toEqual({
      candidate,
      issues: ['incorrect'],
      feedback: [
        {
          index: 0,
          feedback: [
            'The explanation gives the wrong verb agreement. Correction: Use accurate supported teaching.',
          ],
        },
      ],
    });
    expect(options.model).toBe('captured-model');
    const reviewed = boundary.requests.mock.calls
      .filter(([, , request]) => request.jsonSchema.name === 'class_teaching_critic')
      .map(([, request]) => JSON.parse(request[0].content).items[0].content);
    expect(reviewed).toEqual([candidate, replacement]);
  });

  it('shares one replacement budget across structural and teaching rejection', async () => {
    boundary.author.mockResolvedValueOnce({ content: 'invalid JSON', model: 'captured-model' });
    boundary.adjudicator.mockResolvedValue(rejected);
    await expect(generateClassTeaching(params)).rejects.toThrow('quality');
    expect(boundary.author.mock.calls).toHaveLength(2);
  });

  it.each([
    ['invalid_json', '{incomplete'],
    ['invalid_item', JSON.stringify({ ...sampleTeaching, guidedPractice: undefined })],
    [
      'teaching_word_limit',
      JSON.stringify({
        ...sampleTeaching,
        explanation: 'uso '.repeat(400),
        workedExamples: sampleTeaching.workedExamples.map((example) => ({
          ...example,
          explanation: 'uso '.repeat(190),
        })),
      }),
    ],
  ])(
    'retains the actual terminal %s replacement beside the earlier semantic rejection',
    async (code, content) => {
      boundary.adjudicator.mockResolvedValueOnce(rejected);
      boundary.author
        .mockResolvedValueOnce({ content: JSON.stringify(sampleTeaching), model: 'captured-model' })
        .mockResolvedValueOnce({ content, model: 'captured-model' });
      const error = await generateClassTeaching(params).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(SectionQualityError);
      const captured = captureGenerationFailure(error);
      expect(captured.category).toBe('section_quality');
      expect(captured.attemptFailures).toEqual([
        { attempt: 1, type: 'teaching', failure: captured.teachingFailure },
        { attempt: 2, type: 'structure', kind: 'teaching', candidate: content, issues: [{ code }] },
      ]);
      expect(JSON.parse(captured.teachingFailure!.reviews[0]!.candidate!)[0].items).toEqual([
        sampleTeaching,
      ]);
      const durable = durableGenerationFailure(captured);
      expect(durable.teachingFailure?.kind).toBe('explanations');
      expect(durable.attemptFailures?.[1]).toEqual(captured.attemptFailures?.[1]);
      expect(durable.attemptFailures?.[0]).toMatchObject({ failure: { kind: 'explanations' } });
      expect(JSON.stringify(error)).not.toContain(content);
      expect(boundary.author.mock.calls).toHaveLength(2);
    }
  );

  it('omits an oversized malformed lesson response without exposing it through the error', async () => {
    const content = 'private '.repeat(5000);
    boundary.author.mockResolvedValue({ content, model: 'captured-model' });
    const error = await generateClassTeaching(params).catch((failure: unknown) => failure);
    expect(captureGenerationFailure(error).attemptFailures).toEqual(
      [1, 2].map((attempt) => ({
        attempt,
        type: 'structure',
        kind: 'teaching',
        candidate: null,
        omitted: 'size_limit',
        issues: [{ code: 'invalid_json' }],
      }))
    );
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('preserves prior teaching evidence and the exact terminal provider exception without another retry', async () => {
    const failure = new Error('Provider cleanup is unconfirmed');
    boundary.adjudicator.mockResolvedValueOnce(rejected);
    boundary.author
      .mockResolvedValueOnce({ content: JSON.stringify(sampleTeaching), model: 'captured-model' })
      .mockRejectedValueOnce(failure);
    await expect(generateClassTeaching(params)).rejects.toBe(failure);
    expect(captureGenerationFailure(failure)).toMatchObject({
      category: 'generation_failed',
      attemptFailures: [{ attempt: 1, type: 'teaching', failure: { kind: 'teaching' } }],
    });
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
