import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';
import {
  materialUploadPartHeaders,
  type MaterialUploadBatchReceipt,
  type MaterialUploadBatchRequest,
} from '@sotto/shared';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown, status = 200) => Response.json(structuredClone(value), { status });

export class UploadServer {
  batch: MaterialUploadBatchReceipt | null = null;
  calls: string[] = [];
  partReads: number[] = [];
  completionBodies: { requestId: string; expectedRevision: number }[] = [];
  loseAdmission = false;
  losePart = false;
  loseCompletion = false;
  failCompletionBeforeCommit = false;
  failPoll = false;
  neverFinish = false;
  finishDirectly = false;
  partStatus = 200;
  courseId: string | null = null;
  mutateGet?: (upload: MaterialUploadBatchReceipt['uploads'][number]) => void;

  fetch: typeof fetch = vi.fn(async (request, init) => {
    const url = new URL(String(request), 'https://selfhost.example.com');
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}`);
    expect(init?.credentials).toBe('same-origin');
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (method === 'POST' && url.pathname === '/api/v1/materials/uploads') {
      const declaration = JSON.parse(String(init?.body)) as MaterialUploadBatchRequest;
      this.courseId = url.searchParams.get('courseId');
      if (!this.batch)
        this.batch = {
          schemaVersion: 1,
          batchId: id(2),
          requestId: declaration.requestId,
          uploads: declaration.files.map((file, index) => ({
            schemaVersion: 1,
            batchId: id(2),
            uploadId: id(10 + index),
            materialId: id(100 + index),
            limitsVersion: 1,
            file,
            status: 'UPLOADING',
            revision: 0,
            expiresAt: '2099-01-01T00:00:00.000Z',
            parts: [],
            original: null,
            failureReason: null,
          })),
        };
      expect(declaration.requestId).toBe(this.batch.requestId);
      if (this.loseAdmission) {
        this.loseAdmission = false;
        throw new TypeError('Admission response lost.');
      }
      return json(this.batch, 201);
    }
    const segments = url.pathname.split('/');
    const upload = this.batch?.uploads.find((item) => item.uploadId === segments[5]);
    if (!upload) return json({}, 404);
    if (method === 'PUT') {
      if (this.partStatus !== 200) return json({ error: 'Upload unavailable.' }, this.partStatus);
      const index = Number(segments[7]);
      const headers = new Headers(init?.headers);
      const body = init?.body;
      if (Object.prototype.toString.call(body) !== '[object ArrayBuffer]')
        throw new Error('Expected bounded ArrayBuffer body.');
      const chunk = body as ArrayBuffer;
      this.partReads.push(chunk.byteLength);
      const checksum = hash(new Uint8Array(chunk));
      expect(headers.get(materialUploadPartHeaders.sha256)).toBe(checksum);
      expect(Number(headers.get(materialUploadPartHeaders.byteSize))).toBe(chunk.byteLength);
      const existing = upload.parts.find((part) => part.index === index);
      if (existing) expect(existing.sha256).toBe(checksum);
      else {
        upload.parts.push({
          schemaVersion: 1,
          uploadId: upload.uploadId,
          index,
          offset: Number(headers.get(materialUploadPartHeaders.offset)),
          byteSize: chunk.byteLength,
          sha256: checksum,
          committedAt: '2026-10-20T12:00:00.000Z',
        });
        upload.revision += 1;
      }
      if (this.losePart) {
        this.losePart = false;
        throw new TypeError('Part response lost after commit.');
      }
      return json(upload);
    }
    if (method === 'POST' && segments[6] === 'complete') {
      const completion = JSON.parse(String(init?.body));
      this.completionBodies.push(completion);
      expect(completion.expectedRevision).toBe(upload.revision);
      if (this.failCompletionBeforeCommit) {
        this.failCompletionBeforeCommit = false;
        throw new TypeError('Completion dispatch interrupted.');
      }
      upload.status = 'FINALIZING';
      upload.revision += 1;
      if (this.loseCompletion) {
        this.loseCompletion = false;
        throw new TypeError('Completion response lost.');
      }
      if (this.finishDirectly) {
        upload.status = 'COMPLETE';
        upload.revision += 1;
        upload.original = {
          schemaVersion: 1,
          uploadId: upload.uploadId,
          materialId: upload.materialId,
          byteSize: upload.file.byteSize,
          sha256: 'f'.repeat(64),
          publishedAt: '2026-10-20T12:01:00.000Z',
        };
        upload.parts = [];
        return json(upload, 200);
      }
      return json(upload, 202);
    }
    if (method === 'GET') {
      if (upload.status === 'FINALIZING') {
        if (this.failPoll) {
          this.failPoll = false;
          return json({ error: 'Polling unavailable.' }, 503);
        }
        if (!this.neverFinish) {
          upload.status = 'COMPLETE';
          upload.revision += 1;
          upload.original = {
            schemaVersion: 1,
            uploadId: upload.uploadId,
            materialId: upload.materialId,
            byteSize: upload.file.byteSize,
            sha256: 'f'.repeat(64),
            publishedAt: '2026-10-20T12:01:00.000Z',
          };
          upload.parts = [];
        }
      }
      this.mutateGet?.(upload);
      return json(upload);
    }
    throw new Error('Unexpected request.');
  });
}
