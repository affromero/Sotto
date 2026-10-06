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
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';

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
const introAuditFields = [
  {
    auditFields: ['purpose'],
    select: (value: { purpose: string }) => ({ purpose: value.purpose }),
  },
  { auditFields: ['about'], select: (value: { about: string }) => ({ about: value.about }) },
  {
    auditFields: ['focus', 'tips'],
    select: (value: { focus: string[]; tips: string[] }) => ({
      focus: value.focus,
      tips: value.tips,
    }),
  },
  {
    auditFields: ['examples'],
    select: (value: { examples: unknown[] }) => ({ examples: value.examples }),
  },
];
function auditItems(value: {
  purpose: string;
  about: string;
  focus: string[];
  examples: unknown[];
  tips: string[];
}) {
  return introAuditFields.map(({ auditFields, select }) => ({
    auditFields,
    introContext: value,
    fields: select(value),
  }));
}
function approvedForIntro() {
  return {
    items: introAuditFields.map((_, index) => ({
      index,
      acceptable: true,
      issues: [],
      feedback: [],
    })),
  };
}
const approved = approvedForIntro();
const capturedLunaIntro = {
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
const capturedLunaVerdict = {
  items: [
    {
      index: 0,
      acceptable: false,
      issues: ['unnatural'],
      feedback: [
        'examples[1].meaning: „Wir haben den Markt gehend erreicht“ ist im Deutschen unidiomatisch und für A2 ungeeignet.',
        'examples[2].meaning: „mit meinen Augen wahrgenommen“ klingt unnötig technisch und unnatürlich als einfache Umschreibung von „gesehen“.',
      ],
    },
  ],
};

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
  });
});

describe('field-local intro repair', () => {
  it('corrects omitted defects and preserves a sound field behind mistaken review feedback', async () => {
    const candidate = capturedLunaIntro;
    const verdict = {
      items: [
        { index: 0, acceptable: true, issues: [], feedback: [] },
        {
          index: 1,
          acceptable: false,
          issues: ['unnatural'],
          feedback: ['The about text sounds unnatural and needs rewriting.'],
        },
        { index: 2, acceptable: true, issues: [], feedback: [] },
        { index: 3, acceptable: true, issues: [], feedback: [] },
      ],
    };
    const repaired = {
      purpose: 'Du lernst, kurz und klar zu erzählen, was du erlebt und gemacht hast.',
      about: candidate.about,
      focus: candidate.focus,
      examples: candidate.examples.map((example, index) =>
        index === 1
          ? { ...example, meaning: 'Wir waren zu Fuß unterwegs und sind zum Markt gegangen.' }
          : index === 2
            ? { ...example, meaning: 'Auf der Reise habe ich viele schöne Orte gesehen.' }
            : example
      ),
      tips: candidate.tips,
    };
    boundary.generate
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(verdict), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(repaired), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(params);

    expect(result).toEqual(repaired);
    expect(result.about).toBe(candidate.about);
    expect(result.focus).toEqual(candidate.focus);
    expect(result.tips).toEqual(candidate.tips);
    expect(result.examples[0]).toEqual(candidate.examples[0]);
    expect(result.examples[1].target).toBe(candidate.examples[1].target);
    expect(result.examples[1].note).toBe(candidate.examples[1].note);
    expect(result.examples[2].target).toBe(candidate.examples[2].target);
    expect(result.examples[2].note).toBe(candidate.examples[2].note);
    expect(result.visuals).toBeUndefined();
    expect(boundary.generate.mock.calls[0][0]).toContain(
      'Make purpose one short sentence naming a concrete action'
    );
    const correction = boundary.generate.mock.calls.find(([system]) =>
      system.includes('semantic replacement')
    );
    expect(correction?.[1][0].content).toContain('may be incomplete or mistaken');
    expect(correction?.[1][0].content).toContain('Independently inspect every field');
    expect(correction?.[1][0].content).toContain('correct it only when substantiated');
    expect(correction?.[1][0].content).toContain('gehend erreicht');
    expect(correction?.[1][0].content).toContain('The about text sounds unnatural');
    expect(correction?.[1][0].content).toContain(
      'The rejected purpose is intentionally omitted from the candidate below'
    );
    expect(correction?.[1][0].content).not.toContain(candidate.purpose);
    const rejectedCandidateText = correction?.[1][0].content.split(
      'Rejected candidate with its purpose omitted for independent replacement:\n'
    )[1];
    expect(JSON.parse(rejectedCandidateText!)).toEqual(
      Object.fromEntries(Object.entries(candidate).filter(([field]) => field !== 'purpose'))
    );
    const firstReview = boundary.generate.mock.calls.find(([system]) =>
      system.startsWith('Independently review')
    );
    expect(JSON.parse(firstReview![1][0].content).items[0].content.introContext.purpose).toBe(
      candidate.purpose
    );
    expect(boundary.generate.mock.calls[2][0]).toContain(
      'During semantic replacement, the rejected purpose is intentionally omitted'
    );
    const finalReview = boundary.generate.mock.calls
      .filter(([system]) => system.startsWith('Independently review'))
      .at(-1);
    expect(JSON.parse(finalReview![1][0].content).items[0].content.introContext).toEqual(repaired);
  });

  it('makes field-local A2 corrections and preserves the captured Luna candidate wording', async () => {
    const candidate = capturedLunaIntro;
    const verdict = {
      items: [
        { index: 0, acceptable: true, issues: [], feedback: [] },
        { index: 1, acceptable: true, issues: [], feedback: [] },
        { index: 2, acceptable: true, issues: [], feedback: [] },
        { ...capturedLunaVerdict.items[0], index: 3 },
      ],
    };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(verdict), model: 'captured-model' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...candidate,
          examples: candidate.examples.map((example, index) =>
            index === 1
              ? { ...example, meaning: 'Wir waren zu Fuß unterwegs und sind zum Markt gegangen.' }
              : index === 2
                ? { ...example, meaning: 'Auf meiner Reise habe ich viele schöne Orte gesehen.' }
                : example
          ),
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(params);
    expect(result.examples).toEqual([
      candidate.examples[0],
      {
        ...candidate.examples[1],
        meaning: 'Wir waren zu Fuß unterwegs und sind zum Markt gegangen.',
      },
      {
        ...candidate.examples[2],
        meaning: 'Auf meiner Reise habe ich viele schöne Orte gesehen.',
      },
    ]);
    expect(result).toMatchObject({
      purpose: candidate.purpose,
      about: candidate.about,
      focus: candidate.focus,
      tips: candidate.tips,
    });

    const replacementPrompt = boundary.generate.mock.calls[2][1][0].content;
    expect(replacementPrompt).toContain('feedback may be incomplete or mistaken');
    expect(replacementPrompt).toContain('Independently inspect every field');
    expect(replacementPrompt).toContain('correct it only when substantiated');
    expect(replacementPrompt).toContain('Preserve sound wording, supported meaning and facts');
    expect(replacementPrompt).toContain('do not rewrite sound content for variety');
    expect(replacementPrompt).toContain(
      'The rejected purpose is intentionally omitted from the candidate below'
    );
    expect(replacementPrompt).not.toContain(candidate.purpose);
    expect(boundary.generate.mock.calls[2][0]).toContain(
      'style preference alone does not justify changing sound wording'
    );
    const reviewCalls = boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    );
    expect(JSON.parse(reviewCalls.at(-1)![1][0].content).items[0].content.introContext).toEqual(
      result
    );
  });

  it('fails closed when whole-candidate review rejects drift introduced by field-local repair', async () => {
    const candidate = capturedLunaIntro;
    const firstVerdict = {
      items: [
        { index: 0, acceptable: true, issues: [], feedback: [] },
        { index: 1, acceptable: true, issues: [], feedback: [] },
        { index: 2, acceptable: true, issues: [], feedback: [] },
        { ...capturedLunaVerdict.items[0], index: 3 },
      ],
    };
    const drifted = {
      ...candidate,
      examples: [
        { ...candidate.examples[0], target: 'Ich habe gestern meine Cousine besucht.' },
        {
          ...candidate.examples[1],
          meaning: 'Wir waren nach dem Essen zu Fuß am Fluss unterwegs.',
        },
        {
          ...candidate.examples[2],
          target: 'Auf der Reise habe ich ein altes Schloss gesehen.',
          meaning: 'Das Schloss war auf meiner Reise da, und ich habe es gesehen.',
        },
      ],
    };
    const secondVerdict = {
      items: [
        { index: 0, acceptable: true, issues: [], feedback: [] },
        { index: 1, acceptable: true, issues: [], feedback: [] },
        { index: 2, acceptable: true, issues: [], feedback: [] },
        {
          index: 3,
          acceptable: false,
          issues: ['unnatural'],
          feedback: ['examples[2].meaning describes the Schloss as present and sounds unnatural.'],
        },
      ],
    };
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(firstVerdict), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(drifted), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(secondVerdict), model: 'captured-model' });

    const error = await generateClassIntro(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.teachingFailure?.reviews).toEqual([
      { candidate: JSON.stringify(auditItems(candidate)), verdict: firstVerdict },
      { candidate: JSON.stringify(auditItems(drifted)), verdict: secondVerdict },
    ]);
    const reviewCalls = boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    );
    expect(JSON.parse(reviewCalls[1]![1][0].content).items[0].content.introContext).toEqual(
      drifted
    );
  });
});
