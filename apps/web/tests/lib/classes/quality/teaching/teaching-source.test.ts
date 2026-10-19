import { describe, expect, it } from 'vitest';
import {
  buildTeachingSourceParts,
  buildTeachingCriticJsonSchema,
  buildTeachingAdjudicatorJsonSchema,
} from '@/lib/classes/quality/teaching-source/protocol';
import {
  parseTeachingCriticResponse,
  parseTeachingAdjudicator,
  parseTeachingAdjudicatorResponse,
  teachingAdjudicatorSchema,
  ReviewerProtocolError,
} from '@/lib/classes/quality/teaching-review-protocol';

const finding = (sourcePartIndex: number) => ({
  sourcePartIndex,
  issue: 'incorrect',
  rule: 'Keep the supplied actor.',
  defect: 'The opening assigns the action to the wrong person.',
  remedy: { kind: 'correction', text: 'Keep Eva as the actor.' },
});

describe('canonical teaching source parts', () => {
  const vocabularyFields = [
    {
      question:
        'Wähle das Verb, das angibt, wie lange sie insgesamt ist.\nDie Wanderung soll vier Stunden _____.',
      options: ['beginnen', 'enden', 'dauern', 'warten'],
      correctIndex: 2,
      explanation: 'Dauern bezeichnet die Länge der Wanderung.',
    },
  ];
  const wordingFinding = {
    sourcePartIndex: 0,
    issue: 'unnatural',
    rule: 'Use idiomatic wording for duration.',
    defect: 'The instruction says wie lange sie insgesamt ist.',
    remedy: {
      kind: 'correction',
      text: 'Wähle das Verb, das angibt, wie lange die Wanderung insgesamt dauert.',
    },
  };
  const vocabularyCritic = () =>
    parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [wordingFinding] }] }),
      vocabularyFields
    );
  const parseVocabulary = (
    response: unknown,
    critic = vocabularyCritic(),
    fields = vocabularyFields
  ) =>
    parseTeachingAdjudicatorResponse(
      JSON.stringify(response),
      fields,
      critic,
      0,
      false,
      undefined,
      undefined,
      undefined,
      true
    );

  it('does not let an unsupported wording preference reject vocabulary recall', () => {
    const critic = vocabularyCritic();
    const supported = {
      findingIndex: 0,
      decision: 'supported',
      reason: 'Another duration expression is more conventional.',
    };
    const response = {
      items: [{ index: 0, criticDecisions: [supported], newFindings: [] }],
    };
    expect(() => parseVocabulary(response, critic)).toThrow(ReviewerProtocolError);
    const result = parseVocabulary({
      items: [
        {
          index: 0,
          criticDecisions: [{ ...supported, decision: 'dismissed' }],
          newFindings: [],
        },
      ],
    });
    expect(result.items[0]).toMatchObject({ acceptable: true, issues: [], findings: [] });
    const historical = parseTeachingAdjudicatorResponse(
      JSON.stringify(response),
      vocabularyFields,
      critic
    );
    expect(historical.items[0].acceptable).toBe(false);
    expect(teachingAdjudicatorSchema.parse(historical)).toEqual(historical);
    expect(parseTeachingAdjudicator(JSON.stringify(historical), vocabularyFields, critic)).toEqual(
      historical
    );
  });

  const blockingWordingCases = [
    {
      question:
        'Wir gehen zu Füße. Ergänze das Verb für die geplante Zeit.\nDer Ausflug soll vier Stunden _____.',
      rule: 'Use the fixed expression zu Fuß for walking.',
      defect: 'The public context uses the plural Füße in zu Füße.',
      correction: 'Wir gehen zu Fuß.',
      evidence: {
        kind: 'language_constraint',
        constraint: 'The conventional expression for walking is zu Fuß, with singular Fuß.',
        violation: 'The supplied expression zu Füße uses the plural instead.',
      },
    },
    {
      question:
        'Die Wanderung beginnt um neun, die Führung um zehn. Sie endet um elf.\nSie soll eine Stunde _____.',
      rule: 'Identify the event whose duration is requested.',
      defect: 'Sie can name either the two-hour Wanderung or the one-hour Führung.',
      correction: 'Die Führung endet um elf. Die Führung soll eine Stunde _____.',
      evidence: {
        kind: 'unresolved_meaning',
        competingReading:
          'Sie may refer to either the Wanderung or the Führung, with different start times.',
        contextGap:
          'Both events are feminine; the context never identifies which one ends at eleven.',
      },
    },
  ];
  it.each(blockingWordingCases)(
    'retains source-bound blocking wording evidence: $evidence.kind',
    ({ question, rule, defect, correction, evidence }) => {
      const fields = [{ ...vocabularyFields[0], question }];
      const critic = parseTeachingCriticResponse(
        JSON.stringify({
          items: [
            {
              index: 0,
              findings: [
                {
                  ...wordingFinding,
                  rule,
                  defect,
                  remedy: { kind: 'correction', text: correction },
                },
              ],
            },
          ],
        }),
        fields
      );
      const result = parseVocabulary(
        {
          items: [
            {
              index: 0,
              criticDecisions: [
                {
                  findingIndex: 0,
                  decision: 'supported',
                  reason: 'The supplied context leaves the stated defect unresolved.',
                  wordingEvidence: evidence,
                },
              ],
              newFindings: [],
            },
          ],
        },
        critic,
        fields
      );
      expect(result.items[0]).toMatchObject({ acceptable: false, issues: ['unnatural'] });
      expect(result.items[0].findings).toEqual(critic.items[0].findings);
      expect(result.items[0].criticDecisions[0]).toMatchObject({ wordingEvidence: evidence });
      expect(teachingAdjudicatorSchema.parse(result)).toEqual(result);
      expect(parseTeachingAdjudicator(JSON.stringify(result), fields, critic)).toEqual(result);
    }
  );

  it('keeps novel wording evidence and supported-prefix addressing intact', () => {
    const source = blockingWordingCases[0];
    const fields = [
      {
        ...vocabularyFields[0],
        question: source.question,
        explanation: 'Dauern bedeutet hier, dass der Ausflug beginnt.',
      },
    ];
    const explanation = buildTeachingSourceParts(fields[0]).find(
      (part) => part.fieldPath[0] === 'explanation'
    )!;
    const falseDefinition = {
      ...finding(explanation.index),
      rule: 'Keep duration distinct from beginning.',
      defect: 'The explanation equates dauern with beginnen.',
      remedy: { kind: 'correction', text: 'Dauern bezeichnet die Länge des Ausflugs.' },
    };
    const preference = {
      ...wordingFinding,
      defect: 'The instruction uses Ergänze rather than Vervollständige.',
      remedy: { kind: 'correction', text: 'Vervollständige den Satz.' },
    };
    const critic = parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [falseDefinition, preference] }] }),
      fields
    );
    const evidence = source.evidence;
    const result = parseVocabulary(
      {
        items: [
          {
            index: 0,
            criticDecisions: [
              { findingIndex: 0, decision: 'supported', reason: 'The definition is false.' },
              { findingIndex: 1, decision: 'dismissed', reason: 'Only a wording preference.' },
            ],
            newFindings: [
              {
                ...wordingFinding,
                rule: source.rule,
                defect: source.defect,
                remedy: { kind: 'correction', text: source.correction },
                wordingEvidence: evidence,
              },
            ],
          },
        ],
      },
      critic,
      fields
    );
    expect(result.items[0].findings.map(({ issue }) => issue)).toEqual(['incorrect', 'unnatural']);
    expect(result.items[0].findings[0]).toEqual(critic.items[0].findings[0]);
    expect(result.items[0].findings[1]).toMatchObject({ wordingEvidence: evidence });
    expect(result.items[0].acceptable).toBe(false);
    expect(teachingAdjudicatorSchema.parse(result)).toEqual(result);
    expect(() =>
      parseVocabulary(
        {
          items: [{ index: 0, criticDecisions: [], newFindings: [wordingFinding] }],
        },
        { items: [{ index: 0, findings: [] }] }
      )
    ).toThrow(ReviewerProtocolError);
  });

  it('rejects incomplete, preference and misaddressed blocking evidence', () => {
    const critic = parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [finding(0), wordingFinding] }] }),
      vocabularyFields
    );
    for (const wordingEvidence of [
      { kind: 'language_constraint', constraint: 'Agreement.' },
      { kind: 'unresolved_meaning', competingReading: 'Another event.' },
      { kind: 'preference', reason: 'A smoother alternative exists.' },
      { kind: 'language_constraint', constraint: ' ', violation: 'Wrong agreement.' },
      { kind: 'language_constraint', constraint: 'x'.repeat(121), violation: 'Wrong agreement.' },
    ])
      expect(() =>
        parseVocabulary(
          {
            items: [
              {
                index: 0,
                criticDecisions: [
                  { findingIndex: 0, decision: 'dismissed', reason: 'No factual error.' },
                  { findingIndex: 1, decision: 'supported', reason: 'Confirmed.', wordingEvidence },
                ],
                newFindings: [],
              },
            ],
          },
          critic
        )
      ).toThrow(ReviewerProtocolError);
    expect(() =>
      parseVocabulary(
        {
          items: [
            {
              index: 0,
              criticDecisions: [
                {
                  findingIndex: 0,
                  decision: 'supported',
                  reason: 'Wrong definition.',
                  wordingEvidence: {
                    kind: 'language_constraint',
                    constraint: 'Agreement.',
                    violation: 'Wrong agreement.',
                  },
                },
                {
                  findingIndex: 1,
                  decision: 'supported',
                  reason: 'A smoother alternative exists.',
                },
              ],
              newFindings: [],
            },
          ],
        },
        critic
      )
    ).toThrow(ReviewerProtocolError);
  });

  it('requests wording evidence only in vocabulary adjudication and rejects other audit modes', () => {
    const critic = vocabularyCritic();
    const schema = buildTeachingAdjudicatorJsonSchema(
      vocabularyFields,
      critic,
      false,
      0,
      false,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(JSON.stringify(schema.schema)).toContain('wordingEvidence');
    expect(JSON.stringify(schema.schema)).not.toContain('"oneOf"');
    expect(
      JSON.stringify(buildTeachingAdjudicatorJsonSchema(vocabularyFields, critic).schema)
    ).not.toContain('wordingEvidence');
    expect(JSON.stringify(buildTeachingCriticJsonSchema(vocabularyFields).schema)).not.toContain(
      'wordingEvidence'
    );
    for (const [intro, reading] of [
      [true, false],
      [false, true],
    ])
      expect(() =>
        buildTeachingAdjudicatorJsonSchema(
          vocabularyFields,
          critic,
          intro,
          0,
          reading,
          undefined,
          undefined,
          undefined,
          true
        )
      ).toThrow();
    expect(() =>
      parseTeachingAdjudicatorResponse(
        JSON.stringify({ items: [] }),
        vocabularyFields,
        critic,
        0,
        false,
        [],
        undefined,
        undefined,
        true
      )
    ).toThrow();
  });

  it('requires reading answer evidence only for explicitly selected reading audits', () => {
    const fields = [
      {
        question: 'Where did Lea go?',
        options: ['Bonn', 'Rome', 'Paris', 'Berlin'],
        correctIndex: 0,
        explanation: 'The passage names Bonn.',
        passageText: 'Lea went to Bonn.',
      },
    ];
    const noWitness = JSON.stringify({ items: [{ index: 0, findings: [] }] });
    expect(() => parseTeachingCriticResponse(noWitness, fields, true)).toThrow(
      ReviewerProtocolError
    );
    expect(parseTeachingCriticResponse(noWitness, fields)).toEqual({
      items: [{ index: 0, findings: [] }],
    });
  });

  it('binds array elements exactly instead of accepting an array parent as quoted evidence', () => {
    const fields = [
      {
        task: 'Use the supplied facts.',
        ideas: ['Eva cooks.', 'Then write a reply.', 'Eva reads.'],
      },
    ];
    const parts = buildTeachingSourceParts(fields[0]);
    const first = parts.find((part) => part.fieldPath.join('.') === 'ideas.0')!;
    const last = parts.find((part) => part.fieldPath.join('.') === 'ideas.2')!;
    const critic = parseTeachingCriticResponse(
      JSON.stringify({
        items: [{ index: 0, findings: [finding(first.index), finding(last.index)] }],
      }),
      fields
    );
    expect(critic.items[0].findings.map(({ fieldPath, quote }) => ({ fieldPath, quote }))).toEqual([
      { fieldPath: ['ideas', '0'], quote: 'Eva cooks.' },
      { fieldPath: ['ideas', '2'], quote: 'Eva reads.' },
    ]);
    expect(() =>
      parseTeachingCriticResponse(
        JSON.stringify({
          items: [
            { index: 0, findings: [{ ...finding(0), fieldPath: ['ideas'], quote: 'Eva cooks.' }] },
          ],
        }),
        fields
      )
    ).toThrow(ReviewerProtocolError);
  });

  it('preserves real content-prefixed leaves and distinct identical strings without guessing a path', () => {
    const fields = [{ content: { text: 'Same exact text.' }, text: 'Same exact text.' }];
    const parts = buildTeachingSourceParts(fields[0]);
    expect(parts.map((part) => part.fieldPath)).toEqual([['content', 'text'], ['text']]);
    const critic = parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [finding(0)] }] }),
      fields
    );
    const adjudicator = parseTeachingAdjudicatorResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            criticDecisions: [
              { findingIndex: 0, decision: 'supported', reason: 'The assigned actor is wrong.' },
            ],
            newFindings: [],
          },
        ],
      }),
      fields,
      critic
    );
    expect(adjudicator.items[0].findings[0]).toEqual(critic.items[0].findings[0]);
    expect(adjudicator.items[0].findings[0].fieldPath).toEqual(['content', 'text']);
    expect(adjudicator.items[0].acceptable).toBe(false);
  });

  it('keeps exact Unicode excerpts and omits only whitespace-only evidence anchors', () => {
    const source = 'x'.repeat(119) + '😀 Gru\u0308ße中文' + 'y'.repeat(120);
    const parts = buildTeachingSourceParts({ text: source, empty: ' \n\t' });
    expect(parts.map((part) => part.quote).join('')).toBe(source);
    expect(parts.every((part) => part.quote.length <= 120 && part.quote.isWellFormed())).toBe(true);
    expect(parts.every((part) => part.fieldPath.join('.') === 'text')).toBe(true);
    expect(buildTeachingSourceParts(Object.create({ inherited: 'Not an own field.' }))).toEqual([]);
  });

  it('keeps all three supported and three newly discovered defects in compatibility evidence', () => {
    const fields = [{ task: 'Eva cooks. Ben reads. Mia walks.' }];
    const critic = parseTeachingCriticResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            findings: Array.from({ length: 3 }, (_, index) => ({
              ...finding(0),
              defect: `Original defect ${index}`,
            })),
          },
        ],
      }),
      fields
    );
    const adjudicator = parseTeachingAdjudicatorResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            criticDecisions: critic.items[0].findings.map((_, findingIndex) => ({
              findingIndex,
              decision: 'supported',
              reason: 'Confirmed in the supplied facts.',
            })),
            newFindings: Array.from({ length: 3 }, (_, index) => ({
              ...finding(0),
              defect: `Additional defect ${index}`,
            })),
          },
        ],
      }),
      fields,
      critic
    );
    const row = adjudicator.items[0];
    expect(row.findings.map((entry) => entry.defect)).toEqual([
      'Original defect 0',
      'Original defect 1',
      'Original defect 2',
      'Additional defect 0',
      'Additional defect 1',
      'Additional defect 2',
    ]);
    expect(row.findings.slice(0, 3)).toEqual(critic.items[0].findings);
    expect(row.feedback).toHaveLength(6);
    expect(row.acceptable).toBe(false);
    expect(row.issues).toEqual(['incorrect']);
    expect(teachingAdjudicatorSchema.parse(adjudicator)).toEqual(adjudicator);
  });

  it('derives bounded feedback without truncating the complete rule, defect or remedy', () => {
    const fields = [{ text: 'Original text.' }];
    const critic = parseTeachingCriticResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            findings: [
              {
                ...finding(0),
                rule: 'r'.repeat(80),
                defect: 'd'.repeat(120),
                remedy: { kind: 'counterexample', text: 'e'.repeat(120) },
              },
            ],
          },
        ],
      }),
      fields
    );
    const result = parseTeachingAdjudicatorResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            criticDecisions: [{ findingIndex: 0, decision: 'supported', reason: 'Confirmed.' }],
            newFindings: [],
          },
        ],
      }),
      fields,
      critic
    );
    expect(result.items[0].feedback).toEqual([
      'd'.repeat(120) + ' Counterexample: ' + 'e'.repeat(120),
    ]);
    expect(result.items[0].feedback[0].length).toBeLessThanOrEqual(300);
    expect(result.items[0].findings[0].rule).toBe('r'.repeat(80));
  });

  it('rejects another item’s selector, missing remedies and duplicate decision identities', () => {
    const fields = [{ short: 'A' }, { first: 'B', second: 'C' }];
    expect(() =>
      parseTeachingCriticResponse(
        JSON.stringify({
          items: [
            { index: 0, findings: [finding(1)] },
            { index: 1, findings: [] },
          ],
        }),
        fields
      )
    ).toThrow(ReviewerProtocolError);
    expect(() =>
      parseTeachingCriticResponse(
        JSON.stringify({
          items: [
            { index: 0, findings: [{ ...finding(0), remedy: null }] },
            { index: 1, findings: [] },
          ],
        }),
        fields
      )
    ).toThrow(ReviewerProtocolError);
    const one = [fields[0]];
    const critic = parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [finding(0), finding(0)] }] }),
      one
    );
    for (const decisions of [
      [],
      Array(2).fill({ findingIndex: 0, decision: 'dismissed', reason: 'Already addressed.' }),
    ])
      expect(() =>
        parseTeachingAdjudicatorResponse(
          JSON.stringify({ items: [{ index: 0, criticDecisions: decisions, newFindings: [] }] }),
          one,
          critic
        )
      ).toThrow(ReviewerProtocolError);
  });

  it('accepts an empty finding set while forbidding invented anchors and redundant judge approval', () => {
    const fields = [{ empty: ' ' }];
    const critic = parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [] }] }),
      fields
    );
    const row = { index: 0, criticDecisions: [], newFindings: [] };
    expect(
      parseTeachingAdjudicatorResponse(JSON.stringify({ items: [row] }), fields, critic).items[0]
    ).toEqual({
      index: 0,
      criticDecisions: [],
      acceptable: true,
      findings: [],
      issues: [],
      feedback: [],
    });
    expect(() =>
      parseTeachingCriticResponse(
        JSON.stringify({ items: [{ index: 0, findings: [finding(0)] }] }),
        fields
      )
    ).toThrow(ReviewerProtocolError);
    expect(() =>
      parseTeachingAdjudicatorResponse(
        JSON.stringify({ items: [{ ...row, acceptable: true }] }),
        fields,
        critic
      )
    ).toThrow(ReviewerProtocolError);
    expect(JSON.stringify(buildTeachingCriticJsonSchema(fields).schema)).not.toContain('fieldPath');
  });
});
