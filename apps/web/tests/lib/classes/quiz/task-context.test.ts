import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
import type { SectionGenParams } from '@/lib/class-generation';
import { withReadingSupportFixture } from '../quality/teaching/reading-support-fixture';

const boundary = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'fixture', model: 'fixture-model' }),
  capturedLearningAiOptions: async () => ({ model: 'fixture-model' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { generateSectionQuestions } from '@/lib/class-generation';

const context = 'Ergänze die Lücke im Perfekt.';
const sentence = 'Gestern _____ ich zu Hause geblieben.';
const base: SectionGenParams = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  skill: 'GRAMMAR',
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Describe a past event',
  grammarPoints: ['Perfekt'],
  targetVocab: [],
  seed: 'fixture',
};
type Request = { name: string; system: string; input: Record<string, unknown>; schema: unknown };
const requests: Request[] = [];

function configure(
  params: SectionGenParams,
  taskContext: unknown,
  malformed = false,
  patch: Record<string, unknown> = {}
) {
  let generation = 0;
  boundary.generate.mockImplementation(
    async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema: { name: string; schema: unknown } }
    ) => {
      const name = options.jsonSchema.name;
      const input = name === 'class_section_questions' ? {} : JSON.parse(messages[0].content);
      requests.push({ name, system, input, schema: options.jsonSchema.schema });
      let output: unknown;
      if (name === 'class_section_questions') {
        generation++;
        if (malformed && generation < 3) return { content: '{', model: 'fixture-model' };
        output = {
          passage: params.skill === 'READING' ? 'Ein kurzer Text.' : '',
          questions: Array.from(
            { length: params.vocabularyReview ? params.targetVocab.length : 5 },
            (_, targetIndex) => ({
              ...(taskContext === undefined ? {} : { taskContext }),
              question: sentence,
              ...(params.vocabularyReview
                ? { targetIndex, distractors: ['war', 'habe', 'hatte'] }
                : { options: ['bin', 'war', 'habe', 'hatte'] }),
              correctIndex: 0,
              explanation: 'Das Perfekt verwendet hier bin.',
              passageRef: '',
              ...patch,
            })
          ),
        };
      } else if (name === 'class_section_quality') {
        const items = input.questions as unknown[];
        output = {
          passageFindings: [],
          issues: [],
          questions: items.map((_, index) => ({
            index,
            acceptableOptionIndices: [patch.correctIndex ?? 0],
            issues: [],
          })),
        };
      } else {
        const items = input.items as Array<{ index: number }>;
        output = {
          items: items.map(({ index }) =>
            name === 'class_teaching_critic'
              ? { index, findings: [] }
              : { index, criticDecisions: [], newFindings: [] }
          ),
        };
      }
      return withReadingSupportFixture(messages, options, {
        content: JSON.stringify(output),
        model: 'fixture-model',
      });
    }
  );
}

beforeEach(() => {
  boundary.generate.mockReset();
  requests.length = 0;
});

describe('compiled grammar and vocabulary task context', () => {
  it.each([0, 1, 2, 3])(
    'inserts the exact authoritative lemma at the selected position %i',
    async (correctIndex) => {
      const params = {
        ...base,
        vocabularyReview: true,
        targetVocab: [{ lemma: 'gestern', gloss: 'yesterday' }],
      };
      configure(params, 'Es geht um den einzelnen Abend vor heute.', false, { correctIndex });
      const result = await generateSectionQuestions(params);
      expect(result[0].options[correctIndex]).toBe('gestern');
      expect(result[0].correctIndex).toBe(correctIndex);
      expect(result[0]).not.toHaveProperty('targetIndex');
      expect(result[0]).not.toHaveProperty('distractors');
      expect(JSON.stringify(requests[0].schema)).not.toContain('"options"');
      expect(
        JSON.stringify(requests.find((request) => request.name === 'class_section_quality')!.input)
      ).toContain('gestern');
    }
  );
  it.each([
    { targetIndex: -1 },
    { targetIndex: 1 },
    { targetIndex: 0.5 },
    { distractors: ['bin', 'habe', 'hatte'] },
    { distractors: ['war', 'war', 'hatte'] },
    { options: ['bin', 'war', 'habe', 'hatte'] },
  ])('rejects invalid private indexed vocabulary choices: %j', async (patch) => {
    const params = {
      ...base,
      vocabularyReview: true,
      targetVocab: [{ lemma: 'bin', gloss: 'am' }],
    };
    configure(params, context, false, patch);
    await expect(generateSectionQuestions(params)).rejects.toThrow();
    expect(requests.every((request) => request.name === 'class_section_questions')).toBe(true);
  });
  it('requires every authoritative target exactly once', async () => {
    const params = {
      ...base,
      vocabularyReview: true,
      targetVocab: [
        { lemma: 'bin', gloss: 'am' },
        { lemma: 'ist', gloss: 'is' },
      ],
    };
    configure(params, context, false, { targetIndex: 0 });
    await expect(generateSectionQuestions(params)).rejects.toThrow();
    expect(requests.every((request) => request.name === 'class_section_questions')).toBe(true);
  });
  it.each(['_____', 'A _____.', 'A sentence without a gap.', 'One _____ and another _____.'])(
    'does not let task context conceal an invalid bare vocabulary cloze: %s',
    async (question) => {
      const params = {
        ...base,
        vocabularyReview: true,
        targetVocab: [{ lemma: 'bin', gloss: 'am' }],
      };
      configure(params, context, false, { question });
      await expect(generateSectionQuestions(params)).rejects.toThrow();
      expect(requests.every((request) => request.name === 'class_section_questions')).toBe(true);
    }
  );
  it.each([
    { vocabulary: false, repair: false },
    { vocabulary: false, repair: true },
    { vocabulary: true, repair: false },
    { vocabulary: true, repair: true },
  ])(
    'presents context before every review and public output: %j',
    async ({ vocabulary, repair }) => {
      const params = {
        ...base,
        vocabularyReview: vocabulary,
        targetVocab: vocabulary ? [{ lemma: 'bin', gloss: 'am' }] : [],
      };
      configure(params, context, repair);
      const result = await generateSectionQuestions(params);
      expect(result.every((item) => item.question === `${context}\n${sentence}`)).toBe(true);
      expect(result.every((item) => !Object.hasOwn(item, 'taskContext'))).toBe(true);
      const blind = requests.find((request) => request.name === 'class_section_quality')!;
      expect(JSON.stringify(blind.input)).toContain(`${context}\\n${sentence}`);
      for (const request of requests.filter((request) =>
        request.name.startsWith('class_teaching_')
      ))
        expect(JSON.stringify(request.input)).toContain(`${context}\\n${sentence}`);
      for (const request of requests.filter(
        (request) => request.name === 'class_section_questions'
      )) {
        expect(JSON.stringify(request.schema)).toContain('taskContext');
        expect(request.system).toContain('"taskContext":');
        if (!vocabulary)
          expect(request.system).toContain('identify its lemma in the learner-visible taskContext');
      }
    }
  );
  it.each([undefined, '', '  ', 'x'.repeat(401), 'Use _____ here.'].map((value) => ({ value })))(
    'rejects omitted, blank, oversized or extra-gap context: %j',
    async ({ value }) => {
      configure(base, value);
      await expect(generateSectionQuestions(base)).rejects.toThrow();
      expect(requests.every((request) => request.name === 'class_section_questions')).toBe(true);
    }
  );
  it('keeps reading wire and published questions unchanged', async () => {
    const params = { ...base, skill: 'READING' as const };
    configure(params, undefined);
    const result = await generateSectionQuestions(params);
    expect(result[0].question).toBe(sentence);
    expect(JSON.stringify(requests[0].schema)).not.toContain('taskContext');
    expect(requests[0].system).not.toContain('"taskContext":');
  });
});
