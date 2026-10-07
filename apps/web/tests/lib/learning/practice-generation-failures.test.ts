// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  TeachingQualityRejectionError,
  ReviewerProtocolError,
} from '@/lib/classes/quality/teaching-quality';
import {
  captureGenerationFailure,
  generationCleanupUnconfirmed,
} from '@/lib/classes/quality/generation-failure';
import { recordFullPracticeFailures } from '@/lib/learning/practice-generation-failures';
import {
  captureStructureAttempt,
  recordGenerationAttemptFailures,
} from '@/lib/classes/quality/generation-structure';

describe('settled full practice failure visibility', () => {
  it('retains every rejected branch while keeping the first error identity unchanged', async () => {
    const first = new TeachingQualityRejectionError(['incorrect']);
    const results = await Promise.allSettled([
      Promise.reject(first),
      Promise.reject(new ReviewerProtocolError()),
      Promise.resolve('listening'),
      Promise.reject(new Error('private-provider-detail')),
    ]);
    const outcome = recordFullPracticeFailures(results);
    expect(results[0]).toEqual({ status: 'rejected', reason: first });
    expect(captureGenerationFailure(first)).toEqual(outcome);
    expect(outcome).toMatchObject({
      category: 'teaching_rejected',
      stages: [
        { stage: 'grammar', category: 'teaching_rejected' },
        { stage: 'reading', category: 'review_protocol' },
        { stage: 'writing', category: 'generation_failed' },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain('private-provider-detail');
  });

  it('forwards bounded attempt evidence into each strict full-practice stage', async () => {
    const grammar = new Error('private grammar provider detail');
    const listening = new Error('private listening provider detail');
    recordGenerationAttemptFailures(listening, [
      captureStructureAttempt('listening', 1, '{"incomplete":true}', [
        { code: 'invalid_item', index: 0 },
      ]),
    ]);
    const results = await Promise.allSettled([
      Promise.reject(grammar),
      Promise.resolve('reading'),
      Promise.reject(listening),
      Promise.resolve('writing'),
    ]);

    const outcome = recordFullPracticeFailures(results);

    expect(outcome?.stages).toEqual([
      { stage: 'grammar', category: 'generation_failed' },
      {
        stage: 'listening',
        category: 'generation_failed',
        attemptFailures: [
          {
            attempt: 1,
            type: 'structure',
            kind: 'listening',
            candidate: '{"incomplete":true}',
            issues: [{ code: 'invalid_item', index: 0 }],
          },
        ],
      },
    ]);
    expect(JSON.stringify(outcome)).not.toMatch(
      /private grammar provider detail|private listening provider detail/
    );
  });

  it.each(['typed', 'primitive'] as const)(
    'surfaces a later cleanup uncertainty after a %s first rejection',
    async (kind) => {
      const first =
        kind === 'typed'
          ? new TeachingQualityRejectionError(['incorrect'])
          : 'private-first-rejection';
      const cleanup = new Error('private-cleanup-detail');
      cleanup.name = 'ProviderCleanupError';
      let uncertain = false;
      const results = await Promise.allSettled([
        Promise.reject(first),
        Promise.resolve('reading'),
        Promise.reject(cleanup),
        Promise.resolve('writing'),
      ]);
      const outcome = recordFullPracticeFailures(results, () => {
        uncertain = true;
      });
      expect(uncertain).toBe(true);
      expect(results[0]).toEqual({ status: 'rejected', reason: first });
      expect(outcome?.stages).toMatchObject([{ stage: 'grammar' }, { stage: 'listening' }]);
      if (kind === 'typed') expect(generationCleanupUnconfirmed(first)).toBe(true);
      expect(JSON.stringify(outcome)).not.toMatch(/private-first-rejection|private-cleanup-detail/);
    }
  );
});
