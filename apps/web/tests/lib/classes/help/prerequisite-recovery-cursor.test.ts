import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { previousPrerequisiteUuid } from '@/lib/classes/help/prerequisite-recovery-cursor';

describe('prerequisite recovery cursor', () => {
  it.each([
    ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000'],
    ['00000000-0000-4000-8001-000000000000', '00000000-0000-4000-8000-ffffffffffff'],
    ['00000000-0000-4000-9000-000000000000', '00000000-0000-4000-8fff-ffffffffffff'],
    ['00000000-0000-4001-8000-000000000000', '00000000-0000-4000-bfff-ffffffffffff'],
    ['00000001-0000-4000-8000-000000000000', '00000000-ffff-4fff-bfff-ffffffffffff'],
  ])('uses a valid lower bound for %s', (id, expected) => {
    const cursor = previousPrerequisiteUuid(id);
    expect(cursor).toBe(expected);
    expect(z.uuid().safeParse(cursor).success).toBe(true);
    expect(cursor! < id).toBe(true);
  });

  it.each([
    '00000000-0000-4000-8000-000000000000',
    'AAAAAAAA-0000-4000-8000-000000000000',
    '00000000-0000-7000-8000-000000000000',
    'invalid',
  ])('starts from the beginning when no v4 lower bound is known for %s', (id) => {
    expect(previousPrerequisiteUuid(id)).toBeNull();
  });
});
