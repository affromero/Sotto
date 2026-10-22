import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';
import { novelFindingCorroborationFixture } from '../intro-provider-fixture';
import { createAIProvider, type AIOptions } from '@/lib/providers/ai';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: AIOptions
    ) =>
      novelFindingCorroborationFixture(messages, options) ??
      boundary.generate(system, messages, options),
  }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async (ai: { model: string; signal: AbortSignal }) => ({
    model: ai.model,
    signal: ai.signal,
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { classIntroFromSeed, generateClassIntro } from '@/lib/classes/class-intro';
import { SectionQualityError } from '@/lib/classes/section-quality';
import {
  TeachingQualityRejectionError,
  reviewTeachingContent,
} from '@/lib/classes/quality/teaching-quality';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Gestern',
  objective: 'Erzähle von gestern.',
  grammarPoints: ['Perfekt'],
  targetVocab: [],
};
const target = 'Ich habe gestern einen Film gesehen.';
const raw = {
  purpose: 'Erzähle von gestern.',
  about: { exampleIndex: 0 },
  focus: [{ text: 'In diesem Aussagesatz steht „habe“ an zweiter Stelle.', exampleIndex: 0 }],
  examples: [{ target, note: 'In diesem Aussagesatz bilden „habe“ und „gesehen“ das Perfekt.' }],
  tips: [{ text: 'Lerne „gesehen“ zusammen mit dem Hilfsverb „haben“.', exampleIndex: 0 }],
  visuals: null,
};
type Row = {
  index: number;
  content: { address: { field: string; index?: number }; fields: Record<string, unknown> };
  sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
};
type Payload = {
  introContext: {
    about: string;
    examples: Array<{ target: string; meaning: string; note: string }>;
  };
  items: Row[];
  criticisms?: { items: Array<{ index: number; findings: unknown[] }> };
};

function respond(
  initial: unknown = raw,
  replacement?: unknown,
  defect?: 'target' | 'note' | 'meaning'
) {
  boundary.generate.mockImplementation(async (_system, messages, options) => {
    const role = options.jsonSchema.name;
    if (role === 'class_intro_generation')
      return { content: typeof initial === 'string' ? initial : JSON.stringify(initial) };
    if (role === 'class_intro_repair')
      return { content: JSON.stringify(replacement ?? { ...raw, visuals: undefined }) };
    const payload: Payload = JSON.parse(messages[0].content);
    return {
      content: JSON.stringify({
        items: payload.items.map((row) => {
          const example = row.content.fields.example as
            { target: string; note: string; meaning?: string } | undefined;
          const field = defect ?? 'target';
          const bad =
            example &&
            defect &&
            (field === 'target'
              ? example.target.includes('ist gestern einen Film')
              : field === 'note'
                ? example.note.includes('„sein“ bildet das Perfekt von „sehen“')
                : example.meaning?.includes('keinen Film'));
          const part = row.sourceParts.find(
            (p) => JSON.stringify(p.fieldPath) === JSON.stringify(['example', field])
          );
          if (role === 'class_intro_critic')
            return {
              index: row.index,
              findings: bad
                ? [
                    {
                      sourcePartIndex: part!.index,
                      issue: 'incorrect',
                      rule:
                        field === 'meaning' ? 'Preserve negation.' : 'Use the correct auxiliary.',
                      defect:
                        field === 'meaning'
                          ? 'The example watched a film.'
                          : 'Sehen uses haben in this example.',
                      remedy: {
                        kind: 'correction',
                        text:
                          field === 'target'
                            ? target
                            : field === 'note'
                              ? raw.examples[0]!.note
                              : 'Die sprechende Person sah gestern einen Film.',
                      },
                    },
                  ]
                : [],
            };
          return {
            index: row.index,
            criticDecisions: (
              payload.criticisms?.items.find((item) => item.index === row.index)?.findings ?? []
            ).map((_, findingIndex) => ({
              findingIndex,
              decision: 'supported',
              reason:
                field === 'meaning'
                  ? 'The meaning reverses the event.'
                  : 'The auxiliary claim is false.',
            })),
            newFindings: [],
          };
        }),
      }),
      model: 'captured-model',
    };
  });
}
function reviewContexts(): Payload['introContext'][] {
  return boundary.generate.mock.calls
    .filter(([, , options]) =>
      ['class_intro_critic', 'class_intro_adjudicator'].includes(options.jsonSchema.name)
    )
    .map(([, messages]) => JSON.parse(messages[0].content).introContext);
}

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
    execution: params.execution,
  });
});

describe('fresh intro meanings', () => {
  it.each([
    { level: 'A2', meaning: target, alias: true },
    { level: 'B1', meaning: target, alias: true },
    { level: 'A1', meaning: target, alias: false },
    { level: 'B1', meaning: target + ' ', alias: false },
    { level: 'A2', meaning: 'Die sprechende Person sah gestern einen Film.', alias: false },
  ])(
    'reviews only independent example claims at $level with alias=$alias',
    async ({ level, meaning, alias }) => {
      respond();
      const example = { ...raw.examples[0]!, meaning };
      const intro = {
        purpose: raw.purpose,
        about: target,
        focus: ['Achte auf habe.'],
        tips: ['Nenne den Tag.'],
        examples: [example],
      };
      await reviewTeachingContent({
        ...params,
        level,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'intro',
        items: [intro],
      });
      for (const [, messages] of boundary.generate.mock.calls) {
        const payload: Payload = JSON.parse(messages[0].content);
        expect(payload.introContext).toEqual(intro);
        const row = payload.items.find((item) => item.content.address.field === 'examples')!;
        expect(row.content.fields.example).toEqual(
          alias ? { target, note: example.note } : example
        );
        const paths = row.sourceParts.map((part) => part.fieldPath);
        expect(paths).toContainEqual(['example', 'target']);
        expect(paths).toContainEqual(['example', 'note']);
        if (alias) expect(paths).not.toContainEqual(['example', 'meaning']);
        else expect(paths).toContainEqual(['example', 'meaning']);
      }
    }
  );

  it('rejects a distinct historical immersion meaning that reverses the event', async () => {
    respond(raw, undefined, 'meaning');
    const intro = {
      purpose: raw.purpose,
      about: target,
      focus: ['Achte auf habe.'],
      tips: ['Nenne den Tag.'],
      examples: [
        { ...raw.examples[0]!, meaning: 'Die sprechende Person sah gestern keinen Film.' },
      ],
    };
    await expect(
      reviewTeachingContent({
        ...params,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'intro',
        items: [intro],
      })
    ).rejects.toBeInstanceOf(TeachingQualityRejectionError);
  });

  it.each(['initial', 'structural repair'])(
    'derives exact immersion meaning before review after %s',
    async (path) => {
      respond(path === 'initial' ? raw : '{');
      const result = await generateClassIntro(params);
      expect(result.about).toBe(target);
      expect(result.examples[0]).toMatchObject({ target, meaning: target });
      for (const context of reviewContexts()) {
        expect(context.about).toBe(target);
        expect(context.examples[0]).toMatchObject({ target, meaning: target });
      }
      for (const [, , options] of boundary.generate.mock.calls.filter(([, , options]) =>
        ['class_intro_generation', 'class_intro_repair'].includes(options.jsonSchema.name)
      )) {
        const schema = options.jsonSchema.schema.properties.examples.items;
        expect(schema.required).toEqual(expect.arrayContaining(['target', 'note']));
        expect(schema.properties).not.toHaveProperty('meaning');
        expect(schema.additionalProperties).toBe(false);
      }
    }
  );

  it('rejects authored immersion meaning rather than silently overwriting it', async () => {
    const untrusted = { ...raw, examples: [{ ...raw.examples[0], meaning: 'A different event.' }] };
    respond(untrusted, { ...untrusted, visuals: undefined });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(SectionQualityError);
    expect(reviewContexts()).toEqual([]);
  });

  it('retains authored native-language meanings and the selected meaning in A1 about', async () => {
    const meaning = 'I watched a film yesterday.';
    respond({ ...raw, examples: [{ ...raw.examples[0], meaning }] });
    const result = await generateClassIntro({ ...params, level: 'A1' });
    expect(result.about).toBe('„' + target + '“: ' + meaning);
    expect(result.examples[0]).toMatchObject({ target, meaning });
    expect(reviewContexts().every((context) => context.examples[0]?.meaning === meaning)).toBe(
      true
    );
    const schema = boundary.generate.mock.calls[0]![2].jsonSchema.schema.properties.examples.items;
    expect(schema.required).toContain('meaning');
  });

  it.each(['target', 'note'] as const)(
    'keeps a genuine incorrect %s blocking after bounded repair',
    async (defect) => {
      const example =
        defect === 'target'
          ? { ...raw.examples[0]!, target: 'Ich ist gestern einen Film gesehen.' }
          : { ...raw.examples[0]!, note: '„sein“ bildet das Perfekt von „sehen“.' };
      respond({ ...raw, examples: [example] }, { examples: { '0': example } }, defect);
      await expect(generateClassIntro(params)).rejects.toBeInstanceOf(
        TeachingQualityRejectionError
      );
      expect(
        reviewContexts().every(
          (context) => context.examples[0]?.meaning === context.examples[0]?.target
        )
      ).toBe(true);
    }
  );

  it('rederives an authorized replacement while preserving the complete other example and accepted fields', async () => {
    const unchanged = {
      target: 'Wir sind gestern gegangen.',
      note: 'In diesem Aussagesatz steht „gegangen“ am Ende.',
    };
    const bad = { ...raw.examples[0]!, target: 'Ich ist gestern einen Film gesehen.' };
    const initial = {
      ...raw,
      about: { exampleIndex: 1 },
      focus: [{ text: 'In diesem Aussagesatz steht „sind“ an zweiter Stelle.', exampleIndex: 1 }],
      tips: [{ text: 'Lerne „gegangen“ zusammen mit „sein“.', exampleIndex: 1 }],
      examples: [bad, unchanged],
    };
    respond(initial, { examples: { '0': raw.examples[0] } }, 'target');
    const result = await generateClassIntro(params);
    expect(result.examples[0]).toMatchObject({ target, meaning: target });
    expect(result.examples[1]).toEqual({
      ...unchanged,
      meaning: unchanged.target,
      note: '„' + unchanged.target + '“: ' + unchanged.note,
    });
    const contexts = reviewContexts();
    const first = contexts[0]!,
      last = contexts.at(-1)!;
    expect(last.about).toBe(first.about);
    expect(last.examples[1]).toEqual(first.examples[1]);
    expect(result.about).toBe(unchanged.target);
  });

  it('rejects an authored meaning in an indexed immersion example patch', async () => {
    const bad = { ...raw.examples[0]!, target: 'Ich ist gestern einen Film gesehen.' };
    respond(
      { ...raw, examples: [bad] },
      { examples: { '0': { ...raw.examples[0], meaning: target } } },
      'target'
    );
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(SectionQualityError);
  });

  it('restores historical distinct meanings without applying fresh derivation', () => {
    const meaning = 'Die sprechende Person sah gestern einen Film.';
    const historical = {
      purpose: raw.purpose,
      about: '„' + target + '“: ' + meaning,
      focus: ['„' + target + '“: ' + raw.focus[0]!.text],
      examples: [
        { ...raw.examples[0]!, meaning, note: '„' + target + '“: ' + raw.examples[0]!.note },
      ],
      tips: ['„' + target + '“: ' + raw.tips[0]!.text],
    };
    expect(classIntroFromSeed({ intro: historical }, params)).toEqual(historical);
  });
});
