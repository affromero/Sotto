import { describe, expect, it } from 'vitest';
import { classFocusAuthorizationMatches } from '@/components/learn/lesson/classFocusAuthorization';
import { teaching } from './teaching-fixture';

const receiptId = '00000000-0000-4000-a000-000000000001';
const binding = {
  classId: 'class-1',
  attempt: 2,
  taskMaterialRevision: 'a'.repeat(64),
  replay: false,
};
const progress = {
  classId: 'class-1',
  status: 'IN_PROGRESS',
  attempt: 2,
  progressRevision: 5,
  taskMaterialRevision: 'a'.repeat(64),
};
const base = {
  kind: 'BASE',
  nativeLang: 'en',
  targetLang: 'de',
  receiptId,
  acknowledged: true,
  teaching: {
    version: teaching.version,
    title: teaching.title,
    explanation: teaching.explanation,
    workedExamples: teaching.workedExamples,
    commonMistake: teaching.commonMistake,
  },
};
const addendum = {
  kind: 'ADDENDUM',
  nativeLang: 'es',
  targetLang: 'ru',
  receiptId,
  acknowledged: true,
  status: 'READY',
  request: { sourceHash: 'b'.repeat(64), snapshotHash: 'c'.repeat(64) },
  content: {
    title: 'Pedir',
    explanation: 'Usa cortesía.',
    examples: [
      { target: 'Вода, пожалуйста', meaning: 'Agua, por favor', explanation: 'Una petición.' },
    ],
  },
};
const check = (
  originalPrelude: unknown,
  currentPrelude: unknown,
  currentProgress: unknown = progress,
  currentBinding: unknown = binding
) =>
  classFocusAuthorizationMatches({
    originalPrelude,
    currentPrelude,
    currentProgress,
    binding: currentBinding,
  });

describe('class focus authorization', () => {
  it('accepts only the same acknowledged lesson and active class identity', () => {
    expect(check(base, base)).toBe(true);
    expect(check(addendum, addendum)).toBe(true);
    expect(check({ kind: 'NOT_REQUIRED' }, { kind: 'NOT_REQUIRED' })).toBe(true);
    expect(check(base, base, { ...progress, progressRevision: 6 })).toBe(true);
  });

  it('rejects a different or unacknowledged receipt and changed teaching', () => {
    expect(check(base, { ...base, receiptId: '00000000-0000-4000-a000-000000000002' })).toBe(false);
    expect(check({ ...base, acknowledged: false }, base)).toBe(false);
    expect(check(base, { ...base, acknowledged: false })).toBe(false);
    expect(check(base, { ...base, teaching: { ...base.teaching, title: 'Changed' } })).toBe(false);
    expect(check({ kind: 'NOT_REQUIRED' }, base)).toBe(false);
    expect(
      check(addendum, { ...addendum, request: { ...addendum.request, sourceHash: 'd'.repeat(64) } })
    ).toBe(false);
    expect(
      check(addendum, {
        ...addendum,
        request: { ...addendum.request, snapshotHash: 'd'.repeat(64) },
      })
    ).toBe(false);
    expect(check(addendum, { ...addendum, acknowledged: false })).toBe(false);
  });

  it('rejects invalid or different class identity and non-editable status', () => {
    for (const current of [
      { ...progress, classId: 'other' },
      { ...progress, attempt: 3 },
      { ...progress, taskMaterialRevision: 'd'.repeat(64) },
      { ...progress, progressRevision: -1 },
      ...['LOCKED', 'GENERATING', 'SUBMITTED', 'PASSED', 'FAILED'].map((status) => ({
        ...progress,
        status,
      })),
      { ...progress, extra: 'unexpected' },
    ])
      expect(check(base, base, current)).toBe(false);
    expect(check(base, base, progress, { ...binding, attempt: 0 })).toBe(false);
    expect(check(base, base, progress, { ...binding, taskMaterialRevision: 'invalid' })).toBe(
      false
    );
    expect(check({ kind: 'UNAVAILABLE' }, { kind: 'UNAVAILABLE' })).toBe(false);
  });

  it('permits only read-only replay with a terminal class status', () => {
    const replay = { ...binding, replay: true };
    for (const status of ['SUBMITTED', 'PASSED', 'FAILED'])
      expect(check({ kind: 'REPLAY' }, { kind: 'REPLAY' }, { ...progress, status }, replay)).toBe(
        true
      );
    expect(check({ kind: 'REPLAY' }, { kind: 'REPLAY' }, progress, replay)).toBe(false);
    expect(check({ kind: 'REPLAY' }, { kind: 'REPLAY' }, { ...progress, status: 'PASSED' })).toBe(
      false
    );
    expect(check(base, base, { ...progress, status: 'PASSED' }, replay)).toBe(false);
  });
});
