import { expect, it } from 'vitest';
import { targetFingerprint } from '@/lib/classes/regeneration/target-fingerprint';

it('preserves the identity of an already saved class preparation target', () => {
  const target = {
    id: 'class',
    courseId: 'course',
    lessonId: 'lesson',
    createdAt: new Date(0),
    sourceUrl: null,
    sourceTitle: 'Source',
  };
  expect(targetFingerprint(target)).toBe(
    'a00968b545576ff4877def4d03be5b8b5bfa8809acd9258ec20b003dcf81938c'
  );
  expect(targetFingerprint({ ...target, sourceTitle: 'Changed' })).not.toBe(
    targetFingerprint(target)
  );
});
