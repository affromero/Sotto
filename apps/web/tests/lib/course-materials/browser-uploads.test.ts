import { UploadServer } from '../../helpers/materials/uploads';
// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialUploadLimits } from '@sotto/shared';
import {
  createMaterialUploadClientState,
  uploadMaterialFiles,
  MaterialUploadClientError,
  type MaterialUploadClientFile,
  type MaterialUploadClientState,
  type MaterialUploadClientProgress,
} from '@/lib/course-materials/client/uploads';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const json = (value: unknown, status = 200) => Response.json(structuredClone(value), { status });
const input = (contents = 'abc', clientId = id(1)): MaterialUploadClientFile => ({
  clientId,
  file: new File([contents], 'notes.txt', { type: 'text/plain' }),
});

function run(
  server: UploadServer,
  files: MaterialUploadClientFile[],
  state = createMaterialUploadClientState(files, { requestId: id(3) }),
  extras: Partial<Parameters<typeof uploadMaterialFiles>[0]> = {}
) {
  return uploadMaterialFiles({
    files,
    state,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 10_000,
    pollIntervalMs: 1,
    fetch: server.fetch,
    ...extras,
  });
}
async function interrupted(promise: Promise<unknown>): Promise<MaterialUploadClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MaterialUploadClientError);
    return error as MaterialUploadClientError;
  }
  throw new Error('Expected an interrupted upload.');
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('bounded resumable material browser uploads', () => {
  it('asserts the captured profile on every upload request without changing the semantic declaration', async () => {
    const server = new UploadServer();
    const files = [input()];
    const state = createMaterialUploadClientState(files, { expectedProfileId: 'captured-learner' });
    const saved = structuredClone(state);
    const methods = new Set<string>();
    const result = await run(server, files, state, {
      fetch: async (url, init) => {
        expect(new Headers(init?.headers).get('x-sotto-expected-profile-id')).toBe(
          'captured-learner'
        );
        methods.add(init?.method ?? 'GET');
        if (String(url) === '/api/v1/materials/uploads')
          expect(JSON.parse(String(init?.body))).not.toHaveProperty('expectedProfileId');
        return server.fetch(url, init);
      },
    });
    expect(methods).toEqual(new Set(['POST', 'GET', 'PUT']));
    expect(result.expectedProfileId).toBe('captured-learner');
    expect(state).toEqual(saved);
  });
  it('publishes receipts and reports file IDs and committed bytes without mutating caller state', async () => {
    const server = new UploadServer();
    const files = [input()];
    const state = createMaterialUploadClientState(files, {
      requestId: id(3),
      courseId: 'course/owned',
    });
    const original = structuredClone(state);
    const progress: MaterialUploadClientProgress[] = [];
    const checkpoints: MaterialUploadClientState[] = [];
    const result = await run(server, files, state, {
      onProgress: (item) => progress.push(item),
      onState: (item) => checkpoints.push(item),
    });
    expect(result.batch.uploads[0]).toMatchObject({
      status: 'COMPLETE',
      materialId: id(100),
    });
    expect(result.batch.uploads[0]!.original?.byteSize).toBe(3);
    expect(server.courseId).toBe('course/owned');
    expect(progress.at(-1)).toMatchObject({
      phase: 'COMPLETE',
      clientId: id(1),
      uploadId: id(10),
      materialId: id(100),
      fileVerifiedBytes: 3,
      fileUploadedBytes: 3,
      batchUploadedBytes: 3,
    });
    expect(checkpoints.some((item) => item.completions.length === 1)).toBe(true);
    expect(state).toEqual(original);
    checkpoints[0]!.request.files[0]!.name = 'caller-changed';
    expect(result.request.files[0]!.name).toBe('notes.txt');
  });
  it('bounds reads to 4 MiB slices for a 46,880,440-byte file', async () => {
    const reads: number[] = [];
    class LargeFile extends File {
      override get size() {
        return 46_880_440;
      }
      override arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error('Whole-file buffering is forbidden.');
      }
      override slice(start = 0, end = this.size) {
        reads.push(end - start);
        return new Blob([new Uint8Array(end - start)]);
      }
    }
    const files = [
      {
        clientId: id(1),
        file: new LargeFile([], 'large.pdf', { type: 'application/pdf' }),
      },
    ];
    const server = new UploadServer();
    const result = await run(server, files);
    expect(reads).toHaveLength(12);
    expect(Math.max(...reads)).toBe(materialUploadLimits.partBytes);
    expect(reads.at(-1)).toBe(743_096);
    expect(reads.reduce((total, bytes) => total + bytes, 0)).toBe(46_880_440);
    expect(server.partReads).toEqual(reads);
    expect(result.batch.uploads[0]!.original?.byteSize).toBe(46_880_440);
  });
  it('resumes after a committed part response is lost without resending that part', async () => {
    const server = new UploadServer();
    server.losePart = true;
    const files = [input()];
    const error = await interrupted(run(server, files));
    expect(error.code).toBe('NETWORK');
    expect(error.state.batch?.uploads[0]!.uploadId).toBe(id(10));
    expect(error.state.partIdentities).toHaveLength(1);
    const result = await run(server, files, error.state);
    expect(result.batch.uploads[0]!.status).toBe('COMPLETE');
    expect(server.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(1);
    expect(server.calls.filter((call) => call === 'POST /api/v1/materials/uploads')).toHaveLength(
      1
    );
  });
  it('replays a lost admission response with the same batch request identity', async () => {
    const server = new UploadServer();
    server.loseAdmission = true;
    const files = [input()];
    const error = await interrupted(run(server, files));
    expect(error.state.batch).toBeNull();
    expect(error.state.request.requestId).toBe(id(3));
    const result = await run(server, files, error.state);
    expect(result.batch.batchId).toBe(id(2));
    expect(server.calls.filter((call) => call === 'POST /api/v1/materials/uploads')).toHaveLength(
      2
    );
  });
  it('rehashes committed local parts and rejects same-name same-size changed content', async () => {
    const server = new UploadServer();
    server.losePart = true;
    const error = await interrupted(run(server, [input('abc')]));
    // Simulate caller retaining only server receipts rather than cached local hashes.
    error.state.partIdentities = [];
    error.state.batch = structuredClone(server.batch);
    const changed = await interrupted(run(server, [input('xyz')], error.state));
    expect(changed.code).toBe('FILE_CHANGED');
    expect(server.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(1);
    expect(server.completionBodies).toEqual([]);
  });
  it('rehashes already complete uploads using saved part identities after server part cleanup', async () => {
    const server = new UploadServer();
    const files = [input()];
    const completed = await run(server, files);
    expect(completed.batch.uploads[0]!.parts).toEqual([]);
    const replay = await run(server, files, completed);
    expect(replay.batch.uploads[0]!.original).toEqual(completed.batch.uploads[0]!.original);
    expect(server.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(1);
    expect(server.completionBodies).toHaveLength(1);
    const changed = await interrupted(run(server, [input('xyz')], completed));
    expect(changed.code).toBe('FILE_CHANGED');
  });
  it('refuses to claim local identity when completed receipts and saved part checksums are both absent', async () => {
    const server = new UploadServer();
    const files = [input()];
    const completed = await run(server, files);
    const error = await interrupted(run(server, files, { ...completed, partIdentities: [] }));
    expect(error.code).toBe('STATE');
    expect(error.message).toContain('no saved checksum');
  });
  it('surfaces an HTTP part failure without automatic retry and keeps admission IDs', async () => {
    const server = new UploadServer();
    server.partStatus = 503;
    const error = await interrupted(run(server, [input()]));
    expect(error).toMatchObject({ code: 'HTTP', httpStatus: 503 });
    expect(error.state.batch?.batchId).toBe(id(2));
    expect(server.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(1);
  });
  it('resumes finalization after a lost completion response without another completion POST', async () => {
    const server = new UploadServer();
    server.loseCompletion = true;
    const files = [input()];
    const error = await interrupted(run(server, files));
    expect(error.state.completions).toHaveLength(1);
    const result = await run(server, files, error.state);
    expect(result.batch.uploads[0]!.status).toBe('COMPLETE');
    expect(server.completionBodies).toHaveLength(1);
  });
  it('reuses the saved completion request identity after interruption before admission', async () => {
    const server = new UploadServer();
    server.failCompletionBeforeCommit = true;
    const files = [input()];
    const error = await interrupted(run(server, files));
    const requestId = error.state.completions[0]!.request.requestId;
    await run(server, files, error.state);
    expect(server.completionBodies.map((body) => body.requestId)).toEqual([requestId, requestId]);
  });
  it('preserves finalization receipt IDs on a polling failure and can resume polling', async () => {
    const server = new UploadServer();
    server.failPoll = true;
    const files = [input()];
    const error = await interrupted(run(server, files));
    expect(error).toMatchObject({ code: 'HTTP', httpStatus: 503 });
    expect(error.state.batch?.uploads[0]!.status).toBe('FINALIZING');
    expect((await run(server, files, error.state)).batch.uploads[0]!.status).toBe('COMPLETE');
    expect(server.completionBodies).toHaveLength(1);
  });
  it('handles multiple declared files sequentially and reports aggregate committed bytes', async () => {
    const server = new UploadServer();
    const files = [input('abc'), input('defg', id(4))];
    const progress: MaterialUploadClientProgress[] = [];
    const result = await run(server, files, undefined, {
      onProgress: (item) => progress.push(item),
    });
    expect(result.batch.uploads.map((upload) => upload.status)).toEqual(['COMPLETE', 'COMPLETE']);
    expect(
      progress.filter((item) => item.phase === 'COMPLETE').map((item) => item.batchUploadedBytes)
    ).toEqual([3, 7]);
    expect(server.partReads).toEqual([3, 4]);
    expect(server.calls.filter((call) => call === 'POST /api/v1/materials/uploads')).toHaveLength(
      1
    );
    const firstComplete = server.calls.indexOf(`POST /api/v1/materials/uploads/${id(10)}/complete`);
    const secondPut = server.calls.indexOf(`PUT /api/v1/materials/uploads/${id(11)}/parts/0`);
    expect(secondPut).toBeGreaterThan(firstComplete);
  });
  it('cancels before any dispatch and preserves the caller request identity', async () => {
    const controller = new AbortController();
    controller.abort();
    const server = new UploadServer();
    const error = await interrupted(
      run(server, [input()], undefined, { signal: controller.signal })
    );
    expect(error.code).toBe('CANCELLED');
    expect(error.state.request.requestId).toBe(id(3));
    expect(server.calls).toEqual([]);
  });
  it('cancels an in-flight fetch with saved admitted IDs', async () => {
    const server = new UploadServer();
    const files = [input()];
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = async (url, init) => {
      if (init?.method !== 'PUT') return server.fetch(url, init);
      controller.abort(new DOMException('Learner cancelled.', 'AbortError'));
      return new Promise((_, reject) => reject(init.signal?.reason));
    };
    const error = await interrupted(
      run(server, files, undefined, { fetch, signal: controller.signal })
    );
    expect(error.code).toBe('CANCELLED');
    expect(error.state.batch?.uploads[0]!.materialId).toBe(id(100));
    expect(error.state.partIdentities).toHaveLength(1);
  });
  it('enforces a deadline even when finalization keeps returning pending', async () => {
    const server = new UploadServer();
    server.neverFinish = true;
    const error = await interrupted(
      run(server, [input()], undefined, { deadlineAt: Date.now() + 30 })
    );
    expect(error.code).toBe('DEADLINE');
    expect(error.state.batch?.uploads[0]!.status).toBe('FINALIZING');
    expect(server.completionBodies).toHaveLength(1);
  });
  it('enforces the deadline when the transport ignores cancellation', async () => {
    const server = new UploadServer();
    const error = await interrupted(
      run(server, [input()], undefined, {
        fetch: async () => new Promise(() => {}),
        deadlineAt: Date.now() + 5,
      })
    );
    expect(error.code).toBe('DEADLINE');
    expect(error.state.request.requestId).toBe(id(3));
  });
  it('rejects changed server identities and terminal failed states', async () => {
    const server = new UploadServer();
    server.mutateGet = (upload) => {
      upload.materialId = id(999);
    };
    expect((await interrupted(run(server, [input()]))).code).toBe('PROTOCOL');
    const failed = new UploadServer();
    failed.mutateGet = (upload) => {
      upload.status = 'EXPIRED';
    };
    expect((await interrupted(run(failed, [input()]))).code).toBe('STATE');
  });
  it('surfaces malformed and oversized metadata responses with a resumable checkpoint', async () => {
    const malformed = await interrupted(
      run(new UploadServer(), [input()], undefined, {
        fetch: async () => new Response('{invalid'),
      })
    );
    expect(malformed.code).toBe('PROTOCOL');
    const oversized = await interrupted(
      run(new UploadServer(), [input()], undefined, {
        fetch: async () => new Response('x'.repeat(256 * 1024 + 1)),
      })
    );
    expect(oversized.code).toBe('PROTOCOL');
    expect(oversized.state.request.requestId).toBe(id(3));
  });
  it('accepts synchronous original publication returned as HTTP 200 from completion', async () => {
    const server = new UploadServer();
    server.finishDirectly = true;
    const result = await run(server, [input()]);
    expect(result.batch.uploads[0]!.status).toBe('COMPLETE');
    expect(result.batch.uploads[0]!.original?.materialId).toBe(id(100));
    expect(server.calls.filter((call) => call.startsWith('GET'))).toHaveLength(1);
  });
  it('does not adopt a mismatched batch receipt into its saved resume state', async () => {
    const server = new UploadServer();
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const response = await server.fetch(url, init);
      const batch = await response.json();
      batch.requestId = id(999);
      return json(batch);
    };
    const error = await interrupted(run(server, [input()], undefined, { fetch }));
    expect(error.code).toBe('PROTOCOL');
    expect(error.state.batch).toBeNull();
    expect(error.state.request.requestId).toBe(id(3));
  });
  it('rejects a saved completion identity from another batch before sending completion', async () => {
    const server = new UploadServer();
    server.losePart = true;
    const files = [input()];
    const error = await interrupted(run(server, files));
    error.state.completions.push({
      uploadId: id(999),
      request: { schemaVersion: 1, requestId: id(998), expectedRevision: 1 },
    });
    expect((await interrupted(run(server, files, error.state))).code).toBe('STATE');
    expect(server.completionBodies).toEqual([]);
  });
  it('bounds a hanging metadata response body by the overall deadline', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start() {},
          cancel() {
            return new Promise(() => {});
          },
        })
      );
    const error = await interrupted(
      run(new UploadServer(), [input()], undefined, {
        fetch,
        deadlineAt: Date.now() + 5,
      })
    );
    expect(error.code).toBe('DEADLINE');
  });
});
