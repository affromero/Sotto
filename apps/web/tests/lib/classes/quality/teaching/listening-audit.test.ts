import { describe, expect, it } from 'vitest';
import { buildListeningAudit } from '@/lib/classes/quality/listening-audit/projection';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';

describe('scoped listening audit', () => {
  it('preserves exact shared passage and question fields without duplicating the passage', () => {
    const original = Array.from({ length: 4 }, (_, index) => ({
      passageText: '  A😀 passage.\n',
      question: `Question ${index}`,
      options: ['First', 'Second'],
      correctIndex: 1,
      explanation: 'Second.',
    }));
    const before = structuredClone(original);
    const audit = buildListeningAudit(original);
    expect(original).toEqual(before);
    expect(audit.addresses).toEqual([
      { kind: 'passage' },
      ...[0, 1, 2, 3].map((index) => ({ kind: 'question', index })),
    ]);
    expect(audit.items[0]).toEqual({ passageText: original[0].passageText });
    expect(audit.items.slice(1)).toEqual(
      original.map((item) => ({
        question: item.question,
        options: item.options,
        correctIndex: 1,
        explanation: 'Second.',
      }))
    );
    expect(buildTeachingSourceParts(audit.items[0])).toEqual([
      { index: 0, fieldPath: ['passageText'], quote: original[0].passageText },
    ]);
    expect(buildTeachingSourceParts(audit.items[1]).map((part) => part.fieldPath)).toEqual([
      ['question'],
      ['options', '0'],
      ['options', '1'],
      ['explanation'],
    ]);
  });
  it.each(
    [
      [],
      [{ question: 'Missing passage' }],
      [{ passageText: ' ' }],
      [{ passageText: 'A' }, { passageText: 'B' }],
      Array.from({ length: 5 }, () => ({ passageText: 'A' })),
    ].map((items) => ({ items }))
  )('rejects invalid shared passage scope before any provider request: %j', ({ items }) => {
    expect(() => buildListeningAudit(items)).toThrow();
  });
});
