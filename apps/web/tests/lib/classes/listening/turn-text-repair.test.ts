import { beforeEach, describe, expect, it, vi } from 'vitest';
import originalWire from './turn-text-repair-fixture.json';
import { generateScript, parseScriptResponse } from '@/lib/script-generator';
import { normalizeListeningTurns } from '@/lib/classes/quality/listening-audit/projection';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';
import { listeningSourcePartTurnIndices } from '@/lib/classes/quality/listening-audit/source-units';
import {
  listeningPassageWitnessRepairTurnIndices,
  parseListeningPassageExtractionResponse,
  parseListeningPassageWitnessResponse,
} from '@/lib/classes/quality/listening-audit/passage-witness';
import {
  assertTeachingScriptRepairPreserved,
  teachingScriptRepairContract,
} from '@/lib/learning/script/teaching-repair';

const provider = vi.hoisted(() => ({ generateResponse: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({ createAIProvider: () => provider }));

function fixture() {
  const { turns, soundCues, references, vocabulary, places } = parseScriptResponse({
    content: JSON.stringify(originalWire),
    model: 'captured-model',
    inputTokens: 1,
    outputTokens: 1,
  });
  const candidate = { turns, soundCues, references, vocabulary, places };
  const normalized = normalizeListeningTurns(turns);
  const fields = {
    passageText: normalized.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n'),
  };
  const needles = ['Meine Freundin hat eine die Reise', 'Dann steht „bin“ vo', 'Dann bin ich nac'];
  const quotes = needles.map((needle) => {
    const part = buildTeachingSourceParts(fields).find((part) => part.quote.includes(needle));
    if (!part) throw new Error('Retained defect anchor is missing from the original candidate.');
    return part.quote;
  });
  const scope = {
    turnIndices: listeningSourcePartTurnIndices(fields, normalized, quotes),
    turns: normalized,
  };
  const turnTexts = {
    '8': turns[7].text,
    '9': turns[8].text.replace('steht „bin“ vorne', 'steht „bin“ an zweiter Stelle'),
    '17': turns[16].text.replace('eine [V6:die Reise]', '[V6:die Reise]'),
    '20': turns[19].text.replace(
      'Dann bin ich nach Hause gegangen.',
      'Danach habe ich lange mit ihr gesprochen.'
    ),
  };
  const params: Parameters<typeof generateScript>[0] = {
    provider: 'captured-provider',
    model: 'captured-model',
    topic: 'Describe recent experiences and completed activities using the conversational past.',
    depth: 'standard',
    audienceLevel: 'A2',
    focusAreas: [],
    tone: 'casual',
    durationTarget: 4,
    targetLanguage: 'de',
    languageMode: 'full_immersion',
    forLearning: true,
    learningRepair: {
      candidate,
      questions: [],
      verdict: {
        kind: 'teaching',
        findings: [
          {
            index: 0,
            findings: quotes.map((quote) => ({
              issue: 'incorrect',
              fieldPath: ['passageText'],
              quote,
              rule: 'Preserve grammatical and source-supported teaching.',
              defect: 'The anchored explanation or narrative claim needs correction.',
              correction: 'Correct the anchored claim while preserving the surrounding facts.',
              counterexample: null,
            })),
          },
        ],
      },
      turnRepair: scope,
    },
  };
  return { candidate, normalized, fields, scope, turnTexts, params };
}

beforeEach(() => {
  provider.generateResponse.mockReset();
});

describe('indexed listening teaching repair', () => {
  it('repairs the retained localized defects while preserving the original cake speaker and metadata', async () => {
    const source = fixture();
    expect(source.scope.turnIndices).toEqual([8, 9, 17, 20]);
    let capturedSchema: unknown;
    provider.generateResponse.mockImplementation(async (system, messages, options) => {
      expect(system).toContain('turn-text repair schema');
      expect(system).not.toContain('Generate 2-voice dialogue');
      expect(messages[0].content).toContain(source.candidate.turns[20].text);
      expect(options).toMatchObject({ model: 'captured-model', maxTokens: 12288 });
      capturedSchema = options.jsonSchema;
      return { content: JSON.stringify({ turnTexts: source.turnTexts }), model: 'captured-model' };
    });
    const repaired = await generateScript(source.params);
    expect(capturedSchema).toMatchObject({
      name: 'learning_script_turn_repair',
      schema: {
        required: ['turnTexts'],
        additionalProperties: false,
        properties: {
          turnTexts: { required: ['8', '9', '17', '20'], additionalProperties: false },
        },
      },
    });
    expect(repaired.turns).toHaveLength(21);
    for (const [index, turn] of source.candidate.turns.entries()) {
      if (!source.scope.turnIndices.includes(index + 1))
        expect(repaired.turns[index]).toEqual(turn);
      expect(repaired.turns[index].speaker).toBe(turn.speaker);
      expect(repaired.turns[index].direction).toBe(turn.direction);
    }
    expect(repaired.turns[20]).toEqual(source.candidate.turns[20]);
    expect(repaired.turns[20].text).toContain('kannst du vom Café erzählen');
    expect(repaired.turns[20].text).not.toContain('Ich habe den Kuchen gegessen');
    expect(repaired.turns[16].text).toContain('Meine Freundin hat [V6:die Reise] geplant.');
    for (const key of ['soundCues', 'references', 'vocabulary', 'places'] as const)
      expect(repaired[key]).toEqual(source.candidate[key]);
    expect(repaired.markdown).toContain(
      '**HOST:** _(excited)_ Nein! Wir haben den ganzen Film gesehen.'
    );
  });

  it.each([
    [
      'a missing permitted turn',
      (source: ReturnType<typeof fixture>) => ({ turnTexts: { '9': source.turnTexts['9'] } }),
    ],
    [
      'an unapproved ending',
      (source: ReturnType<typeof fixture>) => ({
        turnTexts: { ...source.turnTexts, '21': 'Ich habe den Kuchen gegessen.' },
      }),
    ],
    [
      'a changed speaker',
      (source: ReturnType<typeof fixture>) => ({
        turnTexts: { ...source.turnTexts, '9': { speaker: 'EXPERT', text: source.turnTexts['9'] } },
      }),
    ],
    [
      'new vocabulary metadata',
      (source: ReturnType<typeof fixture>) => ({ turnTexts: source.turnTexts, vocabulary: [] }),
    ],
    ['a complete replacement script', (source: ReturnType<typeof fixture>) => source.candidate],
  ])('rejects %s at the patch boundary', async (_, output) => {
    const source = fixture();
    provider.generateResponse.mockResolvedValue({
      content: JSON.stringify(output(source)),
      model: 'captured-model',
    });
    await expect(generateScript(source.params)).rejects.toThrow();
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it('does not recover a malformed patch as a complete generated script', async () => {
    const source = fixture();
    provider.generateResponse.mockResolvedValue({
      content: `Here is the script: ${JSON.stringify({ turnTexts: source.turnTexts })}`,
      model: 'captured-model',
    });
    await expect(generateScript(source.params)).rejects.toBeInstanceOf(SyntaxError);
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it('rejects a scope belonging to another normalized source before provider admission', async () => {
    const source = fixture();
    source.scope.turns[20].text = 'A different ending.';
    await expect(generateScript(source.params)).rejects.toThrow('bound turn indices');
    expect(provider.generateResponse).not.toHaveBeenCalled();
  });

  it('uses the same original snapshot when caller-owned data changes during the provider request', async () => {
    const source = fixture();
    const expected = structuredClone(source.candidate);
    provider.generateResponse.mockImplementation(async () => {
      source.candidate.turns[20].text = 'Ich habe den Kuchen gegessen.';
      source.candidate.vocabulary[0].translation = 'Changed during request';
      return { content: JSON.stringify({ turnTexts: source.turnTexts }), model: 'captured-model' };
    });
    const repaired = await generateScript(source.params);
    expect(repaired.turns[20]).toEqual(expected.turns[20]);
    expect(repaired.vocabulary).toEqual(expected.vocabulary);
  });

  it('retains canonical marker identities and rejects changes to preserved references', () => {
    const source = fixture();
    const changed = parseScriptResponse({
      content: JSON.stringify({
        ...source.candidate,
        turns: source.candidate.turns.map((turn, index) =>
          index === 0 ? { ...turn, text: turn.text.replace('[V5:gestern]', '[V6:gestern]') } : turn
        ),
      }),
      model: 'captured-model',
      inputTokens: 1,
      outputTokens: 1,
    });
    // The parser resolves the uniquely matching word back to its original marker identity.
    expect(changed.turns[0]).toEqual(source.candidate.turns[0]);
    expect(() =>
      assertTeachingScriptRepairPreserved(source.candidate, changed, source.scope)
    ).not.toThrow();
    changed.references[0].url = 'https://changed.example.test/source';
    expect(() =>
      assertTeachingScriptRepairPreserved(source.candidate, changed, source.scope)
    ).toThrow('preserved script content');
  });

  it('requires exact addressed keys in native schema and rejects duplicate or unknown source indices', () => {
    const source = fixture();
    for (const turnIndices of [[], [9, 9], [0], [22]])
      expect(() =>
        teachingScriptRepairContract(source.candidate, { ...source.scope, turnIndices })
      ).toThrow();
  });
});

describe('canonical repair source boundaries', () => {
  it('includes every repeated chunk occurrence and every overlapping spoken turn', () => {
    const turns = normalizeListeningTurns([
      { speaker: 'HOST', text: 'L'.repeat(360) },
      { speaker: 'EXPERT', text: 'L'.repeat(120) },
    ]);
    const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
    expect(listeningSourcePartTurnIndices(fields, turns, ['L'.repeat(120)])).toEqual([1, 2]);
    const crossing = buildTeachingSourceParts(fields).find((part) =>
      part.quote.includes('\nEXPERT:')
    )!;
    expect(listeningSourcePartTurnIndices(fields, turns, [crossing.quote])).toEqual([1, 2]);
    expect(() => listeningSourcePartTurnIndices(fields, turns, ['L'.repeat(119)])).toThrow(
      'canonical passage chunk'
    );
  });

  it('uses both exact negative operands without granting the intermediate narrative turn', () => {
    const turns = normalizeListeningTurns([
      { speaker: 'HOST', text: 'If Lea wants to visit Bonn, she says:' },
      { speaker: 'EXPERT', text: 'A visit may be planned for tomorrow.' },
      { speaker: 'HOST', text: 'I visited Bonn yesterday.' },
    ]);
    const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
    const extraction = parseListeningPassageExtractionResponse(
      {
        unitAccounts: Object.fromEntries(turns.map((turn, index) => [String(index), turn.text])),
        pairs: [
          {
            premiseUnitIndex: 0,
            exampleUnitIndex: 2,
            premiseMeaning: 'Lea intends to visit Bonn.',
            exampleMeaning: 'The speaker already visited Bonn yesterday.',
            relation: 'claimed_equivalence',
          },
        ],
      },
      fields,
      turns,
      'en'
    );
    const witness = parseListeningPassageWitnessResponse(
      {
        pairDecisions: [
          {
            pairIndex: 0,
            decision: 'compared',
            premiseMeaning: 'Lea intends to visit Bonn.',
            exampleMeaning: 'The speaker already visited Bonn yesterday.',
            relation: 'claimed_equivalence',
            checks: {
              actor: 'different',
              event: 'aligned',
              time: 'different',
              modality: 'different',
              negation: 'aligned',
            },
            status: 'contradicted',
            reason: 'An intention does not state that the visit already happened.',
            remedy: { kind: 'correction', text: 'I want to visit Bonn.' },
          },
        ],
        additionalPairs: [],
      },
      fields,
      turns,
      extraction,
      'en'
    );
    expect(listeningPassageWitnessRepairTurnIndices(witness, fields, turns)).toEqual([1, 3]);
  });
});
