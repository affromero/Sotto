import { describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { SectionQualityError, captureBlindSectionFailure } from '@/lib/classes/section-quality';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import {
  captureGenerationFailure,
  classifyGenerationFailure,
  generationCleanupUnconfirmed,
  retainParallelGenerationFailures,
  generationFailureSchema,
} from '@/lib/classes/quality/generation-failure';
import {
  captureTeachingFailure,
  retainTeachingFailure,
} from '@/lib/classes/quality/teaching-failure';
import {
  captureStructureAttempt,
  captureTeachingAttempt,
  generationAttemptFailuresSchema,
  recordGenerationAttemptFailures,
} from '@/lib/classes/quality/generation-structure';

describe('terminal generation failure classification', () => {
  it('never snapshots protocol diagnostics supplied as an unauthenticated error property', () => {
    const error = Object.assign(new ReviewerProtocolError(), {
      protocolEvidence: [{ role: 'critic', response: 'Private forged provider response.' }],
    });
    expect(captureGenerationFailure(error)).toEqual({ category: 'review_protocol' });
    expect(JSON.stringify(captureGenerationFailure(error))).not.toContain('Private');
    expect(
      generationFailureSchema.safeParse({
        category: 'review_protocol',
        protocolEvidence: [
          {
            kind: 'speaking',
            role: 'critic',
            offset: 0,
            reason: 'schema',
            pathCodes: ['response'],
            payload: { json: null, byteCount: 1, sha256: 'a'.repeat(64), omitted: 'size_limit' },
          },
        ],
      }).success
    ).toBe(false);
  });
  it('keeps prior and final review evidence without reclassifying a terminal protocol error', () => {
    const first = captureTeachingFailure('intro', [{ about: 'Original teaching' }], {
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: ['First defect'] }],
    });
    const final = captureTeachingFailure('intro', [{ about: 'Replacement teaching' }], {
      items: [{ index: 0, acceptable: false, issues: ['unsupported'], feedback: ['Final defect'] }],
    });
    const error = new ReviewerProtocolError(final);
    const complete = { kind: first.kind, reviews: [...first.reviews, ...final.reviews] };
    retainTeachingFailure(error, complete);
    expect(captureGenerationFailure(error)).toEqual({
      category: 'review_protocol',
      teachingFailure: complete,
    });
    expect(error.teachingFailure).toEqual(final);
    expect(JSON.stringify(error)).not.toContain('Original teaching');
  });
  it('retains exact intro audit evidence when complete repair feedback exceeds its bound', () => {
    const evidence = captureTeachingFailure(
      'intro',
      [
        {
          introContext: { purpose: 'Private original intro.' },
          addresses: [{ field: 'purpose' }],
        },
      ],
      {
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['unnatural'],
            feedback: ['Private purpose feedback.'],
          },
        ],
      }
    );
    const error = new ReviewerProtocolError(evidence);

    expect(captureGenerationFailure(error)).toEqual({
      category: 'review_protocol',
      teachingFailure: evidence,
    });
    expect(JSON.stringify(error)).not.toContain('Private');
  });

  it('preserves exact blind evidence in settled FULL stages and the existing strict failure schema', () => {
    const evidence = captureBlindSectionFailure(
      [
        {
          question: 'Where did Lena go?',
          options: ['Hamburg', 'Bremen', 'Berlin', 'Kiel'],
          correctIndex: 0,
          explanation: 'Private audio states Hamburg.',
          passageText: 'Private immutable audio transcript.',
        },
      ],
      {
        passageAcceptable: true,
        passageFeedback: [],
        issues: [],
        questions: [{ index: 0, acceptableOptionIndices: [1], issues: ['incorrect'] }],
      }
    );
    const first = new TeachingQualityRejectionError(['incorrect']);
    const listening = new SectionQualityError('Listening rejected.', evidence);
    retainParallelGenerationFailures(
      first,
      [
        { stage: 'grammar', error: first },
        { stage: 'listening', error: listening },
      ],
      true
    );
    const captured = captureGenerationFailure(first);
    expect(captured.stages![1]).toEqual({
      stage: 'listening',
      category: 'section_quality',
      teachingFailure: evidence,
    });
    expect(generationFailureSchema.parse(captured)).toEqual(captured);
    expect(JSON.stringify(listening)).not.toContain('Private');
    expect(generationCleanupUnconfirmed(first)).toBe(true);
  });
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

  it('seals ordered actual shape and teaching attempts without exposing error text', () => {
    const teaching = captureTeachingFailure('speaking', [{ targetPhrase: 'Private phrase.' }], {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['Private teaching feedback.'],
        },
      ],
    });
    const error = new Error('Private provider response diagnostic.');
    recordGenerationAttemptFailures(error, [
      captureTeachingAttempt(1, teaching),
      captureStructureAttempt('speaking', 2, 'Private malformed output.', [
        { code: 'invalid_json' },
      ]),
    ]);

    const captured = captureGenerationFailure(error);
    expect(captured).toEqual({
      category: 'generation_failed',
      attemptFailures: [
        { attempt: 1, type: 'teaching', failure: teaching },
        {
          attempt: 2,
          type: 'structure',
          kind: 'speaking',
          candidate: 'Private malformed output.',
          issues: [{ code: 'invalid_json' }],
        },
      ],
    });
    expect(generationFailureSchema.parse(captured)).toEqual(captured);
    expect(JSON.stringify(error)).not.toContain('Private');
    expect(JSON.stringify(captured)).not.toContain('provider response diagnostic');
  });

  it('omits oversized malformed candidates while retaining static structural issues', () => {
    const error = new Error('Private response diagnostic.');
    recordGenerationAttemptFailures(error, [
      captureStructureAttempt('listening', 1, 'x'.repeat(32 * 1024 + 1), [{ code: 'wrong_count' }]),
    ]);

    expect(captureGenerationFailure(error).attemptFailures).toEqual([
      {
        attempt: 1,
        type: 'structure',
        kind: 'listening',
        candidate: null,
        omitted: 'size_limit',
        issues: [{ code: 'wrong_count' }],
      },
    ]);
    expect(JSON.stringify(error)).not.toContain('response diagnostic');
  });

  it('rejects out-of-order, excessive, or unbounded structural attempt evidence', () => {
    const first = captureStructureAttempt('speaking', 1, '{', [{ code: 'invalid_json' }]);
    const second = captureStructureAttempt('speaking', 2, '[]', [{ code: 'wrong_count' }]);

    expect(() => generationAttemptFailuresSchema.parse([second, first])).toThrow();
    expect(() => generationAttemptFailuresSchema.parse([first, second, second])).toThrow();
    expect(() =>
      generationAttemptFailuresSchema.parse([
        {
          attempt: 1,
          type: 'structure',
          kind: 'speaking',
          candidate: '{',
          issues: [{ code: 'invalid_json', index: 5 }],
        },
      ])
    ).toThrow();
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
