import { describe, expect, it } from 'vitest';
import {
  parseTeachingCritic,
  parseTeachingAdjudicator,
  parseTeachingCriticResponse,
  parseTeachingAdjudicatorResponse,
  ReviewerProtocolError,
  reviewerProtocolDiagnostic,
  reviewerProtocolDiagnosticSchema,
  type TeachingCritic,
} from '@/lib/classes/quality/teaching-review-protocol';
import {
  buildTeachingCriticJsonSchema,
  buildTeachingAdjudicatorJsonSchema,
  buildTeachingSourceParts,
} from '@/lib/classes/quality/teaching-source/protocol';
import {
  listeningPassageWitnessRepairFindings,
  supportedMeaningDifferenceRule,
} from '@/lib/classes/quality/listening-audit/passage-witness';
import {
  listeningNarrativeExtractionFixture,
  listeningNarrativeWitnessFixture,
} from './witness-fixture';

function fixture(negative = true) {
  const turns = [
    {
      turnIndex: 1,
      speaker: 'HOST',
      text: negative
        ? 'Wenn ich jemanden besuchen will, sage ich: „Ich habe meine Freundin besucht.“'
        : 'Für einen abgeschlossenen Besuch sage ich: „Ich habe meine Freundin besucht.“',
    },
    { turnIndex: 2, speaker: 'EXPERT', text: '„Besucht“ ist das Partizip II.' },
  ];
  const fields = [
    { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') },
    {
      question: 'Welches Partizip wird genannt?',
      options: ['besucht', 'gegangen'],
      correctIndex: 0,
      explanation: 'Genannt wird besucht.',
    },
  ];
  const pair = {
    premiseUnitIndex: 0,
    exampleUnitIndex: 0,
    premiseMeaning: negative
      ? 'The speaker wants to visit someone.'
      : 'Describe a completed visit.',
    exampleMeaning: 'The speaker reports having visited their friend.',
    relation: 'claimed_equivalence' as const,
  };
  const extraction = {
    unitAccounts: {
      '0': negative
        ? 'If I want to visit someone, I say: I have visited my friend.'
        : 'For a completed visit, I say: I have visited my friend.',
      '1': 'Besucht is the past participle.',
    },
    pairs: [pair],
  };
  const compared = {
    pairIndex: 0,
    decision: 'compared' as const,
    premiseMeaning: pair.premiseMeaning,
    exampleMeaning: pair.exampleMeaning,
    relation: pair.relation,
    checks: {
      actor: 'aligned',
      event: 'aligned',
      time: negative ? 'different' : 'aligned',
      modality: negative ? 'different' : 'aligned',
      negation: 'aligned',
    },
    status: negative ? 'contradicted' : 'supported',
    reason: negative ? 'An intended visit is not a completed visit.' : 'The same completed event.',
    remedy: negative ? { kind: 'correction', text: 'Ich möchte meine Freundin besuchen.' } : null,
  };
  const judgment = { pairDecisions: [compared], additionalPairs: [] };
  const passageCritic = {
    index: 0,
    findings: [],
    passageWitness: extraction,
    narrativeWitness: listeningNarrativeExtractionFixture(turns),
  };
  const passageJudge = {
    index: 0,
    criticDecisions: [],
    newFindings: [],
    passageWitness: judgment,
    narrativeWitness: listeningNarrativeWitnessFixture(turns),
  };
  const questionCritic = { index: 1, findings: [] };
  const questionJudge = { index: 1, criticDecisions: [], newFindings: [] };
  return {
    fields,
    turns,
    extraction,
    compared,
    judgment,
    passageCritic,
    passageJudge,
    questionCritic,
    questionJudge,
    criticWire: { items: [passageCritic, questionCritic] },
    judgeWire: { items: [passageJudge, questionJudge] },
  };
}
type Fixture = ReturnType<typeof fixture>;
function critic(
  source: Fixture,
  wire: unknown = source.criticWire,
  assignment?: readonly number[]
) {
  return parseTeachingCriticResponse(
    JSON.stringify(wire),
    source.fields,
    false,
    source.turns,
    assignment,
    'de'
  );
}
function judge(
  source: Fixture,
  proposed: TeachingCritic,
  wire: unknown = source.judgeWire,
  assignment?: readonly number[],
  concerns = 0
) {
  return parseTeachingAdjudicatorResponse(
    JSON.stringify(wire),
    source.fields,
    proposed,
    concerns,
    false,
    source.turns,
    assignment,
    'de'
  );
}
function withJudgment(source: Fixture, passageWitness: unknown) {
  return { items: [{ ...source.passageJudge, passageWitness }, source.questionJudge] };
}
function withExtraction(source: Fixture, passageWitness: unknown) {
  return { items: [{ ...source.passageCritic, passageWitness }, source.questionCritic] };
}

describe('bound listening extraction and adjudication protocol', () => {
  it('reads retained static meaning-difference diagnostics after narrowing the live relation', () => {
    const diagnostic = {
      reason: 'schema',
      pathCodes: ['response'],
      schemaIssues: [
        {
          path: ['items', 0, 'passageWitness', 'pairDecisions', 1, 'status'],
          rule: 'An illustration or claimed_equivalence with a different meaning check cannot have supported or explicitly_repaired status.',
        },
      ],
    };
    expect(reviewerProtocolDiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
  });

  it.each(['meaning_expression', 'claimed_equivalence'] as const)(
    'identifies the exact rejected %s status with trusted static guidance',
    (relation) => {
      const source = fixture();
      const proposed = critic(source);
      const wire = withJudgment(source, {
        ...source.judgment,
        pairDecisions: [{ ...source.compared, relation, status: 'supported', remedy: null }],
      });
      let failure: unknown;
      try {
        judge(source, proposed, wire);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ReviewerProtocolError);
      expect(reviewerProtocolDiagnostic(failure)).toEqual({
        reason: 'schema',
        pathCodes: ['response'],
        schemaIssues: [
          {
            path: ['items', 0, 'passageWitness', 'pairDecisions', 0, 'status'],
            rule: supportedMeaningDifferenceRule,
          },
        ],
      });
      expect(judge(source, proposed).items[0].acceptable).toBe(false);
    }
  );

  it('retains extracted operands separately from their independent final assessment', () => {
    const source = fixture(false),
      proposed = critic(source),
      assessed = judge(source, proposed);
    expect(proposed.items[0].passageWitness).toMatchObject({
      locale: 'de',
      unitAccounts: Object.values(source.extraction.unitAccounts),
      pairs: [{ pairIndex: 0, ...source.extraction.pairs[0] }],
    });
    expect(assessed.items[0].passageWitness).toMatchObject({
      proposedPairs: proposed.items[0].passageWitness!.pairs,
      pairDecisions: [{ decision: 'compared', comparisonIndex: 0, status: 'supported' }],
    });
    expect(assessed.items[0].passageWitness).not.toHaveProperty('unitAccounts');
    expect(parseTeachingCritic(JSON.stringify(proposed), source.fields, source.turns)).toEqual(
      proposed
    );
    expect(
      parseTeachingAdjudicator(JSON.stringify(assessed), source.fields, proposed, source.turns)
    ).toEqual(assessed);
    expect(() =>
      parseTeachingCritic(JSON.stringify(source.criticWire), source.fields, source.turns)
    ).toThrow(ReviewerProtocolError);
    for (const schema of [
      buildTeachingCriticJsonSchema(source.fields, false, false, source.turns, undefined, 'de'),
      buildTeachingAdjudicatorJsonSchema(
        source.fields,
        proposed,
        false,
        0,
        false,
        source.turns,
        undefined,
        'de'
      ),
    ]) {
      const encoded = JSON.stringify(schema.schema);
      expect(encoded).not.toContain('"sourcePartIndices"');
      expect(encoded).not.toContain('"comparisonIndex"');
      expect(encoded).not.toContain('"proposedPairs"');
    }
  });

  it.each([{ version: 2 }, { locale: 'de' }, { units: [] }, { proposedPairs: [] }])(
    'refuses model-authored source metadata %j in both roles',
    (metadata) => {
      const source = fixture(false),
        proposed = critic(source);
      expect(() =>
        critic(source, withExtraction(source, { ...source.extraction, ...metadata }))
      ).toThrow(ReviewerProtocolError);
      expect(() =>
        judge(source, proposed, withJudgment(source, { ...source.judgment, ...metadata }))
      ).toThrow(ReviewerProtocolError);
    }
  );

  it('refuses model-authored pair metadata and silent retargeting of reviewed operands', () => {
    const source = fixture(false),
      proposed = critic(source);
    for (const metadata of [{ pairIndex: 0 }, { sourcePartIndices: [0] }, { status: 'supported' }])
      expect(() =>
        critic(
          source,
          withExtraction(source, {
            ...source.extraction,
            pairs: [{ ...source.extraction.pairs[0], ...metadata }],
          })
        )
      ).toThrow(ReviewerProtocolError);
    for (const metadata of [
      { comparisonIndex: 0 },
      { premiseUnitIndex: 1 },
      { sourcePartIndices: [0] },
    ])
      expect(() =>
        judge(
          source,
          proposed,
          withJudgment(source, {
            ...source.judgment,
            pairDecisions: [{ ...source.compared, ...metadata }],
          })
        )
      ).toThrow(ReviewerProtocolError);
  });

  it('keeps passage-only extraction while independently rejecting an unsupported question', () => {
    const source = fixture(false);
    Object.assign(source.fields[1], { question: 'Wohin ging Lea gestern?' });
    const proposed = critic(source, { items: [source.passageCritic] }, [0]);
    const part = buildTeachingSourceParts(source.fields[1]).find(
      ({ fieldPath }) => fieldPath[0] === 'question'
    )!;
    expect(proposed.items.map(({ index }) => index)).toEqual([0]);
    expect(parseTeachingCritic(JSON.stringify(proposed), source.fields, source.turns, [0])).toEqual(
      proposed
    );
    expect(() =>
      parseTeachingCritic(JSON.stringify(proposed), source.fields, source.turns)
    ).toThrow(ReviewerProtocolError);
    const assessed = judge(
      source,
      proposed,
      {
        items: [
          source.passageJudge,
          {
            ...source.questionJudge,
            newFindings: [
              {
                sourcePartIndex: part.index,
                issue: 'unsupported',
                rule: 'Use passage evidence.',
                defect: 'The question requires absent facts.',
                remedy: { kind: 'correction', text: 'Ask only about the supplied example.' },
              },
            ],
          },
        ],
      },
      [0]
    );
    expect(assessed.items[0].acceptable).toBe(true);
    expect(assessed.items[1]).toMatchObject({
      acceptable: false,
      issues: ['unsupported'],
      criticDecisions: [],
      findings: [{ fieldPath: ['question'], defect: 'The question requires absent facts.' }],
    });
    expect(
      parseTeachingAdjudicator(JSON.stringify(assessed), source.fields, proposed, source.turns, [0])
    ).toEqual(assessed);
  });

  it('requires exactly the assigned critic rows, all questions and only actual critic decisions', () => {
    const source = fixture(false),
      proposed = critic(source, { items: [source.passageCritic] }, [0]);
    for (const items of [[], [source.questionCritic], source.criticWire.items])
      expect(() => critic(source, { items }, [0])).toThrow(ReviewerProtocolError);
    expect(() => judge(source, proposed, { items: [source.passageJudge] }, [0])).toThrow(
      ReviewerProtocolError
    );
    expect(() =>
      judge(
        source,
        proposed,
        {
          items: [
            source.passageJudge,
            {
              ...source.questionJudge,
              criticDecisions: [
                { findingIndex: 0, decision: 'dismissed', reason: 'No such criticism exists.' },
              ],
            },
          ],
        },
        [0]
      )
    ).toThrow(ReviewerProtocolError);
  });

  it('refuses narrowed ordinary or reading review and invalid listening assignments', () => {
    const source = fixture(false);
    expect(() =>
      buildTeachingCriticJsonSchema(source.fields, false, false, undefined, [0])
    ).toThrow();
    expect(() =>
      buildTeachingCriticJsonSchema(source.fields, false, true, source.turns, [0], 'de')
    ).toThrow();
    expect(() =>
      buildTeachingCriticJsonSchema(source.fields, true, false, source.turns, [0], 'de')
    ).toThrow();
    for (const assignment of [[], [1], [0, 0], [0, 2]])
      expect(() =>
        buildTeachingCriticJsonSchema(source.fields, false, false, source.turns, assignment, 'de')
      ).toThrow();
  });

  it.each([true, false])(
    'derives final semantic rejection=%s despite empty ordinary findings',
    (negative) => {
      const source = fixture(negative),
        proposed = critic(source),
        assessed = judge(source, proposed);
      expect(proposed.items[0].passageWitness!.pairs[0]).not.toHaveProperty('status');
      expect(assessed.items[0]).toMatchObject({ acceptable: !negative, findings: [] });
      expect(assessed.items[0].issues).toEqual(negative ? ['incorrect'] : []);
      expect(assessed.items[0].feedback).toHaveLength(negative ? 1 : 0);
      expect(assessed.items[1]).toMatchObject({ acceptable: true, findings: [], feedback: [] });
    }
  );

  it('allows independent correction of an inaccurate extraction without rewriting the proposal', () => {
    const source = fixture(false);
    const proposed = critic(
      source,
      withExtraction(source, {
        ...source.extraction,
        pairs: [
          { ...source.extraction.pairs[0], premiseMeaning: 'The speaker wants to visit someone.' },
        ],
      })
    );
    const assessed = judge(source, proposed);
    expect(assessed.items[0]).toMatchObject({ acceptable: true, issues: [], feedback: [] });
    expect(assessed.items[0].passageWitness!.proposedPairs[0].premiseMeaning).toBe(
      'The speaker wants to visit someone.'
    );
    expect(assessed.items[0].passageWitness!.pairDecisions[0]).toMatchObject({
      premiseMeaning: 'Describe a completed visit.',
    });
    expect(proposed.items[0].passageWitness!.pairs[0].premiseMeaning).toBe(
      'The speaker wants to visit someone.'
    );
  });

  it('keeps a negative replacement binding after dismissing the original proposed relation', () => {
    const source = fixture();
    const proposed = critic(
      source,
      withExtraction(source, {
        ...source.extraction,
        pairs: [
          {
            ...source.extraction.pairs[0],
            premiseUnitIndex: 1,
            exampleUnitIndex: 1,
            premiseMeaning: 'Besucht is the past participle.',
            exampleMeaning: 'Besucht is the past participle.',
          },
        ],
      })
    );
    const assessment = {
      premiseMeaning: source.compared.premiseMeaning,
      exampleMeaning: source.compared.exampleMeaning,
      relation: source.compared.relation,
      checks: source.compared.checks,
      status: source.compared.status,
      reason: source.compared.reason,
      remedy: source.compared.remedy,
    };
    const assessed = judge(
      source,
      proposed,
      withJudgment(source, {
        pairDecisions: [
          {
            pairIndex: 0,
            decision: 'not_a_teaching_relation',
            reason: 'Unit 1 only names the participle; the conditional and example are in unit 0.',
            replacementPairIndices: [0],
          },
        ],
        additionalPairs: [{ ...assessment, premiseUnitIndex: 0, exampleUnitIndex: 0 }],
      })
    );
    expect(assessed.items[0]).toMatchObject({
      acceptable: false,
      issues: ['incorrect'],
      findings: [],
    });
    expect(assessed.items[0].passageWitness!.pairDecisions[0]).toMatchObject({
      replacementPairIndices: [0],
    });
    expect(assessed.items[0].passageWitness!.proposedPairs[0]).toMatchObject({
      premiseUnitIndex: 1,
      exampleUnitIndex: 1,
    });
    expect(assessed.items[0].passageWitness!.additionalPairs[0]).toMatchObject({
      premiseUnitIndex: 0,
      exampleUnitIndex: 0,
      status: 'contradicted',
      remedy: source.compared.remedy,
    });
  });

  it('rebinds teacher approval to the actual practice forms without equating speaker events', () => {
    const source = fixture(false);
    source.turns[0].text =
      'Dann probiere ich es: Plötzlich habe ich gestern meinen Schlüssel gesucht. Danach habe ich ihn in meiner Tasche gefunden. Ist das richtig?';
    source.turns[1].text = 'Ja, sehr gut.';
    Object.assign(source.fields[0], {
      passageText: source.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n'),
    });
    Object.assign(source.fields[1], {
      question: 'Was hat der erste Sprecher gefunden?',
      options: ['Seinen Schlüssel.', 'Sein Geld.'],
      explanation: 'Er hat seinen Schlüssel in seiner Tasche gefunden.',
    });
    const meanings = [
      'The host looked for their key yesterday.',
      'The host then found their key in their pocket.',
    ];
    const proposed = critic(
      source,
      withExtraction(source, {
        unitAccounts: {
          '0': 'Then I try it: Suddenly I looked for my key yesterday.',
          '1': 'After that I found it in my pocket.',
          '2': 'Is that correct?',
          '3': 'Yes, very good.',
        },
        pairs: meanings.map((premiseMeaning, premiseUnitIndex) => ({
          premiseUnitIndex,
          exampleUnitIndex: 3,
          premiseMeaning,
          exampleMeaning: 'The expert approves the host’s practice sentences.',
          relation: 'claimed_equivalence',
        })),
      })
    );
    const assessed = judge(
      source,
      proposed,
      withJudgment(source, {
        pairDecisions: meanings.map((_, pairIndex) => ({
          pairIndex,
          decision: 'not_a_teaching_relation',
          reason: 'The expert judges the practice form; the approval is not an equivalent event.',
          replacementPairIndices: [pairIndex],
        })),
        additionalPairs: meanings.map((exampleMeaning, exampleUnitIndex) => ({
          premiseUnitIndex: 3,
          exampleUnitIndex,
          premiseMeaning: 'The expert endorses the practice sentence as grammatically correct.',
          exampleMeaning,
          relation: 'grammatical_form',
          checks: {
            actor: 'not_applicable',
            event: 'not_applicable',
            time: 'not_applicable',
            modality: 'not_applicable',
            negation: 'not_applicable',
          },
          status: 'supported',
          reason: 'The sentence correctly uses habe and a final past participle.',
          remedy: null,
        })),
      })
    );
    expect(assessed.items.map(({ acceptable }) => acceptable)).toEqual([true, true]);
    const witness = assessed.items[0].passageWitness!;
    expect(witness.proposedPairs).toEqual(proposed.items[0].passageWitness!.pairs);
    expect(witness.pairDecisions).toMatchObject([
      { pairIndex: 0, replacementPairIndices: [0] },
      { pairIndex: 1, replacementPairIndices: [1] },
    ]);
    expect(witness.additionalPairs).toMatchObject([
      { premiseUnitIndex: 3, exampleUnitIndex: 0, relation: 'grammatical_form' },
      { premiseUnitIndex: 3, exampleUnitIndex: 1, relation: 'grammatical_form' },
    ]);
    expect(
      parseTeachingAdjudicator(JSON.stringify(assessed), source.fields, proposed, source.turns)
    ).toEqual(assessed);
  });

  it('blocks false grammatical claims and meaning errors together even without ordinary findings', () => {
    const source = fixture();
    source.turns[1].text = '„Besucht“ ist die Grundform von „besuchen“.';
    Object.assign(source.fields[0], {
      passageText: source.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n'),
    });
    const proposed = critic(
      source,
      withExtraction(source, {
        ...source.extraction,
        unitAccounts: {
          '0': source.extraction.unitAccounts[0],
          '1': 'Besucht is claimed to be the infinitive of besuchen.',
        },
      })
    );
    const assessed = judge(
      source,
      proposed,
      withJudgment(source, {
        ...source.judgment,
        additionalPairs: [
          {
            premiseUnitIndex: 1,
            exampleUnitIndex: 1,
            premiseMeaning: 'Besucht is claimed to be the infinitive of besuchen.',
            exampleMeaning: 'The cited form is besucht.',
            relation: 'grammatical_form',
            checks: {
              actor: 'not_applicable',
              event: 'not_applicable',
              time: 'not_applicable',
              modality: 'not_applicable',
              negation: 'not_applicable',
            },
            status: 'contradicted',
            reason: 'Besucht is the past participle; besuchen is the infinitive.',
            remedy: { kind: 'correction', text: '„Besuchen“ ist die Grundform.' },
          },
        ],
      })
    );
    expect(assessed.items[0]).toMatchObject({
      acceptable: false,
      findings: [],
      issues: ['incorrect'],
    });
    expect(assessed.items[0].feedback).toHaveLength(1);
    expect(assessed.items[0].feedback[0]).toContain('2 negative comparisons');
    const repairs = listeningPassageWitnessRepairFindings(
      assessed.items[0].passageWitness!,
      source.fields[0],
      source.turns
    );
    expect(repairs.map(({ correction }) => correction)).toEqual([
      'Ich möchte meine Freundin besuchen.',
      '„Besuchen“ ist die Grundform.',
    ]);
  });

  it('requires every pair decision and validates every replacement link', () => {
    const source = fixture(false),
      proposed = critic(source);
    for (const passageWitness of [
      { ...source.judgment, pairDecisions: [] },
      { ...source.judgment, pairDecisions: [source.compared, source.compared] },
      {
        pairDecisions: [
          {
            pairIndex: 0,
            decision: 'not_a_teaching_relation',
            reason: 'No relationship here.',
            replacementPairIndices: [0],
          },
        ],
        additionalPairs: [],
      },
    ])
      expect(() => judge(source, proposed, withJudgment(source, passageWitness))).toThrow(
        ReviewerProtocolError
      );
  });

  it('rejects uncertain evidence and stored approval that contradicts the final witness', () => {
    const source = fixture(),
      proposed = critic(source);
    const assessed = judge(
      source,
      proposed,
      withJudgment(source, {
        ...source.judgment,
        pairDecisions: [
          {
            ...source.compared,
            status: 'uncertain',
            checks: { ...source.compared.checks, time: 'uncertain' },
          },
        ],
      })
    );
    expect(assessed.items[0]).toMatchObject({
      acceptable: false,
      issues: ['uncertain'],
      findings: [],
    });
    assessed.items[0].acceptable = true;
    assessed.items[0].issues = [];
    assessed.items[0].feedback = [];
    expect(() =>
      parseTeachingAdjudicator(JSON.stringify(assessed), source.fields, proposed, source.turns)
    ).toThrow(ReviewerProtocolError);
  });

  it.each(['critic', 'judge'] as const)(
    'requires passage evidence and forbids question evidence for %s',
    (role) => {
      const source = fixture(false),
        proposed = critic(source);
      const missing =
        role === 'critic'
          ? { items: [{ index: 0, findings: [] }, source.questionCritic] }
          : { items: [{ index: 0, criticDecisions: [], newFindings: [] }, source.questionJudge] };
      const misplaced =
        role === 'critic'
          ? {
              items: [
                source.passageCritic,
                { ...source.questionCritic, passageWitness: source.extraction },
              ],
            }
          : {
              items: [
                source.passageJudge,
                { ...source.questionJudge, passageWitness: source.judgment },
              ],
            };
      for (const wire of [missing, misplaced])
        expect(() =>
          role === 'critic' ? critic(source, wire) : judge(source, proposed, wire)
        ).toThrow(ReviewerProtocolError);
    }
  );

  it('requires exact spoken context and explicitly captured locale for fresh reviews', () => {
    const source = fixture(false),
      proposed = critic(source),
      assessed = judge(source, proposed);
    expect(() =>
      parseTeachingCriticResponse(JSON.stringify(source.criticWire), source.fields)
    ).toThrow(ReviewerProtocolError);
    expect(() =>
      parseTeachingCriticResponse(
        JSON.stringify(source.criticWire),
        source.fields,
        false,
        source.turns
      )
    ).toThrow();
    expect(() =>
      parseTeachingAdjudicatorResponse(
        JSON.stringify(source.judgeWire),
        source.fields,
        proposed,
        0,
        false,
        source.turns,
        undefined,
        'en'
      )
    ).toThrow();
    expect(() => parseTeachingCritic(JSON.stringify(proposed), source.fields)).toThrow(
      ReviewerProtocolError
    );
    expect(() =>
      parseTeachingAdjudicator(JSON.stringify(assessed), source.fields, proposed)
    ).toThrow(ReviewerProtocolError);
    expect(() =>
      parseTeachingCritic(JSON.stringify(proposed), source.fields, [
        { ...source.turns[0], text: 'Anderer Text.' },
        source.turns[1],
      ])
    ).toThrow(ReviewerProtocolError);
  });

  it('refuses changed source anchors and changed proposals in retained evidence', () => {
    const source = fixture(false),
      proposed = critic(source),
      assessed = judge(source, proposed);
    const changedSource = structuredClone(proposed);
    changedSource.items[0].passageWitness!.pairs[0].sourcePartIndices = [999];
    expect(() =>
      parseTeachingCritic(JSON.stringify(changedSource), source.fields, source.turns)
    ).toThrow(ReviewerProtocolError);
    const changedProposal = structuredClone(assessed);
    changedProposal.items[0].passageWitness!.proposedPairs[0].premiseMeaning =
      'A different proposition.';
    expect(() =>
      parseTeachingAdjudicator(
        JSON.stringify(changedProposal),
        source.fields,
        proposed,
        source.turns
      )
    ).toThrow(ReviewerProtocolError);
  });

  it('retains all six ordinary findings and their concern indices beside a semantic rejection', () => {
    const source = fixture();
    const finding = {
      sourcePartIndex: buildTeachingSourceParts(source.fields[0])[0].index,
      issue: 'incorrect',
      rule: 'Preserve the intended meaning.',
      defect: 'The visit has not happened.',
      remedy: { kind: 'correction', text: 'Ich möchte meine Freundin besuchen.' },
    };
    const proposed = critic(source, {
      items: [
        { ...source.passageCritic, findings: [finding, finding, finding] },
        source.questionCritic,
      ],
    });
    const assessed = judge(
      source,
      proposed,
      {
        passageConcernDecisions: [
          {
            concernIndex: 0,
            decision: 'supported',
            reason: 'The claim is wrong.',
            itemIndex: 0,
            findingIndex: 5,
          },
        ],
        items: [
          {
            ...source.passageJudge,
            criticDecisions: [0, 1, 2].map((findingIndex) => ({
              findingIndex,
              decision: 'supported',
              reason: 'The example reports a completed visit.',
            })),
            newFindings: [finding, finding, finding],
          },
          source.questionJudge,
        ],
      },
      undefined,
      1
    );
    expect(assessed.items[0].findings).toHaveLength(6);
    expect(assessed.items[0].feedback).toHaveLength(7);
    expect(assessed.items[0].findings.slice(0, 3)).toEqual(proposed.items[0].findings);
    expect(assessed.passageConcernDecisions?.[0]).toMatchObject({ findingIndex: 5 });
  });

  it('accepts no-witness historical teaching packets while requiring fresh listening extraction', () => {
    const source = fixture(false);
    const historicalCritic = {
      items: [
        { index: 0, findings: [] },
        { index: 1, findings: [] },
      ],
    };
    const historicalJudge = {
      items: [0, 1].map((index) => ({
        index,
        acceptable: true,
        issues: [],
        feedback: [],
        findings: [],
        criticDecisions: [],
      })),
    };
    const parsed = parseTeachingCritic(JSON.stringify(historicalCritic), source.fields);
    expect(parsed).toEqual(historicalCritic);
    expect(
      parseTeachingAdjudicator(JSON.stringify(historicalJudge), source.fields, parsed)
    ).toEqual(historicalJudge);
    expect(() => critic(source, historicalCritic)).toThrow(ReviewerProtocolError);
  });

  it('authenticates missing extraction coverage as an existing protocol diagnostic', () => {
    const source = fixture();
    let error: unknown;
    try {
      critic(
        source,
        withExtraction(source, {
          ...source.extraction,
          unitAccounts: { '1': source.extraction.unitAccounts[1] },
        })
      );
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(ReviewerProtocolError);
    expect(reviewerProtocolDiagnostic(error)).toMatchObject({ reason: 'schema' });
  });
});
