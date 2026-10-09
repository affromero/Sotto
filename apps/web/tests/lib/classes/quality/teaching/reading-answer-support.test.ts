import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';
import {
  readingAnswerSupportEvidenceSchema,
  readingAnswerSupportSchema,
  parseReadingAnswerSupport,
  readingAnswerSupportFailure,
  type ReadingAnswerSupport,
} from '@/lib/classes/quality/teaching-source/reading-answer-support';

const fields = {
  question: 'Was hat Mila nach dem Warten gemacht?',
  options: ['Sie hat gelesen.', 'Sie hat gekocht.', 'Sie ist gefahren.', 'Sie hat geschlafen.'],
  correctIndex: 0,
  explanation: 'Im Text liest Mila nach dem Warten.',
  passageText: 'Mila hat zehn Minuten gewartet. Danach hat sie ein Buch gelesen.',
};
const parts = buildTeachingSourceParts(fields);
const part = (field: string) => parts.find((entry) => entry.fieldPath[0] === field)!.index;
function witness(): ReadingAnswerSupport {
  return {
    options: [0, 1, 2, 3].map((optionIndex) => ({
      optionIndex,
      status: optionIndex === 0 ? 'supported' : 'unstated',
      passagePartIndices: optionIndex === 0 ? [part('passageText')] : [],
    })),
    constraints: ['actor', 'action', 'time_order', 'negation', 'quantity', 'scope'].map((kind) => {
      const absent = kind === 'negation' || kind === 'quantity';
      return {
        kind: kind as ReadingAnswerSupport['constraints'][number]['kind'],
        status: absent ? 'not_applicable' : 'satisfied',
        questionPartIndex: absent ? null : part('question'),
        passagePartIndices: absent ? [] : [part('passageText')],
        reason: absent
          ? 'Die Frage enthält keine solche Einschränkung.'
          : 'Die Frage stimmt mit der genannten Handlung überein.',
      };
    }),
    explanation: {
      status: 'supported',
      explanationPartIndex: part('explanation'),
      passagePartIndices: [part('passageText')],
      reason: 'Die Erklärung folgt der Reihenfolge im Text.',
    },
  };
}

describe('reading answer-support evidence', () => {
  it('accepts complete passage-bound support while preserving the entire witness', () => {
    const original = witness();
    const parsed = parseReadingAnswerSupport(original, fields);
    expect(parsed).toEqual(original);
    expect(readingAnswerSupportFailure(parsed, fields.correctIndex)).toBeUndefined();
    expect(readingAnswerSupportEvidenceSchema.parse(parsed)).toEqual(parsed);
  });

  it.each(['actor', 'action', 'time_order', 'negation', 'quantity', 'scope'] as const)(
    'rejects a complete negative %s check without requiring ordinary findings',
    (kind) => {
      const value = witness();
      const check = value.constraints.find((constraint) => constraint.kind === kind)!;
      Object.assign(check, {
        status: 'unstated',
        questionPartIndex: part('question'),
        passagePartIndices: [],
        reason: 'Diese Einschränkung wird im Text nicht belegt.',
      });
      const parsed = parseReadingAnswerSupport(value, fields);
      expect(readingAnswerSupportFailure(parsed, 0)).toContain(kind);
      expect(parsed.constraints).toEqual(value.constraints);
    }
  );

  it.each([[], [1], [0, 1]].map((indices) => ({ indices })))(
    'rejects supported options $indices when the unique key is zero',
    ({ indices }) => {
      const value = witness();
      for (const option of value.options) {
        option.status = indices.includes(option.optionIndex) ? 'supported' : 'unstated';
        option.passagePartIndices = option.status === 'supported' ? [part('passageText')] : [];
      }
      expect(readingAnswerSupportFailure(parseReadingAnswerSupport(value, fields), 0)).toContain(
        'options='
      );
    }
  );

  it.each(['contradicted', 'unstated'] as const)(
    'rejects a %s explanation with its actual evidence retained',
    (status) => {
      const value = witness();
      value.explanation.status = status;
      value.explanation.passagePartIndices = status === 'unstated' ? [] : [part('passageText')];
      const parsed = parseReadingAnswerSupport(value, fields);
      const summary = readingAnswerSupportFailure(parsed, 0);
      expect(summary).toContain(`explanation=${status}`);
      expect(summary).toContain(`Untrusted witness reason: ${value.explanation.reason}`);
      expect(parsed.explanation).toEqual(value.explanation);
    }
  );

  it('keeps the rejection summary bounded while preserving every negative constraint', () => {
    const value = witness();
    for (const option of value.options) {
      option.status = 'unstated';
      option.passagePartIndices = [];
    }
    for (const check of value.constraints)
      Object.assign(check, {
        status: 'unstated',
        questionPartIndex: part('question'),
        passagePartIndices: [],
        reason: 'x'.repeat(80),
      });
    value.explanation.status = 'unstated';
    value.explanation.passagePartIndices = [];
    value.explanation.reason = 'y'.repeat(100);
    const parsed = parseReadingAnswerSupport(value, fields);
    const summary = readingAnswerSupportFailure(parsed, 3)!;
    expect(summary.length).toBeLessThanOrEqual(300);
    for (const check of value.constraints) expect(summary).toContain(check.kind);
    expect(summary).toContain(`Untrusted witness reason: ${'x'.repeat(80)}`);
    expect(parsed).toEqual(value);
  });

  const invalid: Array<[string, (value: ReadingAnswerSupport) => void]> = [
    ['missing option', (v) => v.options.pop()],
    [
      'duplicate option',
      (v) => {
        v.options[3].optionIndex = 0;
      },
    ],
    [
      'missing time constraint',
      (v) => {
        v.constraints.splice(2, 1);
      },
    ],
    [
      'duplicate constraint',
      (v) => {
        v.constraints[2].kind = 'actor';
      },
    ],
    [
      'unknown passage address',
      (v) => {
        v.options[0].passagePartIndices = [999];
      },
    ],
    [
      'option supplied as passage evidence',
      (v) => {
        v.options[0].passagePartIndices = [part('options')];
      },
    ],
    [
      'passage supplied as question evidence',
      (v) => {
        v.constraints[0].questionPartIndex = part('passageText');
      },
    ],
    [
      'question supplied as explanation evidence',
      (v) => {
        v.explanation.explanationPartIndex = part('question');
      },
    ],
    [
      'duplicate evidence',
      (v) => {
        v.options[0].passagePartIndices = [part('passageText'), part('passageText')];
      },
    ],
    [
      'supported option without evidence',
      (v) => {
        v.options[0].passagePartIndices = [];
      },
    ],
    [
      'contradicted option without evidence',
      (v) => {
        v.options[1].status = 'contradicted';
      },
    ],
    [
      'satisfied constraint without evidence',
      (v) => {
        v.constraints[0].passagePartIndices = [];
      },
    ],
    [
      'violated constraint without evidence',
      (v) => {
        v.constraints[0].status = 'violated';
        v.constraints[0].passagePartIndices = [];
      },
    ],
    [
      'applicable constraint without question evidence',
      (v) => {
        v.constraints[0].questionPartIndex = null;
      },
    ],
    [
      'not applicable with question evidence',
      (v) => {
        v.constraints[3].questionPartIndex = part('question');
      },
    ],
    [
      'not applicable with passage evidence',
      (v) => {
        v.constraints[3].passagePartIndices = [part('passageText')];
      },
    ],
    [
      'empty absence reason',
      (v) => {
        v.constraints[3].reason = ' ';
      },
    ],
    [
      'supported explanation without evidence',
      (v) => {
        v.explanation.passagePartIndices = [];
      },
    ],
    [
      'empty explanation reason',
      (v) => {
        v.explanation.reason = ' ';
      },
    ],
    [
      'unbounded constraint reason',
      (v) => {
        v.constraints[0].reason = 'x'.repeat(81);
      },
    ],
    [
      'unbounded explanation reason',
      (v) => {
        v.explanation.reason = 'x'.repeat(101);
      },
    ],
  ];
  it.each(invalid.map(([name, change]) => ({ name, change })))(
    'fails closed on $name',
    ({ change }) => {
      const value = witness();
      change(value);
      expect(() => parseReadingAnswerSupport(value, fields)).toThrow(z.ZodError);
    }
  );

  it('binds source indices to the current source table instead of another field layout', () => {
    const changed = { unrelated: 'New address before the current fields.', ...fields };
    expect(() => parseReadingAnswerSupport(witness(), changed)).toThrow(z.ZodError);
  });

  it.each(['question', 'explanation', 'passageText', 'options'])(
    'refuses incomplete reading input missing %s',
    (field) => {
      const incomplete: Record<string, unknown> = { ...fields };
      delete incomplete[field];
      expect(() => readingAnswerSupportSchema(incomplete)).toThrow();
    }
  );

  it('emits strict provider schema with current source-address domains and no oneOf', () => {
    const schema = z.toJSONSchema(readingAnswerSupportSchema(fields), { target: 'draft-7' });
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).not.toContain('oneOf');
    expect(readingAnswerSupportSchema(fields).safeParse(witness()).success).toBe(true);
  });
});
