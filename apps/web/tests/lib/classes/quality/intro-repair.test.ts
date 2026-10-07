import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
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
import { classIntroExampleMeaningPolicy } from '@/lib/classes/class-language-policy';

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
  purpose: 'Du lernst, kurz und klar von Erlebnissen und fertigen Aktivitäten zu erzählen.',
  about:
    'Im Gespräch benutzt man oft das Perfekt, wenn etwas schon passiert ist. Es besteht meist aus einer Form von „haben“ oder „sein“ und einem Partizip am Satzende. In Hauptsätzen steht das Hilfsverb oft auf Platz zwei.',
  focus: [
    '„haben“ oder „sein“ passend zum Verb wählen',
    'Das Partizip steht im Hauptsatz oft am Ende',
    '„gestern“ nennt einen Zeitpunkt in der Vergangenheit',
    '„gemacht“, „gesehen“ und „besucht“ in Alltagssätzen verwenden',
  ],
  examples: [
    {
      target: 'Ich habe gestern meine Freundin besucht.',
      meaning: 'Der Besuch bei meiner Freundin war gestern.',
      note: 'Bei „besuchen“ steht das Perfekt mit „haben“.',
    },
    {
      target: 'Wir sind zu Fuß zum Markt gegangen.',
      meaning: 'Wir haben den Markt gehend erreicht.',
      note: '„Gehen“ bildet das Perfekt mit „sein“. „Zu Fuß“ zeigt: Wir waren nicht mit einem Fahrzeug unterwegs.',
    },
    {
      target: 'Auf der Reise habe ich viele schöne Orte gesehen.',
      meaning: 'Während der Reise habe ich viele Orte mit meinen Augen wahrgenommen.',
      note: '„Sehen“ bildet das Perfekt mit „haben“; das Partizip „gesehen“ steht hier am Satzende.',
    },
  ],
  tips: [
    'Bei einer Bewegung von einem Ort zu einem anderen steht oft „sein“: „Ich bin zum Bahnhof gegangen.“',
    'Für viele andere Verben steht „haben“, zum Beispiel: „Ich habe etwas gemacht“ oder „Ich habe einen Film gesehen.“',
    'Im Hauptsatz steht das Hilfsverb oft auf Platz zwei und das Partizip am Ende: „Gestern habe ich gekocht.“',
  ],
};
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
function auditItems(value: IntroFixture) {
  return [{ introContext: value, addresses: introAddresses(value) }];
}
function fullVerdict(value: IntroFixture, rejected: Record<string, ReviewIssue> = {}) {
  return {
    items: introAddresses(value).map((address, index) => ({
      index,
      acceptable: !rejected[addressKey(address)],
      issues: rejected[addressKey(address)]?.issues ?? [],
      feedback: rejected[addressKey(address)]?.feedback ?? [],
    })),
  };
}
function queueReview(value: IntroFixture, rejected: Record<string, ReviewIssue> = {}) {
  const allAddresses = introAddresses(value);
  const verdict = fullVerdict(value, rejected);
  for (let offset = 0; offset < verdict.items.length; offset += 5) {
    const batch = verdict.items.slice(offset, offset + 5);
    boundary.generate.mockResolvedValueOnce({
      model: 'captured-model',
      content: JSON.stringify({
        items: batch.map((item, localIndex) => {
          const issue = rejected[addressKey(allAddresses[offset + localIndex]!)];
          return {
            ...item,
            index: localIndex,
            acceptable: !issue,
            issues: issue?.issues ?? [],
            feedback: issue?.feedback ?? [],
          };
        }),
      }),
    });
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
  it.each([1, 6])(
    'preserves every character of %i maximum-length reviewer comments in the repair request',
    async (commentCount) => {
      const feedback = Array.from({ length: commentCount }, (_, index) =>
        `Comment ${index}: the focus needs a concrete learner action.`.padEnd(300, '.')
      );
      const rejected = { 'focus:0': { issues: ['infeasible'], feedback } };
      const repaired = {
        ...candidate,
        focus: candidate.focus.map((focus, index) =>
          index === 0 ? 'Erzähle, wie du zum Markt gegangen bist.' : focus
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
        { index: 0, feedback: [`focus: focus[0]: ${feedback.join(' ')}`] },
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
      boundary.generate.mock.calls[4]![2].jsonSchema.schema.properties.examples.required
    ).toEqual(['1']);
    const finalBatches = boundary.generate.mock.calls
      .filter(([system]) => system.startsWith('Independently review'))
      .slice(3)
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
        '0': 'Bei Bewegung zu einem Ziel kann „sein“ stehen.',
        '2': '„Gestern“ nennt einen vergangenen Zeitpunkt.',
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
    const schema = boundary.generate.mock.calls[4]![2].jsonSchema.schema.properties;
    expect(schema.examples.required).toEqual(['1', '2']);
    expect(schema.tips.required).toEqual(['0', '2']);
  });

  it('removes only a rejected optional visual and audits the merged result again', async () => {
    const original = {
      ...candidate,
      visuals: {
        timeline: {
          title: 'Timeline',
          steps: ['Yesterday: We went.', 'Today: We tell the story.'],
        },
        contrast: null,
        callouts: [],
        links: [],
      },
    };
    const rejected = {
      'examples:1': { issues: ['unsupported'], feedback: ['Correct the meaning.'] },
      visuals: { issues: ['unsupported'], feedback: ['The timeline adds an unsupported event.'] },
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
    const reviewCalls = boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    );
    const finalItems = reviewCalls
      .slice(3)
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
        candidate: JSON.stringify(auditItems(candidate)),
        verdict: fullVerdict(candidate, firstRejected),
      },
      {
        candidate: JSON.stringify(auditItems(repaired)),
        verdict: fullVerdict(repaired, finalRejected),
      },
    ]);
  });

  it('retains complete compact candidates when a preserved visual fails the final audit', async () => {
    const original = {
      purpose: 'Erzähle, was du gestern gemacht hast.',
      about:
        'Das Perfekt besteht aus „haben“ oder „sein“ und einem Partizip. In Hauptsätzen steht das Hilfsverb auf Position zwei und das Partizip am Ende.',
      focus: [
        '„besuchen“: habe besucht',
        '„gehen“: bin gegangen',
        '„sehen“: habe gesehen',
        '„machen“: habe gemacht',
        '„fahren“ mit einem Ziel: bin gefahren',
        '„gestern“ nennt die vergangene Zeit.',
      ],
      examples: [
        {
          target: 'Ich habe gestern meine Freundin besucht.',
          meaning: 'Der Besuch war gestern.',
          note: '„besuchen“: haben + besucht.',
        },
        {
          target: 'Wir sind zu Fuß zum Markt gegangen.',
          meaning: 'Wir sind mit dem Bus zum Markt gefahren.',
          note: '„gehen“: sein + gegangen.',
        },
        {
          target: 'Auf der Reise habe ich alte Häuser gesehen.',
          meaning: 'Ich habe alte Häuser auf einer Reise gesehen.',
          note: '„sehen“: haben + gesehen.',
        },
        {
          target: 'Ich habe einen Kuchen gemacht.',
          meaning: 'Der Kuchen ist fertig.',
          note: '„machen“: haben + gemacht.',
        },
        {
          target: 'Er ist mit dem Bus nach Berlin gefahren.',
          meaning: 'Er ist mit einem Bus nach Berlin gereist.',
          note: 'Mit einem Ziel steht „fahren“ hier mit „sein“.',
        },
      ],
      tips: [
        'Lerne das Hilfsverb mit dem Verb.',
        '„Gestern“ besetzt hier Position eins.',
        '„Gestern habe ich gekocht.“ ist ein Hauptsatz.',
        'Frage nach dem Ziel: „zum Markt“.',
        'Vergleiche vollständige Sätze.',
      ],
      visuals: {
        timeline: {
          title: 'Gestern auf der Reise',
          steps: ['Wir sind zu Fuß zum Markt gegangen.', 'Er sieht alte Häuser.'],
        },
        contrast: {
          title: 'Ein Hauptsatz im Perfekt',
          leftLabel: 'Zeitangabe zuerst',
          leftItems: [
            'Gestern habe ich meine Freundin besucht.',
            'Auf der Reise habe ich alte Häuser gesehen.',
          ],
          rightLabel: 'Subjekt zuerst',
          rightItems: [
            'Ich habe gestern meine Freundin besucht.',
            'Ich habe auf der Reise alte Häuser gesehen.',
          ],
        },
        callouts: [
          {
            label: 'Hilfsverb',
            text: 'Lerne „gehen“ mit „sein“: „Wir sind zum Markt gegangen.“',
            tone: 'blue',
          },
          {
            label: 'Partizip',
            text: '„Ich habe meine Freundin besucht.“: „besucht“ steht am Ende.',
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
    expect(Buffer.byteLength(JSON.stringify(duplicatedContext), 'utf8')).toBeGreaterThan(32 * 1024);
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
      visuals: { issues: ['incorrect'], feedback: ['The timeline adds a present-tense event.'] },
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
        candidate: auditItems(original),
        verdict: fullVerdict(original, firstRejected),
      },
      {
        candidate: auditItems(repaired),
        verdict: fullVerdict(repaired, finalRejected),
      },
    ]);
    const finalBatches = boundary.generate.mock.calls
      .filter(([system]) => system.startsWith('Independently review'))
      .slice(4)
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
      candidate: JSON.stringify(auditItems(candidate)),
      verdict: fullVerdict(candidate, rejected),
    });
    expect(boundary.generate.mock.calls[4]![2].jsonSchema.schema.properties).toEqual({
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
      expect(boundary.generate.mock.calls.every(([system]) => system.includes(policy))).toBe(true);
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
      JSON.stringify(auditItems(candidate))
    );
  });

  it('preserves the purpose and re-reviews after a scalar correction', async () => {
    const rejected = { about: { issues: ['uncertain'], feedback: ['Clarify the explanation.'] } };
    const patch = { about: 'Das Perfekt beschreibt abgeschlossene Erlebnisse.' };
    const repaired = { ...candidate, ...patch };
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
    const allReviewCalls = boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    );
    expect(
      allReviewCalls.slice(3).flatMap(([, messages]) => JSON.parse(messages[0].content).items)
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
          candidate: JSON.stringify(auditItems(candidate)),
          verdict: fullVerdict(candidate, rejected),
        },
      ]);
    }
  );
});
