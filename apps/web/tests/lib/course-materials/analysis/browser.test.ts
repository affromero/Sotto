import { afterEach, describe, expect, it, vi } from 'vitest';
import { partialMaterialCoverage } from '../../../helpers/materials/analysis';
import {
  analyzePlacementMaterials,
  materialPlacementReference,
  retryMaterialAnalysisRequest,
  type MaterialPlacementCheckpoint,
} from '@/lib/course-materials/client/analysis';

const analysisId = 'bc0e71a2-2709-42b9-a4f8-330e89e912dc';
const resultDigest = 'a'.repeat(64);
const result = {
  analysisId,
  analysisRevision: 1,
  status: 'COMPLETE',
  resultDigest,
  summary: {
    focusCount: 2,
    inference: {
      level: 'A2' as const,
      confidence: 0.6,
      rationale: 'Specific mapped source focuses.',
    },
  },
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
afterEach(() => vi.unstubAllGlobals());
describe('profile-bound material analysis browser transport', () => {
  it('reuses explicit retry identity and observed frozen receipts across network resubmission', async () => {
    const requestId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const identityDigest = 'b'.repeat(64);
    const retryResult = {
      analysisId: childId,
      analysisRevision: 1,
      status: 'RUNNING',
      identityDigest,
      resultDigest: null,
      statusUrl: `/api/v1/material-analyses/${childId}`,
      retryOfAnalysisId: analysisId,
      counts: { inherited: 4, analyzed: 3, offlineReplay: 1, failed: 1, unstarted: 0 },
    };
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic network interruption'))
      .mockResolvedValueOnce(json(retryResult, 202));
    vi.stubGlobal('fetch', fetch);
    const input = {
      analysis: { ...result, status: 'PARTIAL', identityDigest },
      requestId,
      signal: new AbortController().signal,
    };
    await expect(retryMaterialAnalysisRequest(input)).rejects.toThrow(
      'Synthetic network interruption'
    );
    expect(await retryMaterialAnalysisRequest(input)).toEqual(retryResult);
    for (const call of fetch.mock.calls)
      expect(JSON.parse(call[1].body)).toEqual({
        schemaVersion: 1,
        requestId,
        analysisRevision: 1,
        identityDigest,
        resultDigest,
      });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      `/api/v1/material-analyses/${analysisId}/retry`,
      `/api/v1/material-analyses/${analysisId}/retry`,
    ]);
  });
  it('requires an observed identity receipt before explicit retry admission', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      retryMaterialAnalysisRequest({
        analysis: result,
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Reload the analysis receipt');
    expect(fetch.mock.calls).toHaveLength(0);
  });
  it('sends exact source text and preserves the analysis receipt for confirmation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(
        json({ analysisId, analysisRevision: 1, status: 'WAITING_SOURCE', resultDigest: null }, 202)
      )
      .mockResolvedValueOnce(json(result));
    vi.stubGlobal('fetch', fetch);
    const content = '\uFEFFUntrimmed\0 source 😀 e\u0301\n';
    let checkpoint: MaterialPlacementCheckpoint | null = null;
    const output = await analyzePlacementMaterials({
      native: 'en',
      target: 'de',
      content,
      files: [],
      signal: new AbortController().signal,
      onCheckpoint: (value) => {
        checkpoint = value;
      },
    });
    const submitted: unknown = JSON.parse(fetch.mock.calls[2][1].body);
    expect(submitted).toMatchObject({ content, native: 'en', target: 'de', materialIds: [] });
    expect(checkpoint).toMatchObject({ profileId: 'owner', analysisId });
    expect(materialPlacementReference(output, false)).toEqual({
      analysisId,
      analysisRevision: 1,
      resultDigest,
      acceptPartial: false,
    });
  });
  it('resumes the saved analysis after a network failure without another admission', async () => {
    let checkpoint: MaterialPlacementCheckpoint | null = null;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(
        json({ analysisId, analysisRevision: 1, status: 'RUNNING', resultDigest: null }, 202)
      )
      .mockRejectedValueOnce(new Error('Synthetic network interruption'));
    vi.stubGlobal('fetch', fetch);
    const input = {
      native: 'en',
      target: 'de',
      content: 'Source text',
      files: [],
      signal: new AbortController().signal,
      onCheckpoint: (value: MaterialPlacementCheckpoint) => {
        checkpoint = value;
      },
    };
    await expect(analyzePlacementMaterials(input)).rejects.toThrow(
      'Synthetic network interruption'
    );
    fetch.mockResolvedValueOnce(json({ id: 'owner' })).mockResolvedValueOnce(json(result));
    expect((await analyzePlacementMaterials({ ...input, checkpoint })).analysisId).toBe(analysisId);
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('rejects another profile before reusing an upload or analysis checkpoint', async () => {
    const checkpoint: MaterialPlacementCheckpoint = {
      profileId: 'original-owner',
      native: 'en',
      target: 'de',
      content: 'Owned source',
      requestId: crypto.randomUUID(),
      files: [],
      upload: null,
      analysisId,
    };
    const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'different-owner' }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      analyzePlacementMaterials({
        native: 'en',
        target: 'de',
        content: checkpoint.content,
        files: [],
        checkpoint,
        signal: new AbortController().signal,
        onCheckpoint: () => {},
      })
    ).rejects.toThrow('active profile changed');
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  });
  it('checks profile ownership again immediately before admitting the source', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(json({ id: 'changed-owner' }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      analyzePlacementMaterials({
        native: 'en',
        target: 'de',
        content: 'Source',
        files: [],
        signal: new AbortController().signal,
        onCheckpoint: () => {},
      })
    ).rejects.toThrow('active profile changed');
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  });
  it('requires explicit partial coverage acceptance and refuses incomplete result receipts', () => {
    expect(() => materialPlacementReference({ ...result, status: 'PARTIAL' }, false)).toThrow(
      'Review and accept'
    );
    expect(
      materialPlacementReference(
        { ...result, status: 'PARTIAL', coverage: partialMaterialCoverage },
        true
      ).acceptPartial
    ).toBe(true);
    expect(() => materialPlacementReference({ ...result, resultDigest: null }, true)).toThrow(
      'no usable completed receipt'
    );
  });
  it('surfaces retained unknown outcomes and never replaces their analysis identity', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(json({ id: 'owner' }))
      .mockResolvedValueOnce(
        json({ analysisId, analysisRevision: 1, status: 'RUNNING', resultDigest: null }, 202)
      )
      .mockResolvedValueOnce(
        json({
          analysisId,
          analysisRevision: 1,
          status: 'RECOVERY_REQUIRED',
          resultDigest: null,
          failureReason: 'Provider outcome unknown.',
        })
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      analyzePlacementMaterials({
        native: 'en',
        target: 'de',
        content: 'Source',
        files: [],
        signal: new AbortController().signal,
        onCheckpoint: () => {},
      })
    ).rejects.toThrow('Provider outcome unknown.');
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });
});
