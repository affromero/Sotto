import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
import { scopedIntroFixture, shapeIntroProviderFixture } from './intro-provider-fixture';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: unknown
    ) =>
      shapeIntroProviderFixture(
        system,
        messages,
        options,
        await boundary.generate(system, messages, options)
      ),
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
import { generateClassIntro } from '@/lib/classes/class-intro';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import {
  classIntroExampleMeaningPolicy,
  classIntroGrammarRulePolicy,
} from '@/lib/classes/class-language-policy';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Travel',
  objective: 'Describe a short trip',
  grammarPoints: ['past events'],
  targetVocab: [],
};
type IntroFixture = {
  purpose: string;
  about: string;
  focus: string[];
  examples: Array<{ target: string; meaning: string; note: string }>;
  tips: string[];
  visuals?: unknown;
};
type IntroAddress =
  | { field: 'purpose' | 'about' | 'visuals' }
  | { field: 'focus' | 'tips' | 'examples'; index: number };
type ReviewIssue = { issues: string[]; feedback: string[] };

const candidate: IntroFixture = {
  purpose: 'Erzähle klar von vergangenen Erlebnissen.',
  about: '„Ich habe gestern meine Freundin besucht.“: Gestern besuchte ich meine Freundin.',
  focus: [
    '„Ich habe gestern meine Freundin besucht.“: Wähle das passende Hilfsverb.',
    '„Ich habe gestern meine Freundin besucht.“: Beachte die Wortstellung.',
  ],
  examples: [
    {
      target: 'Ich habe gestern meine Freundin besucht.',
      meaning: 'Gestern besuchte ich meine Freundin.',
      note: '„Ich habe gestern meine Freundin besucht.“: „Besuchen“ verwendet „haben“.',
    },
    {
      target: 'Wir sind zu Fuß zum Markt gegangen.',
      meaning: 'Wir gingen zu Fuß zum Markt.',
      note: '„Wir sind zu Fuß zum Markt gegangen.“: „Gehen“ verwendet „sein“.',
    },
    {
      target: 'Auf der Reise habe ich schöne Orte gesehen.',
      meaning: 'Auf der Reise sah ich schöne Orte.',
      note: '„Auf der Reise habe ich schöne Orte gesehen.“: „Sehen“ verwendet „haben“.',
    },
  ],
  tips: [
    '„Ich habe gestern meine Freundin besucht.“: Lerne das Hilfsverb.',
    '„Ich habe gestern meine Freundin besucht.“: Nenne die vergangene Zeit.',
    '„Ich habe gestern meine Freundin besucht.“: Vergleiche vollständige Sätze.',
  ],
};

function introWithWordCount(count: number, token = 'größer'): IntroFixture {
  return {
    purpose: 'Erzähle von gestern. ' + Array.from({ length: count - 31 }, () => token).join(' '),
    about: '„Ich bin gegangen.“: Ich ging.',
    focus: ['„Ich bin gegangen.“: Perfekt mit sein'],
    examples: [
      {
        target: 'Ich bin gegangen.',
        meaning: 'Ich ging.',
        note: '„Ich bin gegangen.“: Gehen verwendet sein.',
      },
    ],
    tips: ['„Ich bin gegangen.“: Nenne das Ziel.'],
  };
}
function introAddresses(value: IntroFixture): IntroAddress[] {
  return [
    { field: 'purpose' },
    { field: 'about' },
    ...value.focus.map((_, index) => ({ field: 'focus' as const, index })),
    ...value.tips.map((_, index) => ({ field: 'tips' as const, index })),
    ...value.examples.map((_, index) => ({ field: 'examples' as const, index })),
    ...(value.visuals === undefined ? [] : [{ field: 'visuals' as const }]),
  ];
}
function addressKey(address: IntroAddress): string {
  return 'index' in address ? `${address.field}:${address.index}` : address.field;
}
function auditItems(value: IntroFixture, rejected: Record<string, ReviewIssue> = {}) {
  return [
    {
      introContext: value,
      addresses: introAddresses(value),
      reviewPackets: reviewPackets(value, rejected),
    },
  ];
}
function fullVerdict(value: IntroFixture, rejected: Record<string, ReviewIssue> = {}) {
  return {
    items: introAddresses(value).map((address, index) => ({
      index,
      acceptable: !rejected[addressKey(address)],
      issues: rejected[addressKey(address)]?.issues ?? [],
      feedback: (rejected[addressKey(address)]?.issues ?? []).map(
        (_, index) =>
          `${(rejected[addressKey(address)]!.feedback[index] ?? rejected[addressKey(address)]!.feedback[0]!).slice(0, 120)} Correction: Correct the identified teaching defect.`
      ),
    })),
  };
}
function reviewPackets(value: IntroFixture, rejected: Record<string, ReviewIssue> = {}) {
  const allAddresses = introAddresses(value);
  const verdict = fullVerdict(value, rejected);
  const packets = [];
  for (let offset = 0; offset < verdict.items.length; offset += 5) {
    const batch = verdict.items.slice(offset, offset + 5);
    const critic = { items: batch.map((_, index) => ({ index, findings: [] })) };
    const adjudicator = {
      items: batch.map((item, localIndex) => {
        const address = allAddresses[offset + localIndex]!;
        const issue = rejected[addressKey(address)];
        const fieldPath =
          address.field === 'examples'
            ? ['example', 'target']
            : address.field === 'visuals'
              ? ['visuals', 'timeline', 'title']
              : [address.field === 'tips' ? 'tips' : address.field];
        const text =
          address.field === 'examples'
            ? value.examples['index' in address ? address.index : 0]!.target
            : address.field === 'visuals'
              ? (value.visuals as { timeline: { title: string } }).timeline.title
              : 'index' in address
                ? (value[address.field][address.index] as string)
                : value[address.field];
        return {
          ...item,
          index: localIndex,
          acceptable: !issue,
          issues: issue?.issues ?? [],
          feedback: item.feedback,
          findings: (issue?.issues ?? []).map((code, findingIndex) => ({
            issue: code,
            fieldPath,
            quote: text.slice(0, 120),
            rule: 'Correct teaching in the assigned field.',
            defect: (issue!.feedback[findingIndex] ?? issue!.feedback[0]!).slice(0, 120),
            correction: 'Correct the identified teaching defect.',
            counterexample: null,
          })),
          criticDecisions: [],
        };
      }),
    };
    packets.push({ offset, critic, adjudicator });
  }
  return packets;
}
function queueReview(value: IntroFixture, rejected: Record<string, ReviewIssue> = {}) {
  for (const { critic, adjudicator } of reviewPackets(value, rejected)) {
    boundary.generate
      .mockResolvedValueOnce({ model: 'captured-model', content: JSON.stringify(critic) })
      .mockResolvedValueOnce({ model: 'captured-model', content: JSON.stringify(adjudicator) });
  }
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

describe('field-local intro repair', () => {
  it('derives the overview from the selected example meaning before either review role', async () => {
    const raw = {
      ...scopedIntroFixture(candidate),
      about: { exampleIndex: 1 },
      visuals: null,
    };
    const framed = {
      ...candidate,
      about: '„Wir sind zu Fuß zum Markt gegangen.“: Wir gingen zu Fuß zum Markt.',
    };
    boundary.generate.mockResolvedValueOnce({ content: JSON.stringify(raw) });
    queueReview(framed);

    await expect(generateClassIntro(params)).resolves.toEqual(framed);
    const reviews = boundary.generate.mock.calls.filter(([, , options]) =>
      ['class_intro_critic', 'class_intro_adjudicator'].includes(options.jsonSchema?.name)
    );
    for (const [, messages] of reviews)
      expect(JSON.parse(messages[0].content).introContext.about).toBe(framed.about);
  });

  it.each([false, true])(
    'changes the first example and frames only a rejected overview: %s',
    async (rejectAbout) => {
      const correctedExample = {
        target: 'Ich habe gestern einen Film gesehen.',
        meaning: 'Gestern sah ich einen Film.',
        note: '„Ich habe gestern einen Film gesehen.“: „Sehen“ steht hier mit „haben“.',
      };
      const rejected: Record<string, ReviewIssue> = {
        'examples:0': { issues: ['unsupported'], feedback: ['Correct the example.'] },
        ...(rejectAbout
          ? { about: { issues: ['incorrect'], feedback: ['Correct the rule.'] } }
          : {}),
      };
      const repaired = {
        ...candidate,
        about: rejectAbout
          ? `„${correctedExample.target}“: ${correctedExample.meaning}`
          : candidate.about,
        examples: [correctedExample, ...candidate.examples.slice(1)],
      };
      boundary.generate.mockResolvedValueOnce({ content: JSON.stringify(candidate) });
      queueReview(candidate, rejected);
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify({
          ...(rejectAbout ? { about: { exampleIndex: 0 } } : {}),
          examples: { '0': correctedExample },
        }),
      });
      queueReview(repaired);

      await expect(generateClassIntro(params)).resolves.toEqual(repaired);
      const finalReviews = boundary.generate.mock.calls
        .filter(([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator')
        .slice(2);
      for (const [, messages] of finalReviews)
        expect(JSON.parse(messages[0].content).introContext.about).toBe(repaired.about);
    }
  );
  it.each(['größer', 'größer'.normalize('NFD'), '42'])(
    'accepts exactly 180 words with Unicode-safe tokens: %s',
    async (token) => {
      const original = introWithWordCount(180, token);
      original.purpose += '\t→ + …\n';
      boundary.generate.mockResolvedValueOnce({ content: JSON.stringify(original) });
      queueReview(original);

      await expect(generateClassIntro(params)).resolves.toEqual(original);
      expect(
        boundary.generate.mock.calls.some(
          ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
        )
      ).toBe(false);
    }
  );

  it.each([181, 238])(
    'repairs an initial %i-word intro using its measured rejection',
    async (count) => {
      const oversized = introWithWordCount(count);
      boundary.generate
        .mockResolvedValueOnce({ content: JSON.stringify(oversized) })
        .mockResolvedValueOnce({ content: JSON.stringify(candidate) });
      queueReview(candidate);

      await expect(generateClassIntro(params)).resolves.toEqual(candidate);
      const [, messages, options] = boundary.generate.mock.calls[1]!;
      expect(options.jsonSchema.name).toBe('class_intro_repair');
      expect(messages[0].content).toContain(
        JSON.stringify(scopedIntroFixture({ ...oversized, visuals: null }))
      );
      const prefix = 'Structural validation diagnostics: ';
      const diagnostics = messages[0].content
        .split('\n')
        .find((line: string) => line.startsWith(prefix));
      expect(diagnostics).toBeDefined();
      expect(JSON.parse(diagnostics!.slice(prefix.length))).toEqual([
        { reason: 'prose_word_limit', maxWords: 180, actualWords: count },
      ]);
      const reviews = boundary.generate.mock.calls.filter(
        ([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator'
      );
      const reviewedAddresses = reviews.flatMap(([, messages]) => {
        const batch = JSON.parse(messages[0].content);
        expect(batch.introContext).toEqual(candidate);
        return batch.items.map(
          ({ content }: { content: { address: IntroAddress } }) => content.address
        );
      });
      expect(reviewedAddresses).toEqual(introAddresses(candidate));
    }
  );

  it('repairs malformed JSON without inventing a measured word-limit rejection', async () => {
    boundary.generate
      .mockResolvedValueOnce({ content: '{' })
      .mockResolvedValueOnce({ content: JSON.stringify(candidate) });
    queueReview(candidate);

    await expect(generateClassIntro(params)).resolves.toEqual(candidate);
    const repair = boundary.generate.mock.calls.find(
      ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
    )!;
    expect(repair[1][0].content).not.toContain('prose_word_limit');
  });

  it('compacts eleven addresses using the measured limit before any semantic audit', async () => {
    const oversized = { ...candidate, focus: [...candidate.focus, 'Nenne die vergangene Zeit.'] };
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(oversized) })
      .mockResolvedValueOnce({ content: JSON.stringify(candidate) });
    queueReview(candidate);

    await expect(generateClassIntro(params)).resolves.toEqual(candidate);
    const repair = boundary.generate.mock.calls.find(
      ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
    )!;
    const prefix = 'Structural validation diagnostics: ';
    const line = repair[1][0].content.split('\n').find((value: string) => value.startsWith(prefix));
    expect(JSON.parse(line.slice(prefix.length))).toEqual([
      { reason: 'audit_address_limit', maxAddresses: 10, actualAddresses: 11 },
    ]);
  });

  it('rejects an eleven-address structural replacement without a second repair', async () => {
    const oversized = { ...candidate, focus: [...candidate.focus, 'Nenne die vergangene Zeit.'] };
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(oversized) })
      .mockResolvedValueOnce({ content: JSON.stringify(oversized) });

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls.map(([, , options]) => options.jsonSchema?.name)).toEqual([
      'class_intro_generation',
      'class_intro_repair',
    ]);
  });

  it('fails closed when the one structural repair still exceeds 180 words', async () => {
    const oversized = introWithWordCount(181);
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(oversized) })
      .mockResolvedValueOnce({ content: JSON.stringify(oversized) });

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls.map(([, , options]) => options.jsonSchema?.name)).toEqual([
      'class_intro_generation',
      'class_intro_repair',
    ]);
  });

  it('rejects a semantic patch whose complete merged intro exceeds 180 words', async () => {
    const original = introWithWordCount(180);
    const rejected = {
      'examples:0': { issues: ['incorrect'], feedback: ['Clarify the usage note.'] },
    };
    const patch = {
      examples: { '0': { ...original.examples[0], note: 'Gehen verwendet hier sein.' } },
    };
    boundary.generate.mockResolvedValueOnce({ content: JSON.stringify(original) });
    queueReview(original, rejected);
    boundary.generate.mockResolvedValueOnce({ content: JSON.stringify(patch) });

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    const repair = boundary.generate.mock.calls.at(-1)!;
    expect(repair[2].jsonSchema.schema.properties).toEqual({ examples: expect.any(Object) });
    expect(repair[1][0].content).toContain(original.about);
    expect(repair[1][0].content).not.toContain('Structural validation diagnostics:');
    const originalReview = boundary.generate.mock.calls.find(([system]) =>
      system.startsWith('Independently review')
    )!;
    expect(JSON.parse(originalReview[1][0].content).introContext).toEqual(original);
    expect(boundary.generate.mock.calls.map(([, , options]) => options.jsonSchema?.name)).toEqual([
      'class_intro_generation',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_repair',
    ]);
  });

  it.each([1, 3])(
    'preserves %i bounded adjudicated defects and their remedies in the repair request',
    async (commentCount) => {
      const feedback = Array.from({ length: commentCount }, (_, index) =>
        `Comment ${index}: the focus needs a concrete learner action.`.padEnd(120, '.')
      );
      const rejected = {
        'focus:0': {
          issues: ['infeasible', 'incorrect', 'unsupported'].slice(0, commentCount),
          feedback,
        },
      };
      const repaired = {
        ...candidate,
        focus: candidate.focus.map((focus, index) =>
          index === 0
            ? '„Ich habe gestern meine Freundin besucht.“: Erzähle von deinem Besuch.'
            : focus
        ),
      };
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify(candidate),
        model: 'captured-model',
      });
      queueReview(candidate, rejected);
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify({ focus: { '0': repaired.focus[0] } }),
        model: 'captured-model',
      });
      queueReview(repaired);

      await expect(generateClassIntro(params)).resolves.toEqual(repaired);
      const repairRequest = boundary.generate.mock.calls.find(
        ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
      );
      const feedbackLine = repairRequest![1][0].content
        .split('\n')
        .find((line: string) => line.startsWith('Review feedback: '));
      expect(JSON.parse(feedbackLine!.slice('Review feedback: '.length))).toEqual([
        {
          index: 0,
          feedback: [
            `focus: focus[0]: ${feedback.map((text) => `${text} Correction: Correct the identified teaching defect.`).join(' ')}`,
          ],
        },
      ]);
      const evidencePrefix = 'Adjudicated defect evidence: ';
      const evidenceLine = repairRequest![1][0].content
        .split('\n')
        .find((line: string) => line.startsWith(evidencePrefix));
      expect(JSON.parse(evidenceLine!.slice(evidencePrefix.length))).toEqual([
        {
          address: { field: 'focus', index: 0 },
          findings: reviewPackets(candidate, rejected)[0]!.adjudicator.items[2]!.findings,
        },
      ]);
    }
  );

  it('repairs only rejected example addresses and retains accepted siblings', async () => {
    const rejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
    };
    const repaired = {
      ...candidate,
      examples: candidate.examples.map((example, index) =>
        index === 1
          ? {
              ...example,
              meaning: 'Die sprechende Gruppe erzählt, dass sie zu Fuß zum Markt gegangen ist.',
            }
          : example
      ),
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    queueReview(candidate, rejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({ examples: { '1': repaired.examples[1] } }),
      model: 'captured-model',
    });
    queueReview(repaired);

    await expect(generateClassIntro(params)).resolves.toEqual(repaired);
    expect(repaired.examples[0]).toEqual(candidate.examples[0]);
    expect(
      boundary.generate.mock.calls.find(
        ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
      )![2].jsonSchema.schema.properties.examples.required
    ).toEqual(['1']);
    const finalBatches = boundary.generate.mock.calls
      .filter(([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator')
      .slice(2)
      .map(([, messages]) => JSON.parse(messages[0].content));
    const finalItems = finalBatches.flatMap((batch) => batch.items);
    expect(finalItems).toHaveLength(introAddresses(repaired).length);
    for (const batch of finalBatches) {
      expect(batch.introContext).toEqual(repaired);
      expect(batch.introContext.examples[0]).toEqual(candidate.examples[0]);
    }
  });

  it('merges multiple rejected indices in the same and different arrays', async () => {
    const rejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct example one.'] },
      'examples:2': { issues: ['unsupported'], feedback: ['Correct example two.'] },
      'tips:0': { issues: ['incorrect'], feedback: ['Correct tip zero.'] },
      'tips:2': { issues: ['incorrect'], feedback: ['Correct tip two.'] },
    };
    const patch: {
      examples: Record<string, IntroFixture['examples'][number]>;
      tips: Record<string, string>;
    } = {
      examples: {
        '1': { ...candidate.examples[1], meaning: 'Wir gingen zu Fuß zum Markt.' },
        '2': { ...candidate.examples[2], meaning: 'Auf der Reise sah ich schöne Orte.' },
      },
      tips: {
        '0': '„Ich habe gestern meine Freundin besucht.“: Lerne „besuchen“ mit „haben“.',
        '2': '„Ich habe gestern meine Freundin besucht.“: „Gestern“ nennt einen vergangenen Zeitpunkt.',
      },
    };
    const repaired: IntroFixture = {
      ...candidate,
      examples: candidate.examples.map((example, index) =>
        Object.hasOwn(patch.examples, String(index)) ? patch.examples[String(index)]! : example
      ),
      tips: candidate.tips.map((tip, index) =>
        Object.hasOwn(patch.tips, String(index)) ? patch.tips[String(index)]! : tip
      ),
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    queueReview(candidate, rejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(patch),
      model: 'captured-model',
    });
    queueReview(repaired);

    await expect(generateClassIntro(params)).resolves.toEqual(repaired);
    expect(repaired.examples[0]).toEqual(candidate.examples[0]);
    expect(repaired.tips[1]).toBe(candidate.tips[1]);
    const schema = boundary.generate.mock.calls.find(
      ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
    )![2].jsonSchema.schema.properties;
    expect(schema.examples.required).toEqual(['1', '2']);
    expect(schema.tips.required).toEqual(['0', '2']);
  });

  it('removes only a rejected optional visual and audits the merged result again', async () => {
    const original = {
      ...candidate,
      focus: candidate.focus.slice(0, 1),
      visuals: {
        timeline: {
          title: candidate.about,
          steps: [candidate.examples[0]!.target, candidate.examples[1]!.target],
        },
        contrast: null,
        callouts: [],
        links: [],
      },
    };
    const rejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
      visuals: { issues: ['unsupported'], feedback: ['The timeline order is unsupported.'] },
    };
    const repaired: IntroFixture = {
      ...original,
      examples: original.examples.map((example, index) =>
        index === 1 ? { ...example, meaning: 'Wir gingen zu Fuß zum Markt.' } : example
      ),
    };
    delete repaired.visuals;
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(original),
      model: 'captured-model',
    });
    queueReview(original, rejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({ examples: { '1': repaired.examples[1] } }),
      model: 'captured-model',
    });
    queueReview(repaired);
    await expect(generateClassIntro(params)).resolves.toEqual(repaired);
    const reviewCalls = boundary.generate.mock.calls.filter(
      ([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator'
    );
    const finalItems = reviewCalls
      .slice(2)
      .flatMap(([, messages]) =>
        JSON.parse(messages[0].content).items.map((item: { content: unknown }) => item.content)
      );
    expect(finalItems).toHaveLength(introAddresses(repaired).length);
    expect(finalItems.some((item) => item.address.field === 'visuals')).toBe(false);
  });

  it('preserves authentic review evidence when a final review rejects the repair', async () => {
    const firstRejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
    };
    const repaired = {
      ...candidate,
      examples: candidate.examples.map((example, index) =>
        index === 1 ? { ...example, meaning: 'Wir gingen zum Markt.' } : example
      ),
    };
    const finalRejected = {
      'examples:1': { issues: ['uncertain'], feedback: ['This changes the described action.'] },
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    queueReview(candidate, firstRejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({ examples: { '1': repaired.examples[1] } }),
      model: 'captured-model',
    });
    queueReview(repaired, finalRejected);
    const error = await generateClassIntro(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.teachingFailure?.reviews).toEqual([
      {
        candidate: JSON.stringify(auditItems(candidate, firstRejected)),
        verdict: fullVerdict(candidate, firstRejected),
      },
      {
        candidate: JSON.stringify(auditItems(repaired, finalRejected)),
        verdict: fullVerdict(repaired, finalRejected),
      },
    ]);
  });

  it('retains complete compact candidates when a preserved visual fails the final audit', async () => {
    const original = {
      ...candidate,
      focus: candidate.focus.slice(0, 2),
      tips: candidate.tips.slice(0, 2),
      visuals: {
        timeline: {
          title: candidate.about,
          steps: [candidate.examples[0]!.target, candidate.examples[1]!.target],
        },
        contrast: {
          title: candidate.about,
          leftLabel: candidate.focus[0],
          leftItems: [candidate.examples[0]!.target],
          rightLabel: candidate.focus[1],
          rightItems: [candidate.examples[1]!.target],
        },
        callouts: [
          {
            label: candidate.focus[0],
            text: candidate.examples[0]!.note,
            tone: 'blue',
          },
          {
            label: candidate.focus[1],
            text: candidate.examples[1]!.note,
            tone: 'teal',
          },
        ],
        links: [],
      },
    };
    const prose = [
      original.purpose,
      original.about,
      ...original.focus,
      ...original.tips,
      ...original.examples.flatMap(({ target, meaning, note }) => [target, meaning, note]),
    ];
    expect(prose.join(' ').split(/\s+/).length).toBeLessThanOrEqual(180);
    const originalAddresses = introAddresses(original);
    const duplicatedContext = originalAddresses.map((address) => ({
      address,
      introContext: original,
    }));
    expect(Buffer.byteLength(JSON.stringify(duplicatedContext), 'utf8')).toBeGreaterThan(
      Buffer.byteLength(JSON.stringify(auditItems(original)), 'utf8')
    );
    expect(Buffer.byteLength(JSON.stringify(auditItems(original)), 'utf8')).toBeLessThan(32 * 1024);
    const firstRejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
    };
    const repaired = {
      ...original,
      examples: original.examples.map((example, index) =>
        index === 1 ? { ...example, meaning: 'Die Gruppe ist zu Fuß zum Markt gegangen.' } : example
      ),
    };
    const finalRejected = {
      visuals: { issues: ['incorrect'], feedback: ['The timeline order is unsupported.'] },
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(original),
      model: 'captured-model',
    });
    queueReview(original, firstRejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({ examples: { '1': repaired.examples[1] } }),
      model: 'captured-model',
    });
    queueReview(repaired, finalRejected);

    const error = await generateClassIntro(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(
      error.teachingFailure?.reviews.map(({ candidate: retained, ...review }) => ({
        ...review,
        candidate: retained === null ? null : JSON.parse(retained),
      }))
    ).toEqual([
      {
        candidate: auditItems(original, firstRejected),
        verdict: fullVerdict(original, firstRejected),
      },
      {
        candidate: auditItems(repaired, finalRejected),
        verdict: fullVerdict(repaired, finalRejected),
      },
    ]);
    const finalBatches = boundary.generate.mock.calls
      .filter(([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator')
      .slice(2)
      .map(([, messages]) => JSON.parse(messages[0].content));
    expect(
      finalBatches.flatMap((batch) =>
        batch.items.map(({ content }: { content: { address: IntroAddress } }) => content.address)
      )
    ).toEqual(originalAddresses);
    for (const batch of finalBatches) {
      expect(batch.introContext).toEqual(repaired);
      expect(batch.introContext.visuals).toEqual(original.visuals);
      expect(batch.introContext.focus).toEqual(original.focus);
      expect(batch.introContext.tips).toEqual(original.tips);
      expect(batch.introContext.examples[0]).toEqual(original.examples[0]);
    }
    expect(JSON.stringify(error)).not.toContain(original.about);
  });

  it('rejects patch keys outside the reviewed address set', async () => {
    const rejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    queueReview(candidate, rejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify({
        examples: { '1': candidate.examples[1] },
        focus: { '0': 'Unreviewed change.' },
      }),
      model: 'captured-model',
    });
    const error = await generateClassIntro(params).catch((caught: unknown) => caught);
    const failure = captureGenerationFailure(error);
    expect(failure.category).toBe('section_quality');
    expect(failure.teachingFailure?.reviews[0]).toEqual({
      candidate: JSON.stringify(auditItems(candidate, rejected)),
      verdict: fullVerdict(candidate, rejected),
    });
    expect(
      boundary.generate.mock.calls.find(
        ([, , options]) => options.jsonSchema?.name === 'class_intro_repair'
      )![2].jsonSchema.schema.properties
    ).toEqual({
      examples: expect.any(Object),
    });
  });

  it.each(['faithful', 'faithful collective', 'unsupported group shift'])(
    'applies the same example meaning policy to repair: %s',
    async (outcome) => {
      const repairedMeaning =
        outcome === 'unsupported group shift'
          ? 'Du erzählst, dass ihr zu Fuß zum Markt gegangen seid.'
          : outcome === 'faithful collective'
            ? 'Die sprechende Gruppe erzählt, dass sie zu Fuß zum Markt gegangen ist.'
            : 'Die sprechende Person und ihre Gruppe sind zu Fuß zum Markt gegangen.';
      const repaired = {
        ...candidate,
        examples: candidate.examples.map((example, index) =>
          index === 1 ? { ...example, meaning: repairedMeaning } : example
        ),
      };
      const rejected = {
        'examples:1': {
          issues: ['unsupported'],
          feedback: ['Preserve the described participants and action.'],
        },
      };
      const finalRejected: Record<string, ReviewIssue> =
        outcome === 'unsupported group shift'
          ? {
              'examples:1': {
                issues: ['unsupported'],
                feedback: ['The source does not establish that the addressee is included.'],
              },
            }
          : {};
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify(candidate),
        model: 'captured-model',
      });
      queueReview(candidate, rejected);
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify({ examples: { '1': repaired.examples[1] } }),
        model: 'captured-model',
      });
      queueReview(repaired, finalRejected);
      const result = await generateClassIntro(params).catch((caught: unknown) => caught);
      if (outcome === 'unsupported group shift')
        expect(result).toBeInstanceOf(TeachingQualityRejectionError);
      else expect(result).toEqual(repaired);
      const policy = classIntroExampleMeaningPolicy(params);
      expect(policy).toContain('same event time and aspect');
      expect(policy).toContain('need not repeat the target’s grammatical tense');
      expect(boundary.generate.mock.calls.every(([system]) => system.includes(policy))).toBe(true);
      expect(classIntroGrammarRulePolicy()).toContain(
        'A word-order claim must explicitly identify the clause type'
      );
      expect(
        boundary.generate.mock.calls.every(([system]) =>
          system.includes(classIntroGrammarRulePolicy())
        )
      ).toBe(true);
    }
  );

  it('continues the original error when repair fails while retaining the first review', async () => {
    const rejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
    };
    const originalError = new Error('repair provider failed');
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    queueReview(candidate, rejected);
    boundary.generate.mockRejectedValueOnce(originalError);
    const error = await generateClassIntro(params).catch((caught: unknown) => caught);
    expect(error).toBe(originalError);
    expect(captureGenerationFailure(error).teachingFailure?.reviews[0].candidate).toBe(
      JSON.stringify(auditItems(candidate, rejected))
    );
  });

  it('preserves the purpose and re-reviews after selecting another overview example', async () => {
    const rejected = { about: { issues: ['uncertain'], feedback: ['Clarify the explanation.'] } };
    const patch = { about: { exampleIndex: 1 } };
    const repaired = {
      ...candidate,
      about: '„Wir sind zu Fuß zum Markt gegangen.“: Wir gingen zu Fuß zum Markt.',
    };
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(candidate),
      model: 'captured-model',
    });
    queueReview(candidate, rejected);
    boundary.generate.mockResolvedValueOnce({
      content: JSON.stringify(patch),
      model: 'captured-model',
    });
    queueReview(repaired);
    await expect(generateClassIntro(params)).resolves.toEqual(repaired);
    const allReviewCalls = boundary.generate.mock.calls.filter(
      ([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator'
    );
    expect(
      allReviewCalls.slice(2).flatMap(([, messages]) => JSON.parse(messages[0].content).items)
    ).toHaveLength(introAddresses(repaired).length);
  });

  it.each(['review provider', 'review protocol', 'selection change', 'cancellation'])(
    'retains the first review and terminal outcome after %s',
    async (stage) => {
      const controller = new AbortController();
      const ai = {
        provider: 'fixture',
        model: 'captured-model',
        signal: controller.signal,
        execution: { ...params.execution, signal: controller.signal },
      };
      boundary.resolve.mockResolvedValue(ai);
      const rejected = {
        'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
      };
      const originalError = new Error('terminal review failure');
      const repaired = {
        ...candidate,
        examples: candidate.examples.map((example, index) =>
          index === 1 ? { ...example, meaning: 'Wir gingen zum Markt.' } : example
        ),
      };
      boundary.generate.mockResolvedValueOnce({
        content: JSON.stringify(candidate),
        model: ai.model,
      });
      queueReview(candidate, rejected);
      boundary.generate.mockImplementationOnce(() => {
        if (stage === 'selection change') ai.model = 'changed-selection';
        if (stage === 'cancellation') controller.abort(originalError);
        return {
          content: JSON.stringify({ examples: { '1': repaired.examples[1] } }),
          model: 'captured-model',
        };
      });
      boundary.generate.mockImplementationOnce(() => {
        if (stage === 'review protocol') return { content: '{', model: ai.model };
        if (stage === 'review provider') throw originalError;
        throw originalError;
      });
      if (stage === 'review protocol')
        boundary.generate.mockResolvedValueOnce({ content: '{', model: ai.model });

      const error = await generateClassIntro(params).catch((caught: unknown) => caught);
      if (stage === 'review protocol' || stage === 'selection change')
        expect(error).toBeInstanceOf(ReviewerProtocolError);
      else expect(error).toBe(originalError);
      const evidence = captureGenerationFailure(error);
      expect(evidence.category).toBe(
        stage === 'review protocol' || stage === 'selection change'
          ? 'review_protocol'
          : 'generation_failed'
      );
      expect(evidence.teachingFailure?.reviews).toEqual([
        {
          candidate: JSON.stringify(auditItems(candidate, rejected)),
          verdict: fullVerdict(candidate, rejected),
        },
      ]);
    }
  );
});
