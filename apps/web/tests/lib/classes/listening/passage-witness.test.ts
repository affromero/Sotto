import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildListeningSourceUnits,
  listeningPassageExtractionResponseSchema,
  listeningPassageWitnessResponseSchema,
  listeningPassageWitnessFailure,
  listeningPassageWitnessRepairFindings,
  parseListeningPassageExtraction,
  parseListeningPassageExtractionResponse,
  parseListeningPassageWitness,
  parseListeningPassageWitnessResponse,
  supportedMeaningDifferenceRule,
} from '@/lib/classes/quality/listening-audit/passage-witness';

function fixture(
  turns = [
    { turnIndex: 1, speaker: 'HOST', text: 'If I want to visit Lea, I say: “I have visited Lea.”' },
    { turnIndex: 2, speaker: 'EXPERT', text: 'That describes a completed visit.' },
    { turnIndex: 3, speaker: 'HOST', text: 'All right.' },
  ]
) {
  const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
  const table = buildListeningSourceUnits(fields, turns, 'en');
  const pair = {
    premiseUnitIndex: 0,
    exampleUnitIndex: 0,
    premiseMeaning: 'The speaker intends to visit Lea.',
    exampleMeaning: 'The speaker has already visited Lea.',
    relation: 'claimed_equivalence' as const,
  };
  const extractionWire = {
    unitAccounts: Object.fromEntries(
      table.units.map((unit) => [String(unit.unitIndex), unit.text.trim()])
    ),
    pairs: [pair],
  };
  const extraction = parseListeningPassageExtractionResponse(extractionWire, fields, turns, 'en');
  const assessment = {
    premiseMeaning: pair.premiseMeaning,
    exampleMeaning: pair.exampleMeaning,
    relation: pair.relation,
    checks: {
      actor: 'aligned' as const,
      event: 'aligned' as const,
      time: 'different' as const,
      modality: 'different' as const,
      negation: 'aligned' as const,
    },
    status: 'contradicted' as const,
    reason: 'Wanting to visit does not establish a completed visit.',
    remedy: { kind: 'correction' as const, text: 'I want to visit Lea.' },
  };
  const judgeWire = {
    pairDecisions: [{ pairIndex: 0, decision: 'compared' as const, ...assessment }],
    additionalPairs: [],
  };
  const parse = (value: unknown = judgeWire) =>
    parseListeningPassageWitnessResponse(value, fields, turns, extraction, 'en');
  return { turns, fields, table, pair, extractionWire, extraction, assessment, judgeWire, parse };
}

function grammaticalFormFixture() {
  const source = fixture([
    {
      turnIndex: 1,
      speaker: 'HOST',
      text: 'The past sentence “Lea wanted to visit Bonn” uses visit as an infinitive.',
    },
    {
      turnIndex: 2,
      speaker: 'EXPERT',
      text: 'The present sentence “I want to buy bread” also uses an infinitive.',
    },
  ]);
  const pair = {
    premiseUnitIndex: 0,
    exampleUnitIndex: 1,
    premiseMeaning: 'Lea wanted to visit Bonn; visit is an infinitive.',
    exampleMeaning: 'I want to buy bread; buy is an infinitive.',
    relation: 'grammatical_form' as const,
  };
  const extraction = parseListeningPassageExtractionResponse(
    { ...source.extractionWire, pairs: [pair] },
    source.fields,
    source.turns,
    'en'
  );
  const assessment = {
    pairIndex: 0,
    decision: 'compared' as const,
    premiseMeaning: pair.premiseMeaning,
    exampleMeaning: pair.exampleMeaning,
    relation: pair.relation,
    checks: {
      actor: 'different',
      event: 'different',
      time: 'different',
      modality: 'aligned',
      negation: 'aligned',
    },
    status: 'supported',
    reason: 'Visit and buy are both infinitives after to despite the different events.',
    remedy: null,
  };
  const parse = (value: unknown = assessment) =>
    parseListeningPassageWitnessResponse(
      { pairDecisions: [value], additionalPairs: [] },
      source.fields,
      source.turns,
      extraction,
      'en'
    );
  return { ...source, extraction, assessment, parse };
}

function denseTeachingFixture(splitExpert: boolean) {
  const expertSentences = [
    'Ja.',
    'Du benutzt „bin gefahren“ für die Fahrt.',
    'Bei „besucht“ und „gekocht“ benutzt du „haben“.',
    'Wenn du von einem Erlebnis erzählst, kannst du zuerst die Zeit nennen: „Am Samstag bin ich nach Hamburg gefahren.“',
    'Dann erzählst du, was du dort gemacht hast.',
  ];
  const turns = [
    {
      turnIndex: 1,
      speaker: 'HOST',
      text: 'Dann übe ich noch ein Beispiel: „Letzten Monat bin ich nach Hamburg gefahren. Ich habe meine Tante besucht. Wir haben zusammen gekocht.“ Sind das gute Sätze?',
    },
    ...(splitExpert ? expertSentences : [expertSentences.join(' ')]).map((text, position) => ({
      turnIndex: position + 2,
      speaker: 'EXPERT',
      text,
    })),
  ];
  const fields = {
    passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n'),
  };
  const table = buildListeningSourceUnits(fields, turns, 'de');
  const pairInputs = [
    [4, 0, 'The expert confirms the first sentence is good.', 'The host went to Hamburg.'],
    [4, 1, 'The expert confirms the second sentence is good.', 'The host visited their aunt.'],
    [4, 2, 'The expert confirms the third sentence is good.', 'The host cooked with their aunt.'],
    [5, 0, 'Use “bin gefahren” for the journey.', 'The host went to Hamburg.'],
    [6, 1, 'Use “haben” with “besucht”.', 'The host visited their aunt.'],
    [6, 2, 'Use “haben” with “gekocht”.', 'The host cooked with their aunt.'],
    [7, 7, 'The time can come first in an experience.', '“Am Samstag” comes first.'],
  ] as const;
  const pairs = pairInputs.map(
    ([premiseUnitIndex, exampleUnitIndex, premiseMeaning, exampleMeaning]) => ({
      premiseUnitIndex,
      exampleUnitIndex,
      premiseMeaning,
      exampleMeaning,
      relation: 'grammatical_form' as const,
    })
  );
  return {
    turns,
    fields,
    wire: {
      unitAccounts: Object.fromEntries(
        table.units.map((unit) => [String(unit.unitIndex), unit.text.trim()])
      ),
      pairs,
    },
  };
}

describe('source-bound two-stage listening evidence', () => {
  it('retains full literal accounts and independently assessed meanings for the same source unit', () => {
    const source = fixture();
    const witness = source.parse();
    expect(source.extraction.unitAccounts).toEqual(
      source.table.units.map((unit) => source.extractionWire.unitAccounts[String(unit.unitIndex)])
    );
    expect(source.extraction.pairs[0]).toMatchObject({
      pairIndex: 0,
      premiseTurnIndex: 1,
      exampleTurnIndex: 1,
    });
    expect(witness.proposedPairs).toEqual(source.extraction.pairs);
    expect(witness.pairDecisions[0]).toMatchObject({
      premiseMeaning: source.pair.premiseMeaning,
      exampleMeaning: source.pair.exampleMeaning,
      premiseUnitIndex: 0,
      exampleUnitIndex: 0,
      comparisonIndex: 0,
      sourcePartIndices: source.extraction.pairs[0].sourcePartIndices,
    });
    expect(witness).not.toHaveProperty('unitAccounts');
    expect(witness).not.toHaveProperty('turnLedger');
    expect(witness).not.toHaveProperty('comparisons');
    expect(
      parseListeningPassageWitness(witness, source.fields, source.turns, source.extraction)
    ).toEqual(witness);
  });

  it('lets the independent judge correct a proposed interpretation without rewriting its source binding', () => {
    const source = fixture();
    const wire = structuredClone(source.judgeWire);
    wire.pairDecisions[0].premiseMeaning = 'The speaker expresses a wish for a future visit.';
    const witness = source.parse(wire);
    expect(witness.pairDecisions[0]).toMatchObject({
      premiseMeaning: wire.pairDecisions[0].premiseMeaning,
      premiseUnitIndex: 0,
    });
    expect(witness.proposedPairs[0].premiseMeaning).toBe(source.pair.premiseMeaning);
  });

  it.each(['missing', 'extra', 'empty', 'too long'] as const)(
    'rejects %s literal source coverage',
    (change) => {
      const source = fixture();
      const wire = structuredClone(source.extractionWire);
      if (change === 'missing') delete wire.unitAccounts['0'];
      if (change === 'extra')
        wire.unitAccounts[String(source.table.units.length)] = 'Extra account.';
      if (change === 'empty') wire.unitAccounts[0] = ' ';
      if (change === 'too long')
        wire.unitAccounts[2] = 'x'.repeat(source.table.units[2].meaningMaxChars + 1);
      expect(() =>
        parseListeningPassageExtractionResponse(wire, source.fields, source.turns, 'en')
      ).toThrow();
    }
  );

  it.each(['pairIndex', 'premiseTurnIndex', 'sourcePartIndices', 'status'] as const)(
    'rejects authored %s metadata or verdicts in extraction',
    (key) => {
      const source = fixture();
      Object.assign(source.extractionWire.pairs[0], {
        [key]: key === 'sourcePartIndices' ? [0] : 0,
      });
      expect(() =>
        parseListeningPassageExtractionResponse(
          source.extractionWire,
          source.fields,
          source.turns,
          'en'
        )
      ).toThrow();
    }
  );

  it('binds indexed accounts to their original units regardless of declaration order', () => {
    const source = fixture();
    const wire = {
      ...source.extractionWire,
      unitAccounts: Object.fromEntries(
        Object.entries(source.extractionWire.unitAccounts).reverse()
      ),
    };
    expect(
      parseListeningPassageExtractionResponse(wire, source.fields, source.turns, 'en')
    ).toEqual(source.extraction);
    expect(() =>
      parseListeningPassageExtractionResponse(
        { ...wire, unitAccounts: source.extraction.unitAccounts },
        source.fields,
        source.turns,
        'en'
      )
    ).toThrow();
    expect(parseListeningPassageExtraction(source.extraction, source.fields, source.turns)).toEqual(
      source.extraction
    );
  });

  it('enforces each indexed account limit in both the provider schema and canonical parser', () => {
    const turns = Array.from({ length: 89 }, (_, unitIndex) => ({
      turnIndex: unitIndex + 1,
      speaker: unitIndex % 2 ? 'EXPERT' : 'HOST',
      text:
        unitIndex === 88
          ? 'Goodbye.'
          : `On day ${unitIndex + 1}, we walked through the old town and visited the museum before returning home.`,
    }));
    const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
    const table = buildListeningSourceUnits(fields, turns, 'en');
    const schema = listeningPassageExtractionResponseSchema(fields, turns, 'en');
    const nativeSchema = z.fromJSONSchema(z.toJSONSchema(schema));
    const last = table.units.at(-1)!;
    expect(last.unitIndex).toBe(88);
    expect(last.meaningMaxChars).toBe(120);
    expect(table.units[0].meaningMaxChars).toBeGreaterThan(last.meaningMaxChars);
    const valid = {
      unitAccounts: Object.fromEntries(
        table.units.map((unit) => [
          String(unit.unitIndex),
          unit.unitIndex === last.unitIndex
            ? 'x'.repeat(last.meaningMaxChars)
            : `Complete account for day ${unit.unitIndex + 1}.`,
        ])
      ),
      pairs: [],
    };
    expect(nativeSchema.safeParse(valid).success).toBe(true);
    expect(
      parseListeningPassageExtractionResponse(valid, fields, turns, 'en').unitAccounts.at(-1)
    ).toBe(valid.unitAccounts[String(last.unitIndex)]);
    for (const length of [121, 163, 255]) {
      const oversized = structuredClone(valid);
      oversized.unitAccounts[String(last.unitIndex)] = 'x'.repeat(length);
      expect(nativeSchema.safeParse(oversized).success).toBe(false);
      expect(() =>
        parseListeningPassageExtractionResponse(oversized, fields, turns, 'en')
      ).toThrow();
    }
    for (const change of ['missing', 'unknown'] as const) {
      const incomplete = structuredClone(valid);
      if (change === 'missing') delete incomplete.unitAccounts[String(last.unitIndex)];
      else incomplete.unitAccounts['89'] = 'An unbound account.';
      expect(nativeSchema.safeParse(incomplete).success).toBe(false);
      expect(() =>
        parseListeningPassageExtractionResponse(incomplete, fields, turns, 'en')
      ).toThrow();
    }
  });

  it('rejects foreign units and preserves the aggregate relation budget', () => {
    const source = fixture();
    expect(() =>
      parseListeningPassageExtractionResponse(
        { ...source.extractionWire, pairs: [{ ...source.pair, exampleUnitIndex: 999 }] },
        source.fields,
        source.turns,
        'en'
      )
    ).toThrow();
    expect(() =>
      parseListeningPassageExtractionResponse(
        { ...source.extractionWire, pairs: Array.from({ length: 19 }, () => ({ ...source.pair })) },
        source.fields,
        source.turns,
        'en'
      )
    ).toThrow();
    expect(() =>
      source.parse({
        ...source.judgeWire,
        additionalPairs: Array.from({ length: 18 }, () => ({
          premiseUnitIndex: 0,
          exampleUnitIndex: 0,
          ...source.assessment,
        })),
      })
    ).toThrow();
  });

  it('retains seven distinct teaching relations whether the explanation is one turn or several', () => {
    const extractions = [false, true].map((splitExpert) => {
      const source = denseTeachingFixture(splitExpert);
      const extraction = parseListeningPassageExtractionResponse(
        source.wire,
        source.fields,
        source.turns,
        'de'
      );
      expect(extraction.pairs).toHaveLength(7);
      const assessments = source.wire.pairs.map((pair) => ({
        premiseMeaning: pair.premiseMeaning,
        exampleMeaning: pair.exampleMeaning,
        relation: pair.relation,
        checks: {
          actor: 'not_applicable',
          event: 'not_applicable',
          time: 'not_applicable',
          modality: 'not_applicable',
          negation: 'not_applicable',
        },
        status: 'supported',
        reason: 'The cited example illustrates the stated grammatical form.',
        remedy: null,
      }));
      const witness = parseListeningPassageWitnessResponse(
        {
          pairDecisions: assessments.map((assessment, pairIndex) => ({
            pairIndex,
            decision: 'compared',
            ...assessment,
          })),
          additionalPairs: [],
        },
        source.fields,
        source.turns,
        extraction,
        'de'
      );
      expect(witness.proposedPairs).toEqual(extraction.pairs);
      expect(witness.pairDecisions).toHaveLength(7);
      const emptyExtraction = parseListeningPassageExtractionResponse(
        { ...source.wire, pairs: [] },
        source.fields,
        source.turns,
        'de'
      );
      const discovered = parseListeningPassageWitnessResponse(
        {
          pairDecisions: [],
          additionalPairs: source.wire.pairs.map((pair, pairIndex) => ({
            ...pair,
            ...assessments[pairIndex],
          })),
        },
        source.fields,
        source.turns,
        emptyExtraction,
        'de'
      );
      expect(discovered.additionalPairs).toHaveLength(7);
      return extraction;
    });
    expect(new Set(extractions[0].pairs.map((pair) => pair.premiseTurnIndex))).toEqual(
      new Set([2])
    );
    expect(extractions[1].pairs.map((pair) => pair.premiseMeaning)).toEqual(
      extractions[0].pairs.map((pair) => pair.premiseMeaning)
    );
  });

  it.each(['missing', 'duplicate', 'foreign', 'rewritten unit', 'derived index'] as const)(
    'rejects %s judge pair coverage',
    (change) => {
      const source = fixture();
      const wire = structuredClone(source.judgeWire);
      if (change === 'missing') wire.pairDecisions = [];
      if (change === 'duplicate') wire.pairDecisions.push(structuredClone(wire.pairDecisions[0]));
      if (change === 'foreign') wire.pairDecisions[0].pairIndex = 9;
      if (change === 'rewritten unit')
        Object.assign(wire.pairDecisions[0], { premiseUnitIndex: 1 });
      if (change === 'derived index') Object.assign(wire.pairDecisions[0], { comparisonIndex: 0 });
      expect(() => source.parse(wire)).toThrow();
    }
  );

  it.each(['contradicted', 'uncertain'] as const)(
    'directly rejects %s semantic evidence and derives a concrete source-bound repair',
    (status) => {
      const source = fixture();
      const witness = source.parse();
      const decision = witness.pairDecisions[0];
      if (decision.decision !== 'compared') throw new Error('Expected compared fixture.');
      decision.status = status;
      if (status === 'uncertain') decision.checks.modality = 'uncertain';
      const parsed = parseListeningPassageWitness(
        witness,
        source.fields,
        source.turns,
        source.extraction
      );
      expect(listeningPassageWitnessFailure(parsed)).toEqual({
        issue: status === 'contradicted' ? 'incorrect' : 'uncertain',
        feedback: expect.stringContaining(source.assessment.reason),
      });
      expect(listeningPassageWitnessFailure(parsed)!.feedback.length).toBeLessThanOrEqual(300);
      expect(listeningPassageWitnessRepairFindings(parsed, source.fields, source.turns)).toEqual([
        expect.objectContaining({
          fieldPath: ['passageText'],
          quote: expect.stringContaining('visit Lea'),
          correction: 'I want to visit Lea.',
        }),
      ]);
    }
  );

  it('retains every negative repair beyond ordinary finding limits', () => {
    const source = fixture();
    const additionalPairs = [...Array(4).keys()].map((position) => ({
      premiseUnitIndex: 1,
      exampleUnitIndex: 0,
      ...source.assessment,
      reason: `Negative source comparison ${position}.`,
    }));
    const witness = source.parse({ ...source.judgeWire, additionalPairs });
    const repairs = listeningPassageWitnessRepairFindings(witness, source.fields, source.turns);
    expect(repairs).toHaveLength(5);
    expect(repairs.map((finding) => finding.defect)).toEqual([
      source.assessment.reason,
      ...additionalPairs.map((pair) => pair.reason),
    ]);
    expect(listeningPassageWitnessFailure(witness)?.feedback).toContain('5 negative comparisons');
  });

  it('retains replacement relations for dismissed bad source bindings and rejects dangling replacement links', () => {
    const source = fixture();
    const extraction = parseListeningPassageExtractionResponse(
      {
        ...source.extractionWire,
        pairs: [
          {
            ...source.pair,
            premiseUnitIndex: 1,
            exampleUnitIndex: 1,
            premiseMeaning: 'The expert states that a visit has been completed.',
            exampleMeaning: 'The expert states that a visit has been completed.',
          },
        ],
      },
      source.fields,
      source.turns,
      'en'
    );
    const parse = (wire: unknown) =>
      parseListeningPassageWitnessResponse(wire, source.fields, source.turns, extraction, 'en');
    const value = {
      pairDecisions: [
        {
          pairIndex: 0,
          decision: 'not_a_teaching_relation',
          reason: 'The relationship belongs to another source unit.',
          replacementPairIndices: [0],
        },
      ],
      additionalPairs: [{ premiseUnitIndex: 0, exampleUnitIndex: 0, ...source.assessment }],
    };
    const witness = parse(value);
    expect(witness.additionalPairs[0].comparisonIndex).toBe(0);
    expect(
      listeningPassageWitnessRepairFindings(witness, source.fields, source.turns)
    ).toHaveLength(1);
    value.pairDecisions[0].replacementPairIndices = [1];
    expect(() => parse(value)).toThrow();
    value.pairDecisions[0].replacementPairIndices = [0, 0];
    expect(() => parse(value)).toThrow();
  });

  it('preserves legitimately absent teaching relations without inventing approval evidence', () => {
    const source = fixture([
      { turnIndex: 1, speaker: 'HOST', text: 'Lea visited Bonn yesterday.' },
      { turnIndex: 2, speaker: 'EXPERT', text: 'I stayed at home yesterday.' },
      { turnIndex: 3, speaker: 'HOST', text: 'We met this morning.' },
    ]);
    const witness = source.parse({
      pairDecisions: [
        {
          pairIndex: 0,
          decision: 'not_a_teaching_relation',
          reason: 'These are separate narrative events, with no teaching equivalence.',
          replacementPairIndices: [],
        },
      ],
      additionalPairs: [],
    });
    expect(listeningPassageWitnessFailure(witness)).toBeUndefined();
    expect(listeningPassageWitnessRepairFindings(witness, source.fields, source.turns)).toEqual([]);
  });

  it.each(['actor', 'event', 'time', 'modality', 'negation'] as const)(
    'rejects supported equivalence with unresolved %s',
    (dimension) => {
      const source = fixture();
      const witness = source.parse();
      const decision = witness.pairDecisions[0];
      if (decision.decision !== 'compared') throw new Error('Expected compared fixture.');
      decision.status = 'supported';
      decision.remedy = null;
      for (const key of ['actor', 'event', 'time', 'modality', 'negation'] as const)
        decision.checks[key] = 'aligned';
      for (const status of ['different', 'uncertain'] as const) {
        decision.checks[dimension] = status;
        expect(() => parseListeningPassageWitness(witness, source.fields, source.turns)).toThrow();
      }
    }
  );

  it.each([
    ['Mira found her ticket in her jacket.', 'I once searched for a key I held in my hand.'],
    ['I have walked to the park.', 'I have seen a dog and taken a photo.'],
    ['I have watched a film and made popcorn.', 'I have made and eaten the popcorn.'],
  ])('retains separate narrative events without inventing semantic equivalence', (first, next) => {
    const source = fixture([
      { turnIndex: 1, speaker: 'HOST', text: first },
      { turnIndex: 2, speaker: 'EXPERT', text: next },
    ]);
    const extraction = parseListeningPassageExtractionResponse(
      {
        ...source.extractionWire,
        pairs: [
          {
            ...source.pair,
            premiseUnitIndex: 0,
            exampleUnitIndex: 1,
            premiseMeaning: first,
            exampleMeaning: next,
            relation: 'meaning_expression',
          },
        ],
      },
      source.fields,
      source.turns,
      'en'
    );
    const witness = parseListeningPassageWitnessResponse(
      {
        pairDecisions: [
          {
            pairIndex: 0,
            decision: 'not_a_teaching_relation',
            reason:
              'These are an analogy or additional events, not wording offered as the same meaning.',
            replacementPairIndices: [],
          },
        ],
        additionalPairs: [],
      },
      source.fields,
      source.turns,
      extraction,
      'en'
    );
    expect(witness.proposedPairs).toEqual(extraction.pairs);
    expect(listeningPassageWitnessFailure(witness)).toBeUndefined();
    expect(listeningPassageWitnessRepairFindings(witness, source.fields, source.turns)).toEqual([]);
  });

  it('rejects the same different events when wording explicitly claims to express the stated situation', () => {
    const source = fixture([
      {
        turnIndex: 1,
        speaker: 'HOST',
        text: 'To express that Mira found her ticket, say: “I have held my key.”',
      },
    ]);
    const pair = {
      ...source.pair,
      relation: 'meaning_expression',
      premiseMeaning: 'Mira found her ticket.',
      exampleMeaning: 'The speaker has held a key.',
    };
    const extraction = parseListeningPassageExtractionResponse(
      { ...source.extractionWire, pairs: [pair] },
      source.fields,
      source.turns,
      'en'
    );
    const assessment = {
      ...source.assessment,
      ...pair,
      checks: {
        actor: 'different',
        event: 'different',
        time: 'aligned',
        modality: 'aligned',
        negation: 'aligned',
      },
      reason: 'Finding a ticket is not holding a key.',
      remedy: { kind: 'correction', text: 'Mira found her ticket.' },
    };
    const parse = (status: 'supported' | 'contradicted') =>
      parseListeningPassageWitnessResponse(
        {
          pairDecisions: [
            {
              pairIndex: 0,
              decision: 'compared',
              premiseMeaning: assessment.premiseMeaning,
              exampleMeaning: assessment.exampleMeaning,
              relation: assessment.relation,
              checks: assessment.checks,
              reason: assessment.reason,
              status,
              remedy: status === 'supported' ? null : assessment.remedy,
            },
          ],
          additionalPairs: [],
        },
        source.fields,
        source.turns,
        extraction,
        'en'
      );
    expect(() => parse('supported')).toThrow(supportedMeaningDifferenceRule);
    expect(listeningPassageWitnessFailure(parse('contradicted'))?.issue).toBe('incorrect');
  });

  it('rebinds grammatical endorsement instead of treating practice events as equivalent', () => {
    const source = fixture([
      { turnIndex: 1, speaker: 'HOST', text: 'I have walked to the park.' },
      {
        turnIndex: 2,
        speaker: 'HOST',
        text: 'I have seen a dog and taken a photo.',
      },
      {
        turnIndex: 3,
        speaker: 'EXPERT',
        text: 'Both sentences correctly use the present perfect.',
      },
    ]);
    const extraction = parseListeningPassageExtractionResponse(
      {
        ...source.extractionWire,
        pairs: [
          {
            ...source.pair,
            premiseUnitIndex: 0,
            exampleUnitIndex: 1,
            premiseMeaning: source.turns[0].text,
            exampleMeaning: source.turns[1].text,
            relation: 'meaning_expression',
          },
        ],
      },
      source.fields,
      source.turns,
      'en'
    );
    const witness = parseListeningPassageWitnessResponse(
      {
        pairDecisions: [
          {
            pairIndex: 0,
            decision: 'not_a_teaching_relation',
            reason: 'The two narrative events are not offered as equivalent meanings.',
            replacementPairIndices: [0, 1],
          },
        ],
        additionalPairs: [0, 1].map((exampleUnitIndex) => ({
          premiseUnitIndex: 2,
          exampleUnitIndex,
          premiseMeaning: 'The expert endorses the present-perfect form.',
          exampleMeaning: source.turns[exampleUnitIndex].text,
          relation: 'grammatical_form',
          checks: {
            actor: 'not_applicable',
            event: 'different',
            time: 'not_applicable',
            modality: 'not_applicable',
            negation: 'not_applicable',
          },
          status: 'supported',
          reason: 'The cited sentence correctly uses the present perfect.',
          remedy: null,
        })),
      },
      source.fields,
      source.turns,
      extraction,
      'en'
    );
    expect(witness.additionalPairs).toHaveLength(2);
    expect(listeningPassageWitnessFailure(witness)).toBeUndefined();
  });

  it('supports the stated grammatical property while preserving different cited events', () => {
    const source = grammaticalFormFixture();
    const witness = source.parse();
    expect(witness.pairDecisions[0]).toMatchObject({
      relation: 'grammatical_form',
      premiseMeaning: source.assessment.premiseMeaning,
      exampleMeaning: source.assessment.exampleMeaning,
      premiseTurnIndex: 1,
      exampleTurnIndex: 2,
      checks: { actor: 'different', event: 'different', time: 'different' },
      status: 'supported',
    });
    expect(listeningPassageWitnessFailure(witness)).toBeUndefined();
    expect(listeningPassageWitnessRepairFindings(witness, source.fields, source.turns)).toEqual([]);
  });

  it.each(['meaning_expression', 'claimed_equivalence'] as const)(
    'still rejects a supported %s between an intention and a completed event',
    (relation) => {
      const source = fixture();
      expect(() =>
        source.parse({
          pairDecisions: [
            {
              ...source.judgeWire.pairDecisions[0],
              relation,
              status: 'supported',
              remedy: null,
            },
          ],
          additionalPairs: [],
        })
      ).toThrow(supportedMeaningDifferenceRule);
    }
  );

  it('cannot authorize a grammatical-form approval with an unresolved comparison', () => {
    const source = grammaticalFormFixture();
    expect(() =>
      source.parse({
        ...source.assessment,
        checks: { ...source.assessment.checks, event: 'uncertain' },
      })
    ).toThrow();
  });

  it('retains every false grammatical claim and its concrete source-bound correction', () => {
    const source = fixture([
      { turnIndex: 1, speaker: 'HOST', text: 'The past participle of go is goed.' },
      { turnIndex: 2, speaker: 'EXPERT', text: 'The past participle of see is seed.' },
    ]);
    const claims = [
      { verb: 'go', form: 'goed', correction: 'gone' },
      { verb: 'see', form: 'seed', correction: 'seen' },
    ];
    const pairs = claims.map(({ verb, form }, unitIndex) => ({
      premiseUnitIndex: unitIndex,
      exampleUnitIndex: unitIndex,
      premiseMeaning: `The past participle of ${verb} is claimed to be ${form}.`,
      exampleMeaning: `The cited form is ${form}.`,
      relation: 'grammatical_form',
    }));
    const extraction = parseListeningPassageExtractionResponse(
      { ...source.extractionWire, pairs },
      source.fields,
      source.turns,
      'en'
    );
    const pairDecisions = claims.map(({ verb, correction }, pairIndex) => ({
      pairIndex,
      decision: 'compared',
      premiseMeaning: pairs[pairIndex].premiseMeaning,
      exampleMeaning: pairs[pairIndex].exampleMeaning,
      relation: 'grammatical_form',
      checks: {
        actor: 'not_applicable',
        event: 'not_applicable',
        time: 'not_applicable',
        modality: 'not_applicable',
        negation: 'not_applicable',
      },
      status: 'contradicted',
      reason: `The irregular past participle of ${verb} is ${correction}.`,
      remedy: { kind: 'correction', text: `The past participle of ${verb} is ${correction}.` },
    }));
    const parse = (value: unknown) =>
      parseListeningPassageWitnessResponse(value, source.fields, source.turns, extraction, 'en');
    const witness = parse({ pairDecisions, additionalPairs: [] });
    expect(listeningPassageWitnessFailure(witness)).toMatchObject({
      issue: 'incorrect',
      feedback: expect.stringContaining('2 negative comparisons'),
    });
    expect(listeningPassageWitnessRepairFindings(witness, source.fields, source.turns)).toEqual(
      pairDecisions.map(({ reason, remedy }, unitIndex) =>
        expect.objectContaining({
          quote: expect.stringContaining(source.turns[unitIndex].text),
          defect: reason,
          correction: remedy.text,
        })
      )
    );
    expect(() =>
      parse({
        pairDecisions: [{ ...pairDecisions[0], remedy: null }, pairDecisions[1]],
        additionalPairs: [],
      })
    ).toThrow();
  });

  it('allows explicit transformation and corrected errors while retaining unresolved negatives', () => {
    for (const relation of ['explicit_repair', 'explicit_transformation'] as const) {
      const source = fixture([
        {
          turnIndex: 1,
          speaker: 'HOST',
          text:
            relation === 'explicit_repair'
              ? 'The incorrect form is “I has visited Lea”.'
              : 'Change “I visit Lea” to the present perfect.',
        },
        {
          turnIndex: 2,
          speaker: 'EXPERT',
          text:
            relation === 'explicit_repair'
              ? 'The correct form is “I have visited Lea”.'
              : 'The present perfect is “I have visited Lea”.',
        },
      ]);
      const proposed = {
        ...source.pair,
        exampleUnitIndex: 1,
        relation,
        premiseMeaning:
          relation === 'explicit_repair'
            ? 'The first-person present perfect has an incorrect auxiliary.'
            : 'Transform the present-tense visit into the present perfect.',
        exampleMeaning: 'The first-person completed visit uses have visited.',
      };
      const extraction = parseListeningPassageExtractionResponse(
        { ...source.extractionWire, pairs: [proposed] },
        source.fields,
        source.turns,
        'en'
      );
      const witness = parseListeningPassageWitnessResponse(
        {
          pairDecisions: [
            {
              ...source.judgeWire.pairDecisions[0],
              premiseMeaning: proposed.premiseMeaning,
              exampleMeaning: proposed.exampleMeaning,
              relation,
              checks: {
                actor: 'aligned',
                event: 'aligned',
                time: relation === 'explicit_transformation' ? 'different' : 'aligned',
                modality: 'aligned',
                negation: 'aligned',
              },
              status: relation === 'explicit_repair' ? 'explicitly_repaired' : 'supported',
              reason: 'The requested grammatical change is explicitly supplied.',
              remedy: null,
            },
          ],
          additionalPairs: [],
        },
        source.fields,
        source.turns,
        extraction,
        'en'
      );
      expect(listeningPassageWitnessFailure(witness)).toBeUndefined();
      const decision = witness.pairDecisions[0];
      if (decision.decision !== 'compared') throw new Error('Expected compared fixture.');
      decision.checks.time = 'uncertain';
      expect(() => parseListeningPassageWitness(witness, source.fields, source.turns)).toThrow();
    }
  });

  it('rejects negative evidence without a remedy and retained evidence with changed sources', () => {
    const source = fixture();
    const witness = source.parse();
    const decision = witness.pairDecisions[0];
    if (decision.decision !== 'compared') throw new Error('Expected compared fixture.');
    decision.remedy = null;
    expect(() => parseListeningPassageWitness(witness, source.fields, source.turns)).toThrow();
    expect(() =>
      parseListeningPassageExtraction(
        source.extraction,
        { passageText: source.fields.passageText + ' Changed.' },
        source.turns
      )
    ).toThrow();
    expect(() =>
      parseListeningPassageWitnessResponse(
        source.judgeWire,
        source.fields,
        source.turns,
        source.extraction,
        'de'
      )
    ).toThrow();
  });

  it('binds every overlapping source part instead of clipping long source comparisons', () => {
    const turns = [{ turnIndex: 1, speaker: 'HOST', text: 'A'.repeat(1800) + '.' }];
    const fields = { passageText: `HOST: ${turns[0].text}` };
    const table = buildListeningSourceUnits(fields, turns, 'en');
    const extraction = parseListeningPassageExtractionResponse(
      {
        unitAccounts: { '0': 'A long complete source account.' },
        pairs: [{ ...fixture().pair, premiseUnitIndex: 0, exampleUnitIndex: 0 }],
      },
      fields,
      turns,
      'en'
    );
    expect(extraction.pairs[0].sourcePartIndices).toEqual(table.units[0].sourcePartIndices);
    expect(extraction.pairs[0].sourcePartIndices.length).toBeGreaterThan(3);
    const changed = structuredClone(extraction);
    changed.pairs[0].sourcePartIndices.pop();
    expect(() => parseListeningPassageExtraction(changed, fields, turns)).toThrow();
  });

  it('keeps provider schemas wire-only and compatible with strict structured output', () => {
    const source = fixture();
    for (const schema of [
      listeningPassageExtractionResponseSchema(source.fields, source.turns, 'en'),
      listeningPassageWitnessResponseSchema(source.fields, source.turns, source.extraction, 'en'),
    ]) {
      const encoded = JSON.stringify(z.toJSONSchema(schema));
      expect(encoded).not.toContain('"comparisonIndex"');
      expect(encoded).not.toContain('"sourcePartIndices"');
      expect(encoded).not.toContain('"oneOf"');
      expect(encoded).not.toContain('"turnLedger"');
    }
  });
});
