import Ajv from 'ajv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOptions } from '@/lib/providers/ai';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async () => ({ model: 'captured-model' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { generateClassIntro } from '@/lib/classes/class-intro';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'B1',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Ausflüge',
  objective: 'Empfiehl einen Ausflug und nenne einen Grund.',
  grammarPoints: ['trotzdem', 'würde'],
  targetVocab: [],
};
const corrected = '„Würde“ macht die Empfehlung hier vorsichtig.';
const initial = {
  purpose: 'Empfiehl einen Ausflug und begründe deine Meinung.',
  about: { exampleIndex: 0 },
  examples: [
    {
      target: 'Der Weg ist weit. Trotzdem würde ich wieder kommen.',
      note: '„Würde“ macht eine bedingte Empfehlung.',
    },
    { target: 'Ich komme am Montag zurück.', note: '„Am Montag“ nennt den Tag.' },
  ],
  focus: [
    { text: '„Würde“ macht eine bedingte,/beschädigt?', exampleIndex: 0 },
    { text: '„Würde“ macht eine bedingte Empfehlung.', exampleIndex: 0 },
    { text: '„Am Montag“ nennt den Tag.', exampleIndex: 1 },
  ],
  tips: [{ text: 'Nenne außerdem einen Grund.', exampleIndex: 0 }],
  visuals: null,
};
const patch = {
  focus: { '0': { text: corrected, exampleIndex: 0 } },
  coherence: [
    { field: 'focus', index: 1, exampleIndex: 0, text: corrected },
    { field: 'examples', index: 0, note: corrected },
  ],
};
type Row = {
  index: number;
  content: { address: { field: string; index?: number }; fields: Record<string, unknown> };
  sourceParts: Array<{ index: number; fieldPath: string[] }>;
};

function respond(replacement: unknown = patch, raw: unknown = initial, rejected = 'focus:0') {
  let repaired = false;
  boundary.generate.mockImplementation(
    async (_system: string, messages: Array<{ content: string }>, options: AIOptions) => {
      const role = options.jsonSchema?.name;
      if (role === 'class_intro_generation') return { content: JSON.stringify(raw) };
      if (role === 'class_intro_repair') {
        repaired = true;
        return { content: JSON.stringify(replacement) };
      }
      const payload = JSON.parse(messages[0]!.content);
      return {
        content: JSON.stringify({
          items: payload.items.map((row: Row) => {
            const key = row.content.address.field + ':' + row.content.address.index;
            const bad = repaired
              ? /bedingte|beschädigt/u.test(JSON.stringify(row.content.fields))
              : key === rejected;
            const findings = bad
              ? [
                  {
                    sourcePartIndex: row.sourceParts.find(
                      (part) =>
                        row.content.address.field !== 'examples' || part.fieldPath.at(-1) === 'note'
                    )!.index,
                    issue: 'incorrect',
                    rule: 'Describe the form as used in the example.',
                    defect: repaired
                      ? 'The example has no condition; the recommendation is cautious.'
                      : 'The explanation ends in a damaged fragment.',
                    remedy: { kind: 'correction', text: corrected },
                  },
                ]
              : [];
            if (role === 'class_intro_critic') return { index: row.index, findings };
            const criticism = payload.criticisms.items.find(
              (item: Row) => item.index === row.index
            );
            return {
              index: row.index,
              criticDecisions: criticism.findings.map(
                (_finding: unknown, findingIndex: number) => ({
                  findingIndex,
                  decision: 'supported',
                  reason: 'The cited defect is present in this field.',
                })
              ),
              newFindings: [],
            };
          }),
        }),
      };
    }
  );
}
function repairRequest() {
  return boundary.generate.mock.calls.find(
    ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
  )!;
}
function reviewContexts() {
  return boundary.generate.mock.calls
    .filter(([, , options]) => options.jsonSchema?.name === 'class_intro_critic')
    .map(([, messages]) => JSON.parse(messages[0].content).introContext);
}
beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset().mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    execution: params.execution,
  });
});

describe('coherent introduction repairs', () => {
  it.each(['A1', 'B1'])(
    'corrects repeated claims in the same example while preserving unrelated %s content',
    async (level) => {
      const raw =
        level === 'A1'
          ? {
              ...initial,
              examples: initial.examples.map((example, index) => ({
                ...example,
                meaning:
                  index === 0
                    ? 'The journey is long. Still, I would come again.'
                    : 'I return on Monday.',
              })),
            }
          : initial;
      respond(patch, raw);
      const result = await generateClassIntro({ ...params, level });
      expect(result.focus[0]).toBe(`„${initial.examples[0]!.target}“: ${corrected}`);
      expect(result.focus[1]).toBe(result.focus[0]);
      expect(result.examples[0]!.note).toBe(result.focus[0]);
      const first = reviewContexts()[0];
      expect(result.purpose).toBe(first.purpose);
      expect(result.about).toBe(first.about);
      expect(result.focus[2]).toBe(first.focus[2]);
      expect(result.tips).toEqual(first.tips);
      expect(result.examples[1]).toEqual(first.examples[1]);
      expect(result.examples.map(({ target, meaning }) => ({ target, meaning }))).toEqual(
        first.examples.map(({ target, meaning }: { target: string; meaning: string }) => ({
          target,
          meaning,
        }))
      );
      expect(reviewContexts().at(-1)).toEqual(result);
      const [, messages, options] = repairRequest();
      const validate = new Ajv().compile(options.jsonSchema.schema);
      expect(validate(patch), JSON.stringify(validate.errors)).toBe(true);
      const evidence = messages[0].content
        .split('\n')
        .find((line: string) => line.startsWith('Adjudicated defect evidence: '));
      expect(
        JSON.parse(evidence.slice('Adjudicated defect evidence: '.length)).map(
          ({ address }: { address: unknown }) => address
        )
      ).toEqual([{ field: 'focus', index: 0 }]);
      expect(messages[0].content).toContain('Optional same-example coherence scope:');
    }
  );

  it('keeps wrong claims blocking even when the patch has valid coherence permissions', async () => {
    respond({
      ...patch,
      coherence: [{ field: 'focus', index: 1, exampleIndex: 0, text: corrected }],
    });
    const error = await generateClassIntro(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const failure = captureGenerationFailure(error);
    expect(failure.teachingFailure?.reviews).toHaveLength(2);
    const contexts = reviewContexts();
    expect(contexts.at(-1).examples[0].note).toContain('bedingte');
  });

  it('preserves all accepted bytes when coherence is null', async () => {
    const raw = {
      ...initial,
      focus: initial.focus.map((atom, index) =>
        index === 1 ? { ...atom, text: corrected } : atom
      ),
      examples: initial.examples.map((example, index) =>
        index === 0 ? { ...example, note: corrected } : example
      ),
    };
    respond({ ...patch, coherence: null }, raw);
    const result = await generateClassIntro(params);
    const first = reviewContexts()[0];
    expect({ ...result, focus: first.focus }).toEqual(first);
    expect(result.focus.slice(1)).toEqual(first.focus.slice(1));
  });

  it.each([
    ['unrelated note', [{ field: 'examples', index: 1, note: corrected }]],
    [
      'accepted target',
      [{ field: 'examples', index: 0, target: 'A replacement target.', note: corrected }],
    ],
    [
      'accepted meaning',
      [{ field: 'examples', index: 0, meaning: 'A replacement meaning.', note: corrected }],
    ],
    ['purpose', [{ field: 'purpose', text: 'Changed purpose.' }]],
    ['overview', [{ field: 'about', exampleIndex: 1 }]],
    ['unrelated focus', [{ field: 'focus', index: 2, exampleIndex: 1, text: corrected }]],
    ['retargeted observation', [{ field: 'focus', index: 1, exampleIndex: 1, text: corrected }]],
    [
      'overlapping required address',
      [{ field: 'focus', index: 0, exampleIndex: 0, text: corrected }],
    ],
    [
      'duplicate note',
      [
        { field: 'examples', index: 0, note: corrected },
        { field: 'examples', index: 0, note: corrected },
      ],
    ],
  ])('rejects a coherence patch that writes %s', async (_name, coherence) => {
    respond({ ...patch, coherence });
    const error = await generateClassIntro(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SectionQualityError);
    expect(error).not.toBeInstanceOf(TeachingQualityRejectionError);
    expect(reviewContexts().every((context) => context.focus[0].includes('beschädigt'))).toBe(true);
  });

  it('requires an explicit null or permitted coherence array at the provider boundary', async () => {
    respond({ focus: patch.focus });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(SectionQualityError);
    const validate = new Ajv().compile(repairRequest()[2].jsonSchema.schema);
    expect(validate({ focus: patch.focus })).toBe(false);
  });

  it('keeps the complete prose budget after a permitted note correction', async () => {
    respond({
      ...patch,
      coherence: [{ field: 'examples', index: 0, note: 'Erklärung '.repeat(181) }],
    });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(SectionQualityError);
    expect(reviewContexts().every((context) => context.focus[0].includes('beschädigt'))).toBe(true);
  });

  it('rebinds quotations before correcting observations affected by an example replacement', async () => {
    const raw = {
      ...initial,
      examples: [
        { target: 'Ich würde gestern wieder kommen.', note: '„Würde“ formuliert eine Absicht.' },
        initial.examples[1]!,
      ],
      focus: [
        { text: '„Gestern“ bezeichnet vergangene Zeit.', exampleIndex: 0 },
        initial.focus[2]!,
      ],
      tips: [{ text: 'Nenne einen vergangenen Zeitpunkt.', exampleIndex: 0 }],
    };
    const target = 'Ich würde morgen wieder kommen.';
    respond(
      {
        examples: { '0': { target, note: '„Würde“ formuliert eine Absicht.' } },
        coherence: [
          {
            field: 'focus',
            index: 0,
            exampleIndex: 0,
            text: '„Morgen“ bezeichnet zukünftige Zeit.',
          },
          { field: 'tips', index: 0, exampleIndex: 0, text: 'Nenne einen künftigen Zeitpunkt.' },
        ],
      },
      raw,
      'examples:0'
    );
    const result = await generateClassIntro(params);
    expect(result.about).toBe(target);
    expect(result.focus[0]).toBe(`„${target}“: „Morgen“ bezeichnet zukünftige Zeit.`);
    expect(result.tips[0]).toBe(`„${target}“: Nenne einen künftigen Zeitpunkt.`);
    expect(result.focus[1]).toBe(reviewContexts()[0].focus[1]);
    expect(reviewContexts().at(-1)).toEqual(result);
  });
});
