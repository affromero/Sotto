import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  materialPlacementContentHash,
  readSavedMaterialPlacement,
  restoreMaterialPlacement,
  saveMaterialPlacement,
  saveMaterialPlacementConfirmation,
  saveMaterialPlacementRetry,
} from '@/lib/course-materials/client/placement-checkpoint';
import {
  analyzePlacementMaterials,
  openSavedMaterialAnalysis,
  type MaterialPlacementCheckpoint,
} from '@/lib/course-materials/client/analysis';
import { createMaterialUploadClientState } from '@/lib/course-materials/client/uploads';

const analysisId = '6ab93738-760d-4666-9e7c-f130628f0491';
const childId = '5141dfc3-0089-4122-bad2-4d96822bda30';
const requestId = '23f85cf9-a68b-4d30-837d-1196dcdb11bc';
const clientId = 'd10692ee-3004-426d-b141-e6353ca1cb1e';
const source = '\ufeffprivate pasted class\u0000😀';
const completed = {
  native: 'en',
  target: 'de',
  analysisId,
  analysisRevision: 1,
  identityDigest: 'a'.repeat(64),
  resultDigest: 'b'.repeat(64),
  status: 'COMPLETE',
  summary: {
    focusCount: 1,
    inference: { level: 'A2', rationale: 'Specific owned source focus.', confidence: 0.7 },
  },
};

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

function checkpoint(files: File[] = []): MaterialPlacementCheckpoint {
  return {
    profileId: 'learner-1',
    native: 'en',
    target: 'de',
    requestId,
    content: source,
    analysisId,
    files: files.map((file) => ({ clientId, name: file.name, size: file.size, type: file.type })),
    upload: files.length
      ? createMaterialUploadClientState(files.map((file) => ({ clientId, file })))
      : null,
  };
}

describe('profile-bound material placement resume', () => {
  it('retains original identities and checksums across reload without serializing source text or file bytes', async () => {
    const file = new File(['private file bytes'], 'course.pdf', { type: 'application/pdf' });
    const saved = checkpoint([file]);
    const sha = await materialPlacementContentHash(source);
    saveMaterialPlacement(saved, sha);
    const serialized = window.localStorage.getItem(window.localStorage.key(0)!);
    expect(serialized).not.toContain('private pasted class');
    expect(serialized).not.toContain('private file bytes');
    const restored = restoreMaterialPlacement({
      profileId: 'learner-1',
      native: 'en',
      target: 'de',
      content: source,
      contentSha256: sha,
      files: [file],
    });
    expect(restored).toEqual(saved);
    expect(readSavedMaterialPlacement('learner-1', 'en', 'es')).toBeNull();
    expect(readSavedMaterialPlacement('learner-2', 'en', 'de')).toBeNull();
  });

  it('starts a separate source identity when the exact pasted content or selected declarations differ', async () => {
    saveMaterialPlacement(checkpoint(), await materialPlacementContentHash(source));
    expect(
      restoreMaterialPlacement({
        profileId: 'learner-1',
        native: 'en',
        target: 'de',
        content: 'Changed',
        contentSha256: await materialPlacementContentHash('Changed'),
        files: [],
      })
    ).toBeNull();
    expect(
      restoreMaterialPlacement({
        profileId: 'learner-1',
        native: 'en',
        target: 'de',
        content: source,
        contentSha256: await materialPlacementContentHash(source),
        files: [new File(['new'], 'new.pdf')],
      })
    ).toBeNull();
  });

  it('reopens an admitted analysis after reload using only the owning profile and immutable analysis ID', async () => {
    saveMaterialPlacement(checkpoint(), await materialPlacementContentHash(source));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json(completed));
    vi.stubGlobal('fetch', fetch);
    const onSaved = vi.fn();
    const result = await openSavedMaterialAnalysis({
      native: 'en',
      target: 'de',
      signal: new AbortController().signal,
      onSaved,
    });
    expect(result.summary?.inference?.level).toBe('A2');
    expect(onSaved.mock.calls[0][0]).toMatchObject({
      profileId: 'learner-1',
      analysisId,
      contentSha256: await materialPlacementContentHash(source),
    });
    expect(fetch.mock.calls.map(([url, init]) => ({ url, method: init?.method ?? 'GET' }))).toEqual(
      [
        { url: '/api/v1/users/me', method: 'GET' },
        { url: `/api/v1/material-analyses/${analysisId}`, method: 'GET' },
      ]
    );
  });

  it('replays a lost source admission with the same request UUID and byte-exact content after reload', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockRejectedValueOnce(new TypeError('Synthetic lost acknowledgement'));
    vi.stubGlobal('fetch', fetch);
    const input = {
      native: 'en',
      target: 'de',
      content: source,
      files: [],
      signal: new AbortController().signal,
      onCheckpoint: vi.fn(),
    };
    await expect(analyzePlacementMaterials(input)).rejects.toThrow(
      'Synthetic lost acknowledgement'
    );
    fetch
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json(completed))
      .mockResolvedValueOnce(Response.json(completed));
    const result = await analyzePlacementMaterials({
      ...input,
      signal: new AbortController().signal,
    });
    expect(result.analysisId).toBe(analysisId);
    const admissions = fetch.mock.calls.filter(([url]) => url === '/api/v1/placement/from-notes');
    expect(admissions[0][1]?.body).toBe(admissions[1][1]?.body);
    expect(JSON.parse(String(admissions[1][1]?.body)).content).toBe(source);
  });

  it('requires original input to resume an admission without an acknowledged analysis ID', async () => {
    saveMaterialPlacement(
      { ...checkpoint(), analysisId: null },
      await materialPlacementContentHash(source)
    );
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 'learner-1' }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      openSavedMaterialAnalysis({
        native: 'en',
        target: 'de',
        signal: new AbortController().signal,
        onSaved: vi.fn(),
      })
    ).rejects.toThrow(/same original files/);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/users/me']);
  });

  it('rejects an owned analysis from another language pair before projecting or accepting an estimate', async () => {
    saveMaterialPlacement(checkpoint(), await materialPlacementContentHash(source));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
        .mockResolvedValueOnce(Response.json({ ...completed, target: 'es' }))
    );
    const onProjection = vi.fn();
    await expect(
      openSavedMaterialAnalysis({
        native: 'en',
        target: 'de',
        signal: new AbortController().signal,
        onSaved: vi.fn(),
        onProjection,
      })
    ).rejects.toThrow(/language pair/);
    expect(onProjection).not.toHaveBeenCalled();
  });

  it('keeps the confirmed partial decision and exact confirmation request together until a child retry replaces the source', async () => {
    saveMaterialPlacement(checkpoint(), await materialPlacementContentHash(source));
    const body = JSON.stringify({
      schemaVersion: 1,
      requestId,
      native: 'en',
      target: 'de',
      analysisId,
      analysisRevision: 1,
      resultDigest: 'b'.repeat(64),
      acceptPartial: true,
    });
    saveMaterialPlacementConfirmation('learner-1', 'en', 'de', body);
    expect(readSavedMaterialPlacement('learner-1', 'en', 'de')?.confirmation).toEqual({
      requestId,
      body,
    });
    expect(() => saveMaterialPlacementRetry('learner-1', 'en', 'de', childId, analysisId)).toThrow(
      /selection changed/
    );
    saveMaterialPlacementRetry('learner-1', 'en', 'de', analysisId, childId);
    expect(readSavedMaterialPlacement('learner-1', 'en', 'de')).toMatchObject({
      analysisId: childId,
      confirmation: null,
    });
  });
});
