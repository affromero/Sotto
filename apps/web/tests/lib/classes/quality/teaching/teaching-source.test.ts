import { describe, expect, it } from 'vitest';
import {
  buildTeachingSourceParts,
  buildTeachingCriticJsonSchema,
} from '@/lib/classes/quality/teaching-source/protocol';
import {
  parseTeachingCriticResponse,
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
