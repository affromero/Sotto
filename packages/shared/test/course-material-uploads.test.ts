// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  materialUploadBatchRequestSchema,
  materialUploadCapabilities,
  materialUploadCapabilitiesSchema,
  materialUploadCompletionRequestSchema,
  materialUploadLimits,
  materialUploadPartMetadataSchema,
  materialUploadResumeSchema,
} from '../src/course-materials/uploads';

const id = (index: number) => '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
const declaration = (index: number, byteSize = 1000) => ({
  clientId: id(index),
  name: 'Notes ' + index + '.pdf',
  mimeType: 'application/pdf',
  byteSize,
});
const batch = (sizes: number[]) => ({
  schemaVersion: 1,
  requestId: id(100),
  files: sizes.map((size, index) => declaration(index + 1, size)),
});

describe('material upload contracts', () => {
  it('advertises the supported version and exact effective transport limits', () => {
    expect(materialUploadCapabilitiesSchema.parse(materialUploadCapabilities)).toMatchObject({
      schemaVersion: 1,
      protocol: 'SOTTO_PARTS',
      checksumAlgorithm: 'sha256',
      resumable: true,
      limits: {
        version: 1,
        maxFiles: 10,
        maxFileBytes: 104857600,
        maxBatchBytes: 262144000,
        partBytes: 4194304,
      },
    });
    expect(
      materialUploadCapabilitiesSchema.safeParse({
        ...materialUploadCapabilities,
        limits: { ...materialUploadLimits, partBytes: 8388608 },
      }).success
    ).toBe(false);
  });

  it('accepts the full reference file and the exact batch-byte boundary', () => {
    expect(materialUploadBatchRequestSchema.parse(batch([46880440])).files[0]!.byteSize).toBe(
      46880440
    );
    const limit = materialUploadLimits.maxFileBytes;
    expect(
      materialUploadBatchRequestSchema.safeParse(batch([limit, limit, limit / 2])).success
    ).toBe(true);
    expect(
      materialUploadBatchRequestSchema.safeParse(batch([limit, limit, limit / 2 + 1])).success
    ).toBe(false);
    expect(materialUploadBatchRequestSchema.safeParse(batch([limit + 1])).success).toBe(false);
  });

  it('enforces file counts and UUID identities without claiming a cross-request reservation', () => {
    expect(materialUploadBatchRequestSchema.safeParse(batch(Array(10).fill(1))).success).toBe(true);
    expect(materialUploadBatchRequestSchema.safeParse(batch(Array(11).fill(1))).success).toBe(
      false
    );
    expect(materialUploadBatchRequestSchema.safeParse(batch([])).success).toBe(false);
    const duplicate = batch([1, 2]);
    duplicate.files[1]!.clientId = duplicate.files[0]!.clientId;
    expect(materialUploadBatchRequestSchema.safeParse(duplicate).success).toBe(false);
    expect(
      materialUploadBatchRequestSchema.safeParse({ ...batch([1]), requestId: 'unsafe' }).success
    ).toBe(false);
    expect(materialUploadBatchRequestSchema.safeParse({ ...batch([1]), extra: true }).success).toBe(
      false
    );
  });

  it('requires a part SHA-256 while allowing an omitted whole-file expectation', () => {
    expect(materialUploadBatchRequestSchema.safeParse(batch([1])).success).toBe(true);
    const part = { schemaVersion: 1, index: 0, offset: 0, byteSize: 1 };
    expect(materialUploadPartMetadataSchema.safeParse(part).success).toBe(false);
    expect(
      materialUploadPartMetadataSchema.safeParse({ ...part, sha256: 'a'.repeat(64) }).success
    ).toBe(true);
    expect(
      materialUploadPartMetadataSchema.safeParse({ ...part, sha256: 'A'.repeat(64) }).success
    ).toBe(false);
    expect(materialUploadPartMetadataSchema.safeParse({ ...part, sha256: 'abc' }).success).toBe(
      false
    );
    expect(
      materialUploadCompletionRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: id(5),
        expectedRevision: 0,
      }).success
    ).toBe(true);
  });

  it('ties resumed part and publication receipts to the exact owned session identities', () => {
    const pending = {
      schemaVersion: 1,
      batchId: id(101),
      uploadId: id(102),
      materialId: id(103),
      limitsVersion: 1,
      file: { ...declaration(1, 1), sha256: 'a'.repeat(64) },
      status: 'UPLOADING',
      revision: 0,
      expiresAt: '2026-10-21T12:00:00.000Z',
      parts: [],
      original: null,
    };
    expect(materialUploadResumeSchema.safeParse(pending).success).toBe(true);
    expect(materialUploadResumeSchema.safeParse({ ...pending, status: 'COMPLETE' }).success).toBe(
      false
    );
    const original = {
      schemaVersion: 1,
      uploadId: pending.uploadId,
      materialId: pending.materialId,
      byteSize: 1,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-10-20T12:00:00.000Z',
    };
    const complete = { ...pending, status: 'COMPLETE', original };
    expect(materialUploadResumeSchema.safeParse(complete).success).toBe(true);
    expect(
      materialUploadResumeSchema.safeParse({
        ...complete,
        original: { ...original, sha256: 'b'.repeat(64) },
      }).success
    ).toBe(false);
    const part = {
      schemaVersion: 1,
      uploadId: id(999),
      index: 0,
      offset: 0,
      byteSize: 1,
      sha256: 'a'.repeat(64),
      committedAt: '2026-10-20T12:00:00.000Z',
    };
    expect(materialUploadResumeSchema.safeParse({ ...pending, parts: [part] }).success).toBe(false);
  });
});
