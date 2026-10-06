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
const approved = { items: [{ index: 0, acceptable: true, issues: [], feedback: [] }] };
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
  it('makes field-local A2 corrections and preserves the captured Luna candidate wording', async () => {
    const candidate = capturedLunaIntro;
    const verdict = capturedLunaVerdict;
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
    expect(replacementPrompt).toContain('Preserve every unflagged field verbatim');
    expect(replacementPrompt).toContain('preserve sound wording and supported meaning');
    expect(replacementPrompt).toContain('Do not rewrite sound content for variety');
    expect(boundary.generate.mock.calls[2][0]).toContain(
      'In semantic replacement, these style requirements apply to changed fields'
    );
    const reviewCalls = boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    );
    expect(JSON.parse(reviewCalls.at(-1)![1][0].content).items[0].content).toEqual(result);
  });

  it('fails closed when whole-candidate review rejects drift introduced by field-local repair', async () => {
    const candidate = capturedLunaIntro;
    const firstVerdict = capturedLunaVerdict;
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
        {
          index: 0,
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
      { candidate: JSON.stringify([candidate]), verdict: firstVerdict },
      { candidate: JSON.stringify([drifted]), verdict: secondVerdict },
    ]);
    const reviewCalls = boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    );
    expect(JSON.parse(reviewCalls[1]![1][0].content).items[0].content).toEqual(drifted);
  });
});
