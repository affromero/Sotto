import { describe, expect, it } from 'vitest';
import {
  buildTeachingCriticJsonSchema,
  buildTeachingAdjudicatorJsonSchema,
  buildTeachingSourceParts,
} from '@/lib/classes/quality/teaching-source/protocol';
import {
  parseTeachingCriticResponse,
  parseTeachingAdjudicatorResponse,
} from '@/lib/classes/quality/teaching-review-protocol';
import { buildListeningSourceUnits } from '@/lib/classes/quality/listening-audit/passage-witness';
import { normalizeListeningTurns } from '@/lib/classes/quality/listening-audit/projection';
import { shapeTeachingProviderFixture } from '../quality/intro-provider-fixture';
import { readingSupportFixture } from '../quality/teaching/reading-support-fixture';
import {
  listeningExtractionFixture,
  normalizedListeningExtractionFixture,
  withListeningWitnessFixture,
  listeningNarrativeExtractionFixture,
} from './witness-fixture';

const turns = normalizeListeningTurns([{ speaker: 'HOST', text: 'Lea fährt nach Bonn.' }]);
const fields = [{ passageText: 'HOST: Lea fährt nach Bonn.' }];
const listeningUnits = buildListeningSourceUnits(fields[0], turns, 'de');
const messages = [
  { content: JSON.stringify({ listeningTurns: turns, listeningUnits, items: [{ index: 0 }] }) },
];
const options = {
  jsonSchema: buildTeachingCriticJsonSchema(fields, false, false, turns, undefined, 'de'),
};

describe('declared listening provider fixtures', () => {
  it('supplies complete source coverage to the actual listening parser', () => {
    const response = withListeningWitnessFixture(messages, options, {
      content: JSON.stringify({ items: [{ index: 0, findings: [] }] }),
    });
    const parsed = parseTeachingCriticResponse(
      response.content,
      fields,
      false,
      turns,
      undefined,
      'de'
    );
    expect(parsed.items[0].passageWitness?.unitAccounts).toEqual([
      'Synthetic source account: Lea fährt nach Bonn.',
    ]);
    expect(parsed.items[0].passageWitness?.pairs).toEqual([]);
  });

  it('preserves explicitly malformed witness evidence through the compatibility boundary', () => {
    const response = {
      model: 'fixture',
      content: JSON.stringify({
        items: [{ index: 0, findings: [], passageWitness: { invalid: true } }],
      }),
    };
    const shaped = shapeTeachingProviderFixture(
      'Review the assigned content.',
      messages,
      options,
      response
    );
    expect(JSON.parse(shaped.content).items[0].passageWitness).toEqual({ invalid: true });
    expect(() =>
      parseTeachingCriticResponse(shaped.content, fields, false, turns, undefined, 'de')
    ).toThrow();
  });

  it('rejects model-supplied derived source metadata without silently stripping it', () => {
    const response = {
      model: 'fixture',
      content: JSON.stringify({
        items: [
          {
            index: 0,
            findings: [],
            passageWitness: normalizedListeningExtractionFixture(turns),
            narrativeWitness: listeningNarrativeExtractionFixture(turns),
          },
        ],
      }),
    };
    const shaped = shapeTeachingProviderFixture('Review content.', messages, options, response);
    expect(JSON.parse(shaped.content)).toEqual(JSON.parse(response.content));
    expect(() =>
      parseTeachingCriticResponse(shaped.content, fields, false, turns, undefined, 'de')
    ).toThrow();
  });

  it('preserves unknown fields on an explicit modern empty passage review', () => {
    const response = {
      model: 'fixture',
      content: JSON.stringify({
        unexpected: true,
        items: [
          {
            index: 0,
            findings: [],
            passageWitness: listeningExtractionFixture(turns),
            narrativeWitness: listeningNarrativeExtractionFixture(turns),
            unexpected: true,
          },
        ],
      }),
    };
    const shaped = shapeTeachingProviderFixture('Review content.', messages, options, response);
    expect(JSON.parse(shaped.content)).toEqual(JSON.parse(response.content));
    expect(() =>
      parseTeachingCriticResponse(shaped.content, fields, false, turns, undefined, 'de')
    ).toThrow();
  });

  it('preserves unknown fields on an explicit modern empty reading review', () => {
    const content = {
      passageText: 'Lea fährt nach Bonn.',
      question: 'Wohin fährt Lea?',
      options: ['Nach Bonn.', 'Nach Köln.', 'Nach Berlin.', 'Nach Hamburg.'],
      correctIndex: 0,
      explanation: 'Lea fährt nach Bonn.',
    };
    const item = { index: 0, content, sourceParts: buildTeachingSourceParts(content) };
    const readingMessages = [{ content: JSON.stringify({ items: [item] }) }];
    const readingOptions = {
      jsonSchema: buildTeachingCriticJsonSchema([content], false, true),
    };
    const response = {
      model: 'fixture',
      content: JSON.stringify({
        items: [
          {
            index: 0,
            findings: [],
            answerSupport: readingSupportFixture(item),
            unexpected: true,
          },
        ],
      }),
    };
    const shaped = shapeTeachingProviderFixture(
      'Review content.',
      readingMessages,
      readingOptions,
      response
    );
    expect(JSON.parse(shaped.content)).toEqual(JSON.parse(response.content));
    expect(() => parseTeachingCriticResponse(shaped.content, [content], true)).toThrow();
  });

  it('preserves unknown fields on an empty critic row without witness evidence', () => {
    const content = { question: 'Wohin fährt Lea?' };
    const plainMessages = [{ content: JSON.stringify({ items: [{ index: 0, content }] }) }];
    const plainOptions = { jsonSchema: buildTeachingCriticJsonSchema([content]) };
    const response = {
      model: 'fixture',
      content: JSON.stringify({ items: [{ index: 0, findings: [], unexpected: true }] }),
    };
    const shaped = shapeTeachingProviderFixture(
      'Review content.',
      plainMessages,
      plainOptions,
      response
    );
    expect(JSON.parse(shaped.content)).toEqual(JSON.parse(response.content));
    expect(() => parseTeachingCriticResponse(shaped.content, [content])).toThrow();
  });

  it('translates legacy witness findings beside modern empty rows without dropping strict errors', () => {
    const mixedFields = [...fields, { question: 'Wohin fährt Lea?' }];
    const mixedOptions = {
      jsonSchema: buildTeachingCriticJsonSchema(mixedFields, false, false, turns, undefined, 'de'),
    };
    const suppliedMessages = [
      {
        content: JSON.stringify({
          listeningTurns: turns,
          listeningUnits,
          items: mixedFields.map((content, index) => ({
            index,
            content,
            sourceParts: buildTeachingSourceParts(content),
          })),
        }),
      },
    ];
    const response = {
      model: 'fixture',
      content: JSON.stringify({
        items: [
          {
            index: 0,
            passageWitness: listeningExtractionFixture(turns),
            findings: [
              {
                fieldPath: ['passageText'],
                quote: fields[0].passageText,
                issue: 'incorrect',
                rule: 'Use the supplied destination.',
                defect: 'The destination differs from the source.',
                correction: 'Lea fährt nach Köln.',
                counterexample: null,
              },
            ],
          },
          { index: 1, findings: [] },
        ],
      }),
    };
    const shaped = shapeTeachingProviderFixture(
      'Review content.',
      suppliedMessages,
      mixedOptions,
      response
    );
    const parsed = parseTeachingCriticResponse(
      shaped.content,
      mixedFields,
      false,
      turns,
      undefined,
      'de'
    );
    expect(parsed.items[0].findings).toEqual([
      expect.objectContaining({
        fieldPath: ['passageText'],
        quote: fields[0].passageText,
        defect: 'The destination differs from the source.',
        correction: 'Lea fährt nach Köln.',
      }),
    ]);
    expect(parsed.items[0].passageWitness).toEqual(normalizedListeningExtractionFixture(turns));
    expect(parsed.items[1].findings).toEqual([]);
    const malformed = JSON.parse(response.content);
    malformed.items[1].unexpected = true;
    const rejected = shapeTeachingProviderFixture(
      'Review content.',
      suppliedMessages,
      mixedOptions,
      { ...response, content: JSON.stringify(malformed) }
    );
    expect(JSON.parse(rejected.content).items[1].unexpected).toBe(true);
    expect(() =>
      parseTeachingCriticResponse(rejected.content, mixedFields, false, turns, undefined, 'de')
    ).toThrow();
  });

  it('leaves malformed output and other review modes untouched', () => {
    const response = { content: '{' };
    expect(withListeningWitnessFixture(messages, options, response)).toBe(response);
    expect(withListeningWitnessFixture(messages, undefined, response)).toBe(response);
  });

  it('declares an empty judge witness only for an explicitly empty extracted pair set', () => {
    const critic = parseTeachingCriticResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            findings: [],
            passageWitness: listeningExtractionFixture(turns),
            narrativeWitness: listeningNarrativeExtractionFixture(turns),
          },
        ],
      }),
      fields,
      false,
      turns,
      undefined,
      'de'
    );
    const judgeOptions = {
      jsonSchema: buildTeachingAdjudicatorJsonSchema(
        fields,
        critic,
        false,
        0,
        false,
        turns,
        undefined,
        'de'
      ),
    };
    const judgeMessages = [
      {
        content: JSON.stringify({
          listeningUnits,
          items: [{ index: 0 }],
          criticisms: { items: [{ index: 0, findings: [], passagePairs: [] }] },
        }),
      },
    ];
    const response = withListeningWitnessFixture(judgeMessages, judgeOptions, {
      content: JSON.stringify({ items: [{ index: 0, criticDecisions: [], newFindings: [] }] }),
    });
    const judge = parseTeachingAdjudicatorResponse(
      response.content,
      fields,
      critic,
      0,
      false,
      turns,
      undefined,
      'de'
    );
    expect(judge.items[0].passageWitness).toMatchObject({
      proposedPairs: [],
      pairDecisions: [],
      additionalPairs: [],
    });
    expect(judge.items[0].passageWitness).not.toHaveProperty('unitAccounts');
  });

  it('does not fabricate judge decisions for explicitly supplied pairs or replace malformed judge evidence', () => {
    const criticWire = {
      items: [
        {
          index: 0,
          findings: [],
          narrativeWitness: listeningNarrativeExtractionFixture(turns),
          passageWitness: {
            ...listeningExtractionFixture(turns),
            pairs: [
              {
                premiseUnitIndex: 0,
                exampleUnitIndex: 0,
                premiseMeaning: 'Lea travels to Bonn.',
                exampleMeaning: 'Lea travels to Bonn.',
                relation: 'meaning_expression',
              },
            ],
          },
        },
      ],
    };
    const critic = parseTeachingCriticResponse(
      JSON.stringify(criticWire),
      fields,
      false,
      turns,
      undefined,
      'de'
    );
    const judgeOptions = {
      jsonSchema: buildTeachingAdjudicatorJsonSchema(
        fields,
        critic,
        false,
        0,
        false,
        turns,
        undefined,
        'de'
      ),
    };
    const judgeMessages = [
      {
        content: JSON.stringify({
          listeningUnits,
          criticisms: {
            items: [{ index: 0, passagePairs: critic.items[0].passageWitness!.pairs }],
          },
        }),
      },
    ];
    for (const row of [
      { index: 0, criticDecisions: [], newFindings: [] },
      {
        index: 0,
        criticDecisions: [],
        newFindings: [],
        passageWitness: { pairDecisions: [], additionalPairs: [] },
      },
    ]) {
      const response = { content: JSON.stringify({ items: [row] }) };
      expect(withListeningWitnessFixture(judgeMessages, judgeOptions, response)).toBe(response);
      expect(() =>
        parseTeachingAdjudicatorResponse(
          response.content,
          fields,
          critic,
          0,
          false,
          turns,
          undefined,
          'de'
        )
      ).toThrow();
    }
  });

  it('projects only declared compatibility critic rows and preserves malformed modern coverage', () => {
    const allFields = [...fields, { question: 'Where did Lea go?' }];
    const assignedOptions = {
      jsonSchema: buildTeachingCriticJsonSchema(allFields, false, false, turns, [0], 'de'),
    };
    const assignedMessages = [
      {
        content: JSON.stringify({
          listeningTurns: turns,
          listeningUnits,
          criticAssignment: [0],
          items: [{ index: 0, content: fields[0] }],
        }),
      },
    ];
    const shaped = shapeTeachingProviderFixture(
      'Review content.',
      assignedMessages,
      assignedOptions,
      {
        model: 'fixture',
        content: JSON.stringify({
          items: [0, 1].map((index) => ({
            index,
            acceptable: true,
            issues: [],
            feedback: [],
          })),
        }),
      }
    );
    expect(
      parseTeachingCriticResponse(shaped.content, allFields, false, turns, [0], 'de').items.map(
        (row) => row.index
      )
    ).toEqual([0]);
    const malformed = shapeTeachingProviderFixture(
      'Review content.',
      assignedMessages,
      assignedOptions,
      {
        model: 'fixture',
        content: JSON.stringify({ items: [0, 1].map((index) => ({ index, findings: [] })) }),
      }
    );
    expect(JSON.parse(malformed.content).items.map((row: { index: number }) => row.index)).toEqual([
      0, 1,
    ]);
    expect(() =>
      parseTeachingCriticResponse(malformed.content, allFields, false, turns, [0], 'de')
    ).toThrow();
  });
});
