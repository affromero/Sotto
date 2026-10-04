import { describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { SectionQualityError } from '@/lib/classes/section-quality';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import {
  captureGenerationFailure,
  classifyGenerationFailure,
  generationCleanupUnconfirmed,
  retainParallelGenerationFailures,
} from '@/lib/classes/quality/generation-failure';
import { captureTeachingFailure } from '@/lib/classes/quality/teaching-failure';

describe('terminal generation failure classification', () => {
  it('retains every settled FULL stage privately while preserving the original error and cleanup flag', () => {
    const evidence = captureTeachingFailure('writing', [{ task: 'Private writing task.' }], {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['Private teaching feedback.'],
        },
      ],
    });
    const original = new TeachingQualityRejectionError(['incorrect'], [], evidence);
    retainParallelGenerationFailures(
      original,
      [
        { stage: 'grammar', error: original },
        { stage: 'reading', error: new ReviewerProtocolError() },
        { stage: 'listening', error: new Error('Private provider transport diagnostic.') },
        {
          stage: 'writing',
          error: new Prisma.PrismaClientKnownRequestError('Private database diagnostic.', {
            clientVersion: 'fixture',
            code: 'P2034',
          }),
        },
      ],
      true
    );
    const captured = captureGenerationFailure(original);
    expect(captured.stages).toEqual([
      { stage: 'grammar', category: 'teaching_rejected', teachingFailure: evidence },
      { stage: 'reading', category: 'review_protocol' },
      { stage: 'listening', category: 'generation_failed' },
      { stage: 'writing', category: 'database_conflict' },
    ]);
    expect(captureGenerationFailure(original)).toEqual(captured);
    expect(generationCleanupUnconfirmed(original)).toBe(true);
    expect(original).toBeInstanceOf(TeachingQualityRejectionError);
    expect(JSON.stringify(original)).not.toContain('Private');
    expect(JSON.stringify(original)).not.toContain('stages');
    expect(JSON.stringify(captured)).not.toContain('Private provider transport diagnostic.');
    expect(JSON.stringify(captured)).not.toContain('Private database diagnostic.');
    expect(captureGenerationFailure(new TeachingQualityRejectionError()).stages).toBeUndefined();
  });

  it('keeps primitive rejections generic without inventing a shared identity', () => {
    retainParallelGenerationFailures('Private transport text.', [], false);
    expect(captureGenerationFailure('Private transport text.')).toEqual({
      category: 'generation_failed',
    });
    expect(generationCleanupUnconfirmed('Private transport text.')).toBe(false);
  });
  it.each([
    [new TeachingQualityRejectionError(['incorrect']), 'teaching_rejected'],
    [new ReviewerProtocolError(), 'review_protocol'],
    [new SectionQualityError(), 'section_quality'],
  ])('preserves the specific trusted quality failure %s', (error, category) => {
    expect(classifyGenerationFailure(error)).toBe(category);
  });

  it.each([
    ['P2034', undefined],
    ['P2010', { code: '40001' }],
    ['P2010', { code: '40P01' }],
  ])('recognizes a typed database transaction conflict %s', (code, meta) => {
    const error = new Prisma.PrismaClientKnownRequestError('Private database diagnostic.', {
      clientVersion: 'fixture',
      code,
      meta,
    });
    expect(classifyGenerationFailure(error)).toBe('database_conflict');
  });

  it.each([
    new Error('Private provider transport says P2034, 40001, TeachingQualityRejectionError.'),
    { name: 'TeachingQualityRejectionError', code: 'P2034', meta: { code: '40001' } },
    new Prisma.PrismaClientKnownRequestError('Private database error says 40001.', {
      clientVersion: 'fixture',
      code: 'P2010',
      meta: { code: '42501' },
    }),
    new Prisma.PrismaClientKnownRequestError('Private database diagnostic.', {
      clientVersion: 'fixture',
      code: 'P2002',
    }),
    new Prisma.PrismaClientKnownRequestError('Private database diagnostic.', {
      clientVersion: 'fixture',
      code: 'P2010',
      meta: { code: { toString: () => '40001' } },
    }),
    undefined,
  ])('keeps unproven diagnostics generic instead of guessing from text', (error) => {
    expect(classifyGenerationFailure(error)).toBe('generation_failed');
  });
});
