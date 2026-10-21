import { describe, expect, it } from 'vitest';
import { materialAnalysisCancellationResponseSchema } from '../../src/course-materials/cancellation';

const receipt = () => ({
  analysisId: '00000000-0000-4000-8000-000000000001',
  analysisRevision: 1,
  statusUrl: '/api/v1/material-analyses/00000000-0000-4000-8000-000000000001',
  status: 'CANCELLING',
  identityDigest: null,
  resultDigest: null,
  cancellation: {
    state: 'PENDING',
    verifiedUnits: 64,
    remainingUnits: 1,
    hasMore: true,
    blockers: ['VERIFICATION_PENDING'],
    operationId: '00000000-0000-4000-8000-000000000002',
    operatorRecoveryUrl: null,
  },
});
describe('material analysis cancellation continuation', () => {
  it('continues only bounded known-proof verification and stops at unresolved attempts', () => {
    expect(materialAnalysisCancellationResponseSchema.parse(receipt()).cancellation.hasMore).toBe(
      true
    );
    const blocked = receipt();
    blocked.cancellation.blockers = ['PROVIDER_UNKNOWN'];
    blocked.cancellation.hasMore = false;
    expect(materialAnalysisCancellationResponseSchema.parse(blocked).cancellation.blockers).toEqual(
      ['PROVIDER_UNKNOWN']
    );
    expect(
      materialAnalysisCancellationResponseSchema.safeParse({
        ...blocked,
        cancellation: { ...blocked.cancellation, hasMore: true },
      }).success
    ).toBe(false);
    expect(
      materialAnalysisCancellationResponseSchema.safeParse({ ...receipt(), status: 'RUNNING' })
        .success
    ).toBe(false);
  });
  it('requires complete verification before reporting cancellation', () => {
    const complete = {
      ...receipt(),
      status: 'CANCELLED',
      cancellation: {
        ...receipt().cancellation,
        state: 'CANCELLED',
        remainingUnits: 0,
        hasMore: false,
        blockers: [],
      },
    };
    expect(materialAnalysisCancellationResponseSchema.parse(complete).cancellation.state).toBe(
      'CANCELLED'
    );
    expect(
      materialAnalysisCancellationResponseSchema.safeParse({
        ...complete,
        cancellation: { ...complete.cancellation, remainingUnits: 1 },
      }).success
    ).toBe(false);
    expect(
      materialAnalysisCancellationResponseSchema.safeParse({
        ...complete,
        cancellation: { ...complete.cancellation, state: 'NOT_NEEDED' },
      }).success
    ).toBe(false);
  });
});
