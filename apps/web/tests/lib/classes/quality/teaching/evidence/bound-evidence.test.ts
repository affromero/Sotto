import { describe, expect, it } from 'vitest';
import {
  parseTeachingCritic,
  parseTeachingAdjudicator,
  teachingCriticSchema,
  teachingAdjudicatorSchema,
  ReviewerProtocolError,
} from '@/lib/classes/quality/teaching-review-protocol';
import {
  buildTeachingCriticJsonSchema,
  buildTeachingAdjudicatorJsonSchema,
} from '@/lib/classes/quality/teaching-source/protocol';
import { accepted, finding, rejected } from './review-fixtures';

const TEACHING_CRITIC_JSON_SCHEMA = buildTeachingCriticJsonSchema([{ task: 'Fixture.' }]);
const TEACHING_ADJUDICATOR_JSON_SCHEMA = buildTeachingAdjudicatorJsonSchema(
  [{ task: 'Fixture.' }],
  { items: [{ index: 0, findings: [] }] }
);

describe('bound teaching evidence', () => {
  const content = { task: 'Describe a visit.', ideas: ['A supplied opening.'] };
  const critic = {
    items: [{ index: 0, findings: [finding(['ideas', '0'], 'A supplied opening.')] }],
  };
  it.each([
    finding(['task'], 'Words absent from the task.'),
    finding(['ideas', '01'], 'A supplied opening.'),
    finding(['ideas', '1'], 'A supplied opening.'),
    finding(['ideas'], 'A supplied opening.'),
    finding(['toString'], 'Describe'),
    { ...finding(['task'], 'Describe'), correction: null },
  ])('rejects an unbound or unsupported witness before adjudication %#', (entry) => {
    expect(() =>
      parseTeachingCritic(JSON.stringify({ items: [{ index: 0, findings: [entry] }] }), [content])
    ).toThrow(ReviewerProtocolError);
  });
  it.each([
    { items: [] },
    {
      items: [
        { index: 0, findings: [] },
        { index: 0, findings: [] },
      ],
    },
    { items: [{ index: 1, findings: [] }] },
    { items: [{ index: 0, findings: [], extra: true }] },
    { items: [{ index: 0, findings: [], passageWitness: {} }] },
  ])('requires complete strict critic coverage %#', (value) => {
    expect(() => parseTeachingCritic(JSON.stringify(value), [content])).toThrow(
      ReviewerProtocolError
    );
  });
  it.each([
    { ...accepted(0), criticDecisions: [] },
    { ...accepted(0, critic.items[0].findings), findings: critic.items[0].findings },
    {
      ...rejected(0, critic.items[0].findings[0], critic.items[0].findings),
      issues: ['incorrect'],
    },
    {
      ...rejected(0, finding(['task'], 'Describe'), critic.items[0].findings),
      criticDecisions: [{ findingIndex: 0, decision: 'supported', reason: 'Supported.' }],
    },
    { ...rejected(0, critic.items[0].findings[0], critic.items[0].findings), feedback: [] },
  ])('rejects incomplete or inconsistent adjudication %#', (row) => {
    expect(() =>
      parseTeachingAdjudicator(JSON.stringify({ items: [row] }), [content], critic)
    ).toThrow(ReviewerProtocolError);
  });
  it('accepts dismissal and independently discovered defects as separate decisions', () => {
    const row = rejected(0, finding(['task'], 'Describe'), critic.items[0].findings);
    expect(
      parseTeachingAdjudicator(JSON.stringify({ items: [row] }), [content], critic).items[0]
        .findings[0].fieldPath
    ).toEqual(['task']);
  });
  it.each([
    [
      ['ideas', '0'],
      ['ideas', '0'],
    ],
    [
      ['content', 'ideas', '0'],
      ['ideas', '0'],
    ],
    [
      ['ideas', '0'],
      ['content', 'ideas', '0'],
    ],
    [
      ['content', 'ideas', '0'],
      ['content', 'ideas', '0'],
    ],
  ])(
    'binds equivalent relative and envelope paths before adjudication %#',
    (criticPath, judgePath) => {
      const objection = finding(criticPath, content.ideas[0]);
      const bound = parseTeachingCritic(
        JSON.stringify({ items: [{ index: 0, findings: [objection] }] }),
        [content]
      );
      const row = rejected(0, finding(judgePath, content.ideas[0]), bound.items[0].findings);
      const judged = parseTeachingAdjudicator(JSON.stringify({ items: [row] }), [content], bound);
      expect(bound.items[0].findings[0].fieldPath).toEqual(['ideas', '0']);
      expect(judged.items[0]).toMatchObject({
        acceptable: false,
        findings: [{ fieldPath: ['ideas', '0'] }],
        criticDecisions: [{ decision: 'supported' }],
      });
    }
  );
  it('retains a genuine nested content path with no competing relative leaf', () => {
    const fields = { content: { translation: 'Nested supplied wording.' } };
    const entry = finding(['content', 'translation'], fields.content.translation);
    const parsed = parseTeachingCritic(
      JSON.stringify({ items: [{ index: 0, findings: [entry] }] }),
      [fields]
    );
    expect(parsed.items[0].findings).toEqual([entry]);
  });
  it.each([
    { fields: content, path: ['content', 'content', 'task'], quote: content.task },
    { fields: content, path: ['content', 'missing'], quote: content.task },
    { fields: content, path: ['content', 'ideas', '01'], quote: content.ideas[0] },
    { fields: content, path: ['content', 'toString'], quote: content.task },
    { fields: content, path: ['content', '__proto__', 'task'], quote: content.task },
    { fields: content, path: ['items', '1', 'content', 'task'], quote: content.task },
    { fields: content, path: ['content', 'task'], quote: 'Sibling item wording.' },
    {
      fields: { content: { task: content.task }, task: content.task },
      path: ['content', 'task'],
      quote: content.task,
    },
    {
      fields: { content: { task: 'Different nested wording.' }, task: content.task },
      path: ['content', 'task'],
      quote: content.task,
    },
    { fields: { content: {}, task: content.task }, path: ['content', 'task'], quote: content.task },
  ])(
    'rejects unsafe, ambiguous or unbound envelope paths in either role %#',
    ({ fields, path, quote }) => {
      const entry = finding(path, quote);
      expect(() =>
        parseTeachingCritic(JSON.stringify({ items: [{ index: 0, findings: [entry] }] }), [fields])
      ).toThrow(ReviewerProtocolError);
      expect(() =>
        parseTeachingAdjudicator(JSON.stringify({ items: [rejected(0, entry)] }), [fields], {
          items: [{ index: 0, findings: [] }],
        })
      ).toThrow(ReviewerProtocolError);
    }
  );
  it('emits strict required properties recursively for both actual role schemas', () => {
    const audit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const schema = value as Record<string, unknown>;
      if (schema.type === 'object') {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(
          Object.keys(schema.properties as object).sort()
        );
      }
      for (const child of Object.values(schema)) {
        if (Array.isArray(child)) child.forEach(audit);
        else audit(child);
      }
    };
    // The emitted schema is the actual provider boundary shape.
    for (const schema of [teachingCriticSchema, teachingAdjudicatorSchema]) {
      expect(schema.safeParse({ items: [{ index: 0 }] }).success).toBe(false);
    }
    audit(TEACHING_CRITIC_JSON_SCHEMA.schema);
    audit(TEACHING_ADJUDICATOR_JSON_SCHEMA.schema);
  });
});
