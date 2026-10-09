import { describe, expect, it } from 'vitest';
import {
  parseWritingAuthoringProof,
  parseWritingIdeas,
  parseWritingStarter,
} from '@/lib/learning/writing/writing-output-protocol';

describe('writing authoring proofs and scaffolds', () => {
  it('binds every published opening to the single complete worked answer', () => {
    expect(
      parseWritingIdeas(
        ['  Paul hat  ', 'Paul hat gestern'],
        'Paul hat gestern seine Tante besucht.'
      )
    ).toEqual(['Paul hat …', 'Paul hat gestern …']);
  });

  it.each([null, undefined, []].map((ideas) => ({ ideas })))(
    'keeps optional scaffolds absent',
    ({ ideas }) => {
      expect(parseWritingIdeas(ideas, 'Paul hat gekocht.')).toEqual([]);
    }
  );

  it.each(
    [
      ['Paul hat gestern …'],
      ['Paul hat gestern...'],
      [''],
      ['Gestern ist Paul'],
      ['Paul hat gestern seine Tante besucht.'],
      [{ opening: 'Paul hat', answer: 'Paul hat gestern seine Tante besucht.' }],
      Array.from({ length: 4 }, () => 'Paul hat'),
    ].map((ideas) => ({ ideas }))
  )('rejects malformed hints instead of silently removing scaffolds', ({ ideas }) => {
    expect(() => parseWritingIdeas(ideas, 'Paul hat gestern seine Tante besucht.')).toThrow();
  });

  it.each([
    ['Paul hat seine Tante besucht', 'Paul hat seine Tante besucht und ist spazieren gegangen.'],
    ['我昨天', '我昨天去了学校。'],
    ['Cafe\u0301', 'Cafe\u0301 ist offen.'],
    ['😀', '😀 ist hier.'],
  ])('preserves exact Unicode answer bytes without inserting separators: %s', (opening, answer) => {
    expect(parseWritingIdeas([opening], answer)).toEqual([`${opening} …`]);
  });

  it.each([
    ['Paul hat seine Tante besucht.', 'Paul hat seine Tante besucht und ist spazieren gegangen.'],
    ['Cafe', 'Cafe\u0301 ist offen.'],
    ['\ud83d', '😀 ist hier.'],
    ['Cafe\u0301', 'Café ist offen.'],
  ])('rejects changed punctuation or split graphemes: %s', (opening, answer) => {
    expect(() => parseWritingIdeas([opening], answer)).toThrow();
  });
});

describe('fixed writing starters', () => {
  it.each([
    ['Hallo Tim, gestern', 'Hallo Tim, gestern habe ich meine Tante besucht.'],
    ['我昨天', '我昨天去了学校。'],
    ['Cafe\u0301', 'Cafe\u0301 ist offen.'],
    ['😀', '😀 ist hier.'],
  ])('preserves the exact supplied beginning in every complete answer: %s', (starter, answer) => {
    expect(parseWritingStarter(`  ${starter}  `, 'completion', answer)).toBe(starter);
  });

  it('allows a shorter compatible opening and retains optional absent ideas', () => {
    const answer = 'Hallo Tim, gestern habe ich meine Tante besucht.';
    const ideas = parseWritingIdeas(['Hallo'], answer);
    expect(parseWritingStarter('Hallo Tim, gestern', 'completion', answer)).toBe(
      'Hallo Tim, gestern'
    );
    expect(ideas).toEqual(['Hallo …']);
    expect(parseWritingIdeas(null, answer)).toEqual([]);
  });

  it.each([
    [undefined, 'Hallo Tim, gestern war ich im Kino.'],
    [null, 'Hallo Tim, gestern war ich im Kino.'],
    ['', 'Hallo Tim, gestern war ich im Kino.'],
    ['Hallo …', 'Hallo … Tim.'],
    ['Hallo...', 'Hallo... Tim.'],
    ['Hallo Tim, gestern', 'Hallo Tim, ich war gestern im Kino.'],
    ['Hallo Tim, gestern', 'Hallo Tim, gestern'],
    ['Cafe', 'Cafe\u0301 ist offen.'],
    ['\ud83d', '😀 ist hier.'],
    ['Cafe\u0301', 'Café ist offen.'],
  ] satisfies Array<[unknown, string]>)(
    'rejects missing or changed fixed beginnings before review',
    (starter, answer) => {
      expect(() => parseWritingStarter(starter, 'completion', answer)).toThrow();
    }
  );

  it.each(['transformation', 'correction', 'guided_reply'])(
    'requires an explicit null starter for %s',
    (taskType) => {
      expect(parseWritingStarter(null, taskType, 'Paul hat gekocht.')).toBeNull();
      expect(() => parseWritingStarter(undefined, taskType, 'Paul hat gekocht.')).toThrow();
      expect(() => parseWritingStarter('Paul', taskType, 'Paul hat gekocht.')).toThrow();
    }
  );
});

const correction = (source: string, answer: string) =>
  parseWritingAuthoringProof(
    { modelAnswer: answer, correctionReason: 'Proposed grammatical correction.' },
    'correction',
    source
  );

describe('writing authoring proof', () => {
  it.each([
    ['Er ist gekocht.', 'Er hat gekocht.', 'is', 'ha'],
    ['Sie gestern gekocht.', 'Sie hat gestern gekocht.', '', 'hat '],
    ['Sie hat hat gekocht.', 'Sie hat gekocht.', 'hat ', ''],
    ['😀 Er ist hier.', '😀 Er war hier.', 'ist', 'war'],
    ['Cafe\u0301 ist offen.', 'Café war offen.', 'e\u0301 ist', 'é war'],
  ])(
    'preserves complete Unicode text around an actual proposed edit: %s',
    (source, answer, original, replacement) => {
      expect(correction(source, answer)).toEqual({
        modelAnswer: answer,
        correctionDelta: { original, replacement, reason: 'Proposed grammatical correction.' },
      });
    }
  );

  it.each([
    ['Er hat gekocht.', 'Er hat gekocht.'],
    ['Er hat gekocht.', '  Er hat gekocht.  '],
    ['Er hat gekocht.', 'Er  hat\ngekocht.'],
    ['Cafe\u0301 ist offen.', 'Café ist offen.'],
  ])(
    'rejects an unchanged correction rather than treating formatting as proof: %s',
    (source, answer) => {
      expect(() => correction(source, answer)).toThrow(/meaningful edit/);
    }
  );

  it('retains a proposed paraphrase for independent grammatical review without claiming it is a real correction', () => {
    expect(correction('Er hat gekocht.', 'Er hat Essen zubereitet.').correctionDelta).toEqual({
      original: 'gekoch',
      replacement: 'Essen zubereite',
      reason: 'Proposed grammatical correction.',
    });
  });

  it.each(['transformation', 'completion', 'guided_reply'])(
    'requires a full answer and no correction claim for %s',
    (taskType) => {
      expect(
        parseWritingAuthoringProof(
          { modelAnswer: '  Ich habe gekocht.  ', correctionReason: null },
          taskType,
          'Ich koche.'
        )
      ).toEqual({ modelAnswer: 'Ich habe gekocht.', correctionDelta: null });
      expect(() =>
        parseWritingAuthoringProof(
          { modelAnswer: 'Ich habe gekocht.', correctionReason: 'Some error.' },
          taskType,
          'Ich koche.'
        )
      ).toThrow();
    }
  );

  it.each([
    { modelAnswer: '', correctionReason: 'An error.' },
    { modelAnswer: 'Er hat gekocht.', correctionReason: null },
    { modelAnswer: 'Er hat gekocht.', correctionReason: ' ' },
    { correctionReason: 'An error.' },
  ])('rejects missing authoring evidence', (proof) => {
    expect(() => parseWritingAuthoringProof(proof, 'correction', 'Er ist gekocht.')).toThrow();
  });
});
