import { describe, expect, it } from 'vitest';
import { placementSourceStatusSchema } from '../src/placement/contracts';

describe('retained source placement status transport', () => {
  const status = {
    analysisId: 'd1438bc6-a9a6-4c4a-bf12-e7b11c79110b',
    analysisRevision: 3,
    status: 'PARTIAL',
    identityDigest: 'f'.repeat(64),
    resultDigest: 'e'.repeat(64),
    statusUrl: '/api/v1/material-analyses/d1438bc6-a9a6-4c4a-bf12-e7b11c79110b',
    native: 'en',
    target: 'de',
    stale: false,
    failureReason: null,
    summary: {
      focusCount: 2,
      exposureOnly: true,
      inference: {
        level: 'B1',
        confidence: 0.75,
        rationale: 'Contains past tense clauses.',
        levelRange: { from: 'A2', to: 'B1' },
        source: 'MATERIAL_FOCUS_INFERENCE',
        originalContentComplete: false,
      },
    },
  };
  it('preserves exact revision, inference and partial source coverage', () => {
    const parsed = placementSourceStatusSchema.parse(status);
    expect(parsed.analysisRevision).toBe(3);
    expect(parsed.resultDigest).toBe('e'.repeat(64));
    expect(parsed.summary?.inference?.originalContentComplete).toBe(false);
    expect(parsed.summary?.focusCount).toBe(2);
  });
  it('retains nullable pending receipts and rejects malformed source identities', () => {
    expect(
      placementSourceStatusSchema.parse({
        ...status,
        status: 'RUNNING',
        identityDigest: null,
        resultDigest: null,
        summary: null,
      }).summary
    ).toBeNull();
    expect(() => placementSourceStatusSchema.parse({ ...status, analysisRevision: 0 })).toThrow();
    expect(() =>
      placementSourceStatusSchema.parse({ ...status, resultDigest: 'unbound' })
    ).toThrow();
  });
});
