import { describe, expect, it } from 'vitest';
import {
  placementConfirmRequestSchema,
  placementSubmitRequestSchema,
  placementGenerateRequestSchema,
  materialFocusAnalysisRetryRequestSchema,
  materialFocusAnalysisRetryResponseSchema,
} from '@sotto/shared';
const id = '123e4567-e89b-42d3-a456-426614174000',
  sha = 'a'.repeat(64);
describe('exact placement receipt transport', () => {
  it('requires the entire source identity together and never accepts only a language pair', () => {
    expect(() => placementConfirmRequestSchema.parse({ native: 'en', target: 'de' })).toThrow();
    expect(() =>
      placementGenerateRequestSchema.parse({
        native: 'en',
        target: 'de',
        requestId: id,
        analysisId: id,
      })
    ).toThrow('together');
    expect(
      placementConfirmRequestSchema.parse({
        requestId: id,
        native: 'en',
        target: 'de',
        analysisId: id,
        analysisRevision: 1,
        resultDigest: sha,
      }).acceptPartial
    ).toBe(false);
  });
  it('rejects duplicate answers and absent frozen quiz identity', () => {
    const input = {
      requestId: id,
      native: 'en',
      target: 'de',
      placementSessionId: id,
      questionsDigest: sha,
      answers: Array.from({ length: 6 }, (_, index) => ({ id: `pq_${index}`, selectedIndex: 4 })),
    };
    expect(placementSubmitRequestSchema.parse(input).answers).toHaveLength(6);
    expect(() =>
      placementSubmitRequestSchema.parse({ ...input, questionsDigest: undefined })
    ).toThrow();
    expect(() =>
      placementSubmitRequestSchema.parse({
        ...input,
        answers: input.answers.map(() => input.answers[0]),
      })
    ).toThrow('once');
    expect(() => placementSubmitRequestSchema.parse({ ...input, mastered: true })).toThrow();
  });
  it('pins an explicit retry to its observed immutable revision and distinguishes inherited work counts', () => {
    expect(
      materialFocusAnalysisRetryRequestSchema.parse({
        schemaVersion: 1,
        requestId: id,
        analysisRevision: 1,
        identityDigest: null,
        resultDigest: null,
      }).identityDigest
    ).toBeNull();
    expect(() =>
      materialFocusAnalysisRetryRequestSchema.parse({
        schemaVersion: 1,
        requestId: id,
        analysisRevision: 1,
      })
    ).toThrow();
    expect(
      materialFocusAnalysisRetryResponseSchema.parse({
        analysisId: id,
        analysisRevision: 1,
        status: 'RUNNING',
        identityDigest: null,
        resultDigest: null,
        statusUrl: `/api/v1/material-analyses/${id}`,
        retryOfAnalysisId: id,
        counts: { inherited: 3, analyzed: 2, offlineReplay: 1, failed: 1, unstarted: 0 },
      }).counts.offlineReplay
    ).toBe(1);
    expect(() =>
      materialFocusAnalysisRetryResponseSchema.parse({
        analysisId: id,
        analysisRevision: 1,
        status: 'RUNNING',
        identityDigest: null,
        resultDigest: null,
        statusUrl: 'owned',
        retryOfAnalysisId: id,
        counts: { inherited: -1, analyzed: 0, offlineReplay: 0, failed: 0, unstarted: 0 },
      })
    ).toThrow();
  });
});
