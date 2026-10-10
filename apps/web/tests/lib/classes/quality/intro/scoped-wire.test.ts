import { beforeEach, describe, expect, it, vi } from 'vitest';
import { novelFindingCorroborationFixture } from '../intro-provider-fixture';
import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';
import { teachingFindingFixture } from '../intro-provider-fixture';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: unknown
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

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'A1',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Gestern',
  objective: 'Erzähle von gestern.',
  grammarPoints: ['Perfekt'],
  targetVocab: [],
};
const wire = {
  purpose: 'Erzähle von gestern.',
  about: { exampleIndex: 1 },
  focus: [
    { text: 'Kochen verwendet haben.', exampleIndex: 0 },
    { text: 'Gehen verwendet sein.', exampleIndex: 1 },
  ],
  examples: [
    { target: 'Ich habe gekocht.', meaning: 'I cooked.', note: 'Kochen verwendet haben.' },
    { target: 'Wir sind gegangen.', meaning: 'We went.', note: 'Gehen verwendet sein.' },
  ],
  tips: [{ text: 'Lerne das Hilfsverb.', exampleIndex: 1 }],
  visuals: null,
};
const compiled = {
  purpose: wire.purpose,
  about: '„Wir sind gegangen.“: We went.',
  focus: [
    '„Ich habe gekocht.“: Kochen verwendet haben.',
    '„Wir sind gegangen.“: Gehen verwendet sein.',
  ],
  examples: [
    { ...wire.examples[0]!, note: '„Ich habe gekocht.“: Kochen verwendet haben.' },
    { ...wire.examples[1]!, note: '„Wir sind gegangen.“: Gehen verwendet sein.' },
  ],
  tips: ['„Wir sind gegangen.“: Lerne das Hilfsverb.'],
};
const shortExample = {
  target: 'Guten Morgen',
  meaning: 'You say good morning early in the day.',
  note: 'Sagt man früh am Tag.',
};
const shortCompiledExample = { ...shortExample, note: '„Guten Morgen“: Sagt man früh am Tag.' };
const shortExampleWire = {
  ...wire,
  purpose: 'Begrüße und erzähle vom Tag.',
  focus: [{ text: 'Diese Begrüßung gilt morgens.', exampleIndex: 0 }, wire.focus[1]],
  examples: [shortExample, wire.examples[1]],
};
const shortExampleIntro = {
  ...compiled,
  purpose: shortExampleWire.purpose,
  focus: ['„Guten Morgen“: Diese Begrüßung gilt morgens.', compiled.focus[1]],
  examples: [shortCompiledExample, compiled.examples[1]],
};
type Address = { field: string; index?: number };
type Item = {
  index: number;
  content: { address: Address; fields: Record<string, unknown> };
  sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
};
type Payload = { introContext: typeof compiled; items: Item[] };

function requireProviderObjectSchemas(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(requireProviderObjectSchemas);
    return;
  }
  const schema = value as Record<string, unknown>;
  if (schema.format !== undefined)
    expect([
      'date-time',
      'time',
      'date',
      'duration',
      'email',
      'hostname',
      'ipv4',
      'ipv6',
      'uuid',
    ]).toContain(schema.format);
  if (schema.type === 'object') {
    expect(schema.additionalProperties).toBe(false);
    expect((schema.required as string[]).toSorted()).toEqual(
      Object.keys(schema.properties as Record<string, unknown>).toSorted()
    );
  }
  Object.values(schema).forEach(requireProviderObjectSchemas);
}

function respond(initial: unknown, replacement: unknown = initial, rejected: string[] = []) {
  let replaced = false;
  boundary.generate.mockImplementation(async (_system, messages, options) => {
    const name = options.jsonSchema.name;
    requireProviderObjectSchemas(options.jsonSchema.schema);
    if (name === 'class_intro_generation')
      return { content: JSON.stringify(initial), model: 'captured-model' };
    if (name === 'class_intro_repair') {
      replaced = true;
      const payload =
        replacement && typeof replacement === 'object' && rejected.length === 0
          ? Object.fromEntries(Object.entries(replacement).filter(([field]) => field !== 'visuals'))
          : replacement;
      return { content: JSON.stringify(payload), model: 'captured-model' };
    }
    const payload: Payload = JSON.parse(messages[0].content);
    return {
      model: 'captured-model',
      content: JSON.stringify({
        items: payload.items.map(({ index, content, sourceParts }) => {
          if (name === 'class_intro_critic') return { index, findings: [] };
          const key =
            content.address.field +
            (content.address.index === undefined ? '' : `:${content.address.index}`);
          const unacceptable = !replaced && rejected.includes(key);
          const fieldPath =
            content.address.field === 'examples' ? ['example', 'target'] : [content.address.field];
          const text =
            content.address.field === 'examples'
              ? (content.fields.example as { target: string }).target
              : (content.fields[content.address.field] as string);
          return {
            index,
            newFindings: unacceptable
              ? [
                  teachingFindingFixture(
                    {
                      issue: 'incorrect',
                      fieldPath,
                      quote: text.slice(0, 120),
                      rule: 'Describe the selected example accurately.',
                      defect: 'Correct this observation.',
                      correction: 'Use the corrected observation.',
                      counterexample: null,
                    },
                    sourceParts
                  ),
                ]
              : [],
            criticDecisions: [],
          };
        }),
      }),
    };
  });
}
function schemas() {
  return boundary.generate.mock.calls.map(([, , options]) => options.jsonSchema.name);
}
function reviewContexts() {
  return boundary.generate.mock.calls
    .filter(([, , options]) => options.jsonSchema.name === 'class_intro_adjudicator')
    .map(([, messages]) => JSON.parse(messages[0].content).introContext);
}
beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset().mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
    execution: params.execution,
  });
});

describe('strict scoped A1 intro wire', () => {
  it('repairs teaching after a size repair and re-audits the complete merged intro', async () => {
    const example = { ...wire.examples[1]!, meaning: 'The group went.' };
    respond(wire, { examples: { 1: example } }, ['examples:1']);
    const reviewAndRepair = boundary.generate.getMockImplementation()!;
    let structuralRepairPending = true;
    boundary.generate.mockImplementation(async (system, messages, options) => {
      if (options.jsonSchema.name === 'class_intro_generation')
        return {
          content: JSON.stringify({ ...wire, purpose: 'Wort '.repeat(205) }),
          model: 'captured-model',
        };
      if (options.jsonSchema.name === 'class_intro_repair' && structuralRepairPending) {
        structuralRepairPending = false;
        return {
          content: JSON.stringify({ ...wire, visuals: undefined }),
          model: 'captured-model',
        };
      }
      return reviewAndRepair(system, messages, options);
    });
    const result = await generateClassIntro(params);
    expect(result).toEqual({
      ...compiled,
      examples: [compiled.examples[0], { ...example, note: compiled.examples[1]!.note }],
    });
    const finalContexts = reviewContexts().slice(2);
    expect(finalContexts).toHaveLength(2);
    for (const context of finalContexts) expect(context).toEqual(result);
    expect(
      boundary.generate.mock.calls
        .filter(([, , options]) => options.jsonSchema.name === 'class_intro_repair')
        .map(([, , options]) => Object.keys(options.jsonSchema.schema.properties))
    ).toEqual([['purpose', 'about', 'focus', 'examples', 'tips'], ['examples']]);
  });

  it.each(['provider', 'cancelled', 'malformed patch', 'rejected patch'])(
    'does not retry a %s after structural repair and the semantic patch opportunity',
    async (failure) => {
      respond(wire, { examples: { 1: wire.examples[1] } }, ['examples:1']);
      const reviewAndRepair = boundary.generate.getMockImplementation()!;
      const terminal = new Error(failure);
      if (failure === 'cancelled') terminal.name = 'AbortError';
      let repairedStructure = false;
      let semanticRequested = false;
      boundary.generate.mockImplementation(async (system, messages, options) => {
        const name = options.jsonSchema.name;
        if (name === 'class_intro_generation')
          return {
            content: JSON.stringify({ ...wire, purpose: 'Wort '.repeat(205) }),
            model: 'captured-model',
          };
        if (name === 'class_intro_repair' && !repairedStructure) {
          repairedStructure = true;
          return {
            content: JSON.stringify({ ...wire, visuals: undefined }),
            model: 'captured-model',
          };
        }
        if ((failure === 'provider' || failure === 'cancelled') && name === 'class_intro_critic')
          throw terminal;
        if (name === 'class_intro_repair') {
          if (semanticRequested) throw new Error('Unexpected additional semantic generation');
          semanticRequested = true;
          if (failure === 'malformed patch') return { content: '{}', model: 'captured-model' };
          if (failure === 'rejected patch')
            return {
              content: JSON.stringify({ examples: { 1: wire.examples[1] } }),
              model: 'captured-model',
            };
        }
        return reviewAndRepair(system, messages, options);
      });
      if (failure === 'provider' || failure === 'cancelled') {
        await expect(generateClassIntro(params)).rejects.toBe(terminal);
        expect(semanticRequested).toBe(false);
      } else {
        await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
        expect(semanticRequested).toBe(true);
      }
    }
  );
  it.each(['initial', 'structural replacement'])(
    'preserves validated short examples and their original reference indices in an %s',
    async (stage) => {
      const initial =
        stage === 'initial' ? shortExampleWire : { ...wire, about: 'invalid reference' };
      respond(initial, shortExampleWire);
      const result = await generateClassIntro(params);
      expect(result).toEqual(shortExampleIntro);
      expect(result.examples.map(({ target }) => target)).toEqual([
        'Guten Morgen',
        'Wir sind gegangen.',
      ]);
      expect(result.about).toBe('„Wir sind gegangen.“: We went.');
      for (const context of reviewContexts()) expect(context).toEqual(shortExampleIntro);
      const persisted = JSON.parse(JSON.stringify({ intro: result }));
      expect(classIntroFromSeed(persisted, params)).toEqual(result);
    }
  );

  it('retains a rejected example whose compiled note becomes equivalent to its meaning', async () => {
    respond(wire, { examples: { 0: shortExample } }, ['examples:0']);
    const result = await generateClassIntro(params);
    expect(result).toEqual({ ...compiled, examples: [shortCompiledExample, compiled.examples[1]] });
    for (const context of reviewContexts().slice(2)) expect(context).toEqual(result);
    expect(classIntroFromSeed(JSON.parse(JSON.stringify({ intro: result })), params)).toEqual(
      result
    );
  });

  it('preserves an accepted short example and stable later indices when its sibling changes', async () => {
    const example = {
      target: 'Wir sind gestern gefahren.',
      meaning: 'We travelled yesterday.',
      note: 'Fahren verwendet hier sein.',
    };
    respond(shortExampleWire, { examples: { 1: example } }, ['examples:1']);
    const result = await generateClassIntro(params);
    expect(result).toEqual({
      ...shortExampleIntro,
      examples: [
        shortCompiledExample,
        { ...example, note: '„Wir sind gestern gefahren.“: Fahren verwendet hier sein.' },
      ],
    });
    expect(result.about).toBe(shortExampleIntro.about);
    for (const context of reviewContexts().slice(2)) expect(context).toEqual(result);
    expect(classIntroFromSeed(JSON.parse(JSON.stringify({ intro: result })), params)).toEqual(
      result
    );
  });

  it('binds every fresh teaching observation and note to its selected complete example before review', async () => {
    respond(wire);
    await expect(generateClassIntro(params)).resolves.toEqual(compiled);
    for (const context of reviewContexts()) expect(context).toEqual(compiled);
    const [system, , options] = boundary.generate.mock.calls[0]!;
    const schema = options.jsonSchema.schema;
    expect(schema.properties.about).toMatchObject({
      type: 'object',
      required: ['exampleIndex'],
      additionalProperties: false,
    });
    expect(schema.properties.about.properties).not.toHaveProperty('text');
    expect(system).toContain(JSON.stringify(schema));
    expect(schema.required).toContain('visuals');
    expect(schema.properties.visuals.anyOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'object' }), { type: 'null' }])
    );
  });

  it('requires an explicit null for absent fresh visuals and keeps them absent in public teaching', async () => {
    const missing = Object.fromEntries(
      Object.entries(wire).filter(([field]) => field !== 'visuals')
    );
    respond(missing, wire);
    await expect(generateClassIntro(params)).resolves.toEqual(compiled);
    expect(schemas().slice(0, 2)).toEqual(['class_intro_generation', 'class_intro_repair']);
    expect(boundary.generate.mock.calls[1]![2].jsonSchema.schema.properties).not.toHaveProperty(
      'visuals'
    );
  });

  it.each(['timeline', 'contrast', 'callouts', 'links', 'callout tone'])(
    'rejects an omitted required visual %s before any semantic review',
    async (field) => {
      const visuals: Record<string, unknown> = {
        timeline: null,
        contrast: null,
        callouts: [{ label: compiled.about, text: compiled.about, tone: 'blue' }],
        links: [],
      };
      if (field === 'callout tone')
        visuals.callouts = [{ label: compiled.about, text: compiled.about }];
      else delete visuals[field];
      respond({ ...wire, visuals }, wire);
      await expect(generateClassIntro(params)).resolves.toEqual(compiled);
      expect(schemas().slice(0, 2)).toEqual(['class_intro_generation', 'class_intro_repair']);
      expect(boundary.generate.mock.calls[1]![1][0].content).toContain('visual_scope');
    }
  );

  it('validates actual visual URLs even when the provider schema omits the unsupported URI format', async () => {
    const visuals = {
      timeline: null,
      contrast: null,
      callouts: [],
      links: [{ label: compiled.about, url: 'not-a-url' }],
    };
    respond({ ...wire, visuals }, wire);
    await expect(generateClassIntro(params)).resolves.toEqual(compiled);
    expect(schemas().slice(0, 2)).toEqual(['class_intro_generation', 'class_intro_repair']);
    expect(boundary.generate.mock.calls[1]![1][0].content).toContain('visual_scope');
    const schema = boundary.generate.mock.calls[0]![2].jsonSchema.schema;
    const objectVisuals = schema.properties.visuals.anyOf.find(
      (item: { type: string }) => item.type === 'object'
    );
    expect(objectVisuals.properties.links.items.properties.url).not.toHaveProperty('format');
    for (const context of reviewContexts()) expect(context).toEqual(compiled);
  });

  it('preserves one exact scope prefix rather than adding duplicate quoted examples', async () => {
    respond({
      ...wire,
      focus: wire.focus.map((atom, index) => ({ ...atom, text: compiled.focus[index] })),
      tips: [{ text: compiled.tips[0], exampleIndex: 1 }],
      examples: compiled.examples,
    });
    await expect(generateClassIntro(params)).resolves.toEqual(compiled);
  });

  it.each(['about', 'focus', 'tips'] as const)(
    'rejects fresh legacy strings in %s without semantic review',
    async (field) => {
      const invalid = {
        ...wire,
        [field]: field === 'about' ? 'Gehen verwendet sein.' : ['Gehen verwendet sein.'],
      };
      respond(invalid);
      await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
      expect(schemas()).toEqual(['class_intro_generation', 'class_intro_repair']);
    }
  );

  it.each([-1, 0.5, 2, '1'])(
    'rejects an invalid example reference %s before semantic review',
    async (exampleIndex) => {
      const invalid = { ...wire, about: { exampleIndex } };
      respond(invalid);
      await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
      expect(schemas()).toEqual(['class_intro_generation', 'class_intro_repair']);
      expect(boundary.generate.mock.calls[1]![1][0].content).toContain('example_reference');
    }
  );

  it('rejects extra atom keys instead of treating them as trusted scope metadata', async () => {
    respond({ ...wire, about: { ...wire.about, scope: 'all sentences' } });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(schemas()).toEqual(['class_intro_generation', 'class_intro_repair']);
  });

  it('rejects independently authored overview text instead of accepting a quoted unsupported result', async () => {
    respond({ ...wire, about: { exampleIndex: 1, text: 'Der Ausflug war gestern zu Ende.' } });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(schemas()).toEqual(['class_intro_generation', 'class_intro_repair']);
  });

  it('copies only the selected journey meaning without inventing when the whole outing ended', async () => {
    const example = {
      target: 'Gestern bin ich zu Fuß zum Markt gegangen.',
      meaning: 'I walked to the market yesterday.',
      note: 'Gehen verwendet hier sein.',
    };
    const input = {
      ...wire,
      about: { exampleIndex: 0 },
      examples: [example],
      focus: [{ text: 'Gehen verwendet hier sein.', exampleIndex: 0 }],
      tips: [{ text: 'Lerne gehen mit sein.', exampleIndex: 0 }],
    };
    respond(input);
    const result = await generateClassIntro(params);
    expect(result.about).toBe(
      '„Gestern bin ich zu Fuß zum Markt gegangen.“: I walked to the market yesterday.'
    );
    expect(result.examples[0]!.meaning).toBe(example.meaning);
    for (const context of reviewContexts()) expect(context.about).toBe(result.about);
  });

  it('retains the selected meaning exactly even when it already begins with the target quote', async () => {
    const meaning = '„Wir sind gegangen.“: The group went.';
    respond({ ...wire, examples: [wire.examples[0], { ...wire.examples[1], meaning }] });
    const result = await generateClassIntro(params);
    expect(result.about).toBe(`„Wir sind gegangen.“: ${meaning}`);
    expect(result.examples[1]!.meaning).toBe(meaning);
  });

  it('does not reassign a reference when an earlier unusable example would be filtered out', async () => {
    const invalid = {
      ...wire,
      about: { exampleIndex: 0 },
      examples: [{ target: 'gekocht', meaning: 'gekocht', note: 'gekocht' }, wire.examples[1]],
    };
    respond(invalid, wire);
    await expect(generateClassIntro(params)).resolves.toEqual(compiled);
    expect(boundary.generate.mock.calls[1]![1][0].content).toContain('unusable_example');
    expect(schemas().slice(0, 2)).toEqual(['class_intro_generation', 'class_intro_repair']);
    for (const context of reviewContexts()) expect(context).toEqual(compiled);
  });

  it.each([180, 181])(
    'measures all compiler-added quotes and paired notes at the %i-word boundary',
    async (count) => {
      // This fixture has 48 rendered words, including 18 quote words and two copied meaning words.
      const purpose =
        wire.purpose + ' ' + Array.from({ length: count - 48 }, () => 'größer').join(' ');
      const input = { ...wire, purpose };
      respond(input, wire);
      const result = await generateClassIntro(params);
      if (count === 180) {
        expect(result).toEqual({ ...compiled, purpose });
        expect(schemas()).not.toContain('class_intro_repair');
      } else {
        expect(result).toEqual(compiled);
        const request = boundary.generate.mock.calls[1]![1][0].content;
        expect(request).toContain(
          JSON.stringify({ reason: 'prose_word_limit', maxWords: 180, actualWords: 181 })
        );
        expect(schemas().slice(0, 2)).toEqual(['class_intro_generation', 'class_intro_repair']);
      }
    }
  );

  it('repairs eleven valid scoped addresses before dispatching either review role', async () => {
    const input = { ...wire, focus: Array.from({ length: 6 }, () => wire.focus[0]) };
    respond(input, wire);
    await expect(generateClassIntro(params)).resolves.toEqual(compiled);
    expect(boundary.generate.mock.calls[1]![1][0].content).toContain(
      JSON.stringify({ reason: 'audit_address_limit', maxAddresses: 10, actualAddresses: 11 })
    );
    expect(schemas().slice(0, 2)).toEqual(['class_intro_generation', 'class_intro_repair']);
  });

  it('compiles rejected observations after all example replacements while preserving accepted bytes', async () => {
    const example = {
      target: 'Wir sind gestern gefahren.',
      meaning: 'We travelled yesterday.',
      note: 'Fahren verwendet hier sein.',
    };
    const patch = {
      about: { exampleIndex: 1 },
      focus: { 0: { text: 'Das Partizip lautet gefahren.', exampleIndex: 1 } },
      tips: { 0: { text: 'Lerne fahren mit sein.', exampleIndex: 1 } },
      examples: { 1: example },
    };
    respond(wire, patch, ['about', 'focus:0', 'tips:0', 'examples:1']);
    const result = await generateClassIntro(params);
    expect(result).toEqual({
      ...compiled,
      about: '„Wir sind gestern gefahren.“: We travelled yesterday.',
      focus: ['„Wir sind gestern gefahren.“: Das Partizip lautet gefahren.', compiled.focus[1]],
      tips: ['„Wir sind gestern gefahren.“: Lerne fahren mit sein.'],
      examples: [
        compiled.examples[0],
        { ...example, note: '„Wir sind gestern gefahren.“: Fahren verwendet hier sein.' },
      ],
    });
    expect(result.focus[1]).toBe(compiled.focus[1]);
    expect(result.examples[0]).toEqual(compiled.examples[0]);
    for (const context of reviewContexts().slice(2)) expect(context).toEqual(result);
  });

  it.each([false, true])(
    'changes the overview only when it was rejected alongside its paired meaning: %s',
    async (rejectAbout) => {
      const example = { ...compiled.examples[1]!, meaning: 'The group went.' };
      const patch = {
        ...(rejectAbout ? { about: { exampleIndex: 1 } } : {}),
        examples: { 1: example },
      };
      respond(wire, patch, rejectAbout ? ['about', 'examples:1'] : ['examples:1']);
      const result = await generateClassIntro(params);
      expect(result).toEqual({
        ...compiled,
        about: rejectAbout ? '„Wir sind gegangen.“: The group went.' : compiled.about,
        examples: [compiled.examples[0], example],
      });
      for (const context of reviewContexts().slice(2)) expect(context).toEqual(result);
    }
  );

  it.each(['legacy string', 'authored text', 'out of bounds', 'unreviewed example'])(
    'rejects an overview-only semantic patch with %s',
    async (kind) => {
      const patch: Record<string, unknown> = { about: { exampleIndex: 1 } };
      if (kind === 'legacy string') patch.about = compiled.about;
      if (kind === 'authored text')
        patch.about = { exampleIndex: 1, text: 'Der Ausflug war gestern zu Ende.' };
      if (kind === 'out of bounds') patch.about = { exampleIndex: 2 };
      if (kind === 'unreviewed example')
        patch.examples = { 1: { ...wire.examples[1], meaning: 'The group arrived yesterday.' } };
      respond(wire, patch, ['about']);
      await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
      const repair = boundary.generate.mock.calls.at(-1)!;
      expect(repair[2].jsonSchema.schema.properties).toEqual({ about: expect.any(Object) });
      expect(schemas()).toEqual([
        'class_intro_generation',
        'class_intro_critic',
        'class_intro_adjudicator',
        'class_intro_critic',
        'class_intro_adjudicator',
        'class_intro_repair',
      ]);
    }
  );

  it.each([
    'legacy string',
    'out of bounds reference',
    'extra index',
    'unreviewed field',
    'unusable replacement',
  ])('rejects a semantic patch with %s without granting another repair', async (kind) => {
    const focus: Record<string, unknown> = { 0: { text: 'Lerne das Hilfsverb.', exampleIndex: 0 } };
    const patch: Record<string, unknown> = { focus };
    if (kind === 'legacy string') focus[0] = 'Lerne das Hilfsverb.';
    if (kind === 'out of bounds reference')
      focus[0] = { text: 'Lerne das Hilfsverb.', exampleIndex: 2 };
    if (kind === 'extra index') focus[1] = { text: 'Unreviewed observation.', exampleIndex: 0 };
    if (kind === 'unreviewed field')
      patch.about = { text: 'Unreviewed observation.', exampleIndex: 0 };
    if (kind === 'unusable replacement')
      patch.examples = { 0: { target: 'gekocht', meaning: 'gekocht', note: 'gekocht' } };
    const rejected = kind === 'unusable replacement' ? ['focus:0', 'examples:0'] : ['focus:0'];
    respond(wire, patch, rejected);
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(schemas()).toEqual([
      'class_intro_generation',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_repair',
    ]);
  });

  it('allows optional visuals to reuse exact compiled observations without adding prose to the word budget', async () => {
    const visuals = {
      timeline: {
        title: compiled.about,
        steps: [wire.examples[0]!.target, wire.examples[1]!.target],
      },
      contrast: null,
      callouts: [{ label: compiled.focus[0], text: compiled.examples[0]!.note, tone: 'blue' }],
      links: [],
    };
    respond({ ...wire, visuals });
    await expect(generateClassIntro(params)).resolves.toEqual({ ...compiled, visuals });
  });

  it.each(['step', 'title', 'callout label', 'link label'])(
    'rejects an independent grammar claim in a visual %s before either reviewer can approve it',
    async (field) => {
      const visuals = {
        timeline: {
          title: compiled.about,
          steps: [wire.examples[0]!.target, wire.examples[1]!.target],
        },
        contrast: null,
        callouts: [{ label: compiled.focus[0], text: compiled.examples[0]!.note, tone: 'blue' }],
        links: [{ label: compiled.about, url: 'https://example.test/lesson' }],
      };
      const claim = 'Das Partizip steht immer am Satzende.';
      if (field === 'step') visuals.timeline.steps[1] = claim;
      if (field === 'title') visuals.timeline.title = claim;
      if (field === 'callout label') visuals.callouts[0]!.label = claim;
      if (field === 'link label') visuals.links[0]!.label = claim;
      respond({ ...wire, visuals }, wire);
      await expect(generateClassIntro(params)).resolves.toEqual(compiled);
      expect(boundary.generate.mock.calls[1]![1][0].content).toContain('visual_scope');
      for (const context of reviewContexts()) expect(context).toEqual(compiled);
    }
  );
});
