import { describe, expect, it } from 'vitest';
import {
  buildListeningAudit,
  normalizeListeningTurns,
  validateNormalizedListeningTurns,
} from '@/lib/classes/quality/listening-audit/projection';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';

describe('scoped listening audit', () => {
  it('uses original turn boundaries while normalizing only spoken text', () => {
    const original = [
      { speaker: 'HOST', text: ' [SFX: bell] Hallo [V1:Reise] [2]. (pause) [laughs]' },
      { speaker: 'EXPERT', text: 'Sie sagt: HOST: Hallo. 😀 [audience applause]' },
    ];
    const before = structuredClone(original);
    const turns = normalizeListeningTurns(original);
    expect(turns).toEqual([
      { turnIndex: 1, speaker: 'HOST', text: 'Hallo Reise. [laughs]' },
      { turnIndex: 2, speaker: 'EXPERT', text: 'Sie sagt: HOST: Hallo. 😀' },
    ]);
    expect(original).toEqual(before);
    const passageText = 'HOST: Hallo Reise. [laughs]\nEXPERT: Sie sagt: HOST: Hallo. 😀';
    const audit = buildListeningAudit([{ passageText }], turns);
    expect(audit.turns).toEqual(turns);
    expect(audit.items[0]).toEqual({ passageText });
    turns[0].text = 'Changed after binding';
    expect(audit.turns?.[0].text).toBe('Hallo Reise. [laughs]');
  });

  it('validates supplied normalized text exactly without cleaning it a second time', () => {
    const turns = [{ turnIndex: 1, speaker: 'HOST', text: 'A  [2] (pause)' }];
    expect(validateNormalizedListeningTurns(turns, 'HOST: A  [2] (pause)')).toEqual(turns);
    expect(() => validateNormalizedListeningTurns(turns, 'HOST: A')).toThrow();
  });

  it.each(
    [
      [],
      [{ turnIndex: 0, speaker: 'HOST', text: 'Hello.' }],
      [{ turnIndex: 2, speaker: 'HOST', text: 'Hello.' }],
      [{ turnIndex: 1, speaker: 'EXPERT', text: 'Hello.' }],
      [{ turnIndex: 1, speaker: 'HOST', text: 'Changed.' }],
      [{ turnIndex: 1, speaker: 'HOST\nEXPERT', text: 'Hello.' }],
      [{ turnIndex: 1, speaker: ' ', text: 'Hello.' }],
      [{ turnIndex: 1, speaker: 'HOST', text: 1 }],
      [{ turnIndex: 1, speaker: 'HOST', text: 'Hello.', extra: true }],
      [
        { turnIndex: 1, speaker: 'HOST', text: 'Hello.' },
        { turnIndex: 1, speaker: 'EXPERT', text: 'Hello.' },
      ],
    ].map((turns) => ({ turns }))
  )('rejects altered or malformed normalized turn bindings: %j', ({ turns }) => {
    expect(() => validateNormalizedListeningTurns(turns, 'HOST: Hello.')).toThrow();
  });

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
