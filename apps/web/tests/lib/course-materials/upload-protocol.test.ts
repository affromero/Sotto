// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { materialUploadLimits, type MaterialUploadPartReceipt } from '@sotto/shared';
import {
  planMaterialUploadPart,
  planMaterialUploadParts,
  sameMaterialUploadPartIdentity,
  validateMaterialUploadCompletion,
  validateMaterialUploadPartMetadata,
} from '@/lib/course-materials/uploads/protocol';

const uploadId = '00000000-0000-4000-8000-000000000001';
function receipt(index: number, bytes: number): MaterialUploadPartReceipt {
  return {
    schemaVersion: 1,
    uploadId,
    ...planMaterialUploadPart(bytes, index),
    sha256: 'a'.repeat(64),
    committedAt: '2026-10-20T12:00:00.000Z',
  };
}

describe('material upload part protocol', () => {
  it('plans complete reference-document coverage including the exact final part', () => {
    const plan = planMaterialUploadParts(46880440);
    expect(plan).toHaveLength(12);
    expect(plan[0]).toEqual({ index: 0, offset: 0, byteSize: 4194304 });
    expect(plan[11]).toEqual({ index: 11, offset: 46137344, byteSize: 743096 });
    expect(plan.reduce((sum, part) => sum + part.byteSize, 0)).toBe(46880440);
    expect(planMaterialUploadParts(materialUploadLimits.partBytes)).toHaveLength(1);
    expect(planMaterialUploadParts(1)).toEqual([{ index: 0, offset: 0, byteSize: 1 }]);
  });

  it.each([-1, 12, 0.5, NaN, Infinity])('rejects out-of-plan part index %s', (index) => {
    expect(() => planMaterialUploadPart(46880440, index)).toThrow();
  });

  it.each([0, -1, 104857601, 1.5, NaN, Infinity])(
    'rejects unsupported declared file size %s',
    (bytes) => {
      expect(() => planMaterialUploadParts(bytes)).toThrow();
    }
  );

  it('derives part length from the declared file instead of accepting the client length or offset', () => {
    const valid = {
      schemaVersion: 1 as const,
      ...planMaterialUploadPart(46880440, 11),
      sha256: 'a'.repeat(64),
    };
    expect(validateMaterialUploadPartMetadata(46880440, valid)).toEqual(valid);
    expect(() => validateMaterialUploadPartMetadata(46880440, { ...valid, byteSize: 1 })).toThrow(
      'declared file plan'
    );
    expect(() => validateMaterialUploadPartMetadata(46880440, { ...valid, offset: 0 })).toThrow(
      'declared file plan'
    );
  });

  it('orders a complete manifest without changing the supplied receipts', () => {
    const bytes = 46880440;
    const receipts = planMaterialUploadParts(bytes)
      .map((part) => receipt(part.index, bytes))
      .reverse();
    const ordered = validateMaterialUploadCompletion(uploadId, bytes, receipts);
    expect(ordered.map((part) => part.index)).toEqual(
      Array.from({ length: 12 }, (_, index) => index)
    );
    expect(receipts[0]!.index).toBe(11);
  });

  it('rejects missing, duplicate, foreign, overlapping, and short committed parts', () => {
    const bytes = materialUploadLimits.partBytes + 17;
    const first = receipt(0, bytes);
    const last = receipt(1, bytes);
    for (const receipts of [
      [first],
      [first, first],
      [first, { ...last, uploadId: '00000000-0000-4000-8000-000000000002' }],
      [first, { ...last, offset: 1 }],
      [first, { ...last, byteSize: 16 }],
      [first, last, last],
    ])
      expect(() => validateMaterialUploadCompletion(uploadId, bytes, receipts)).toThrow();
  });

  it('compares replay identity using upload, index, offset, size, and checksum', () => {
    const existing = receipt(0, 100);
    const { committedAt, ...submission } = existing;
    expect(committedAt).toBe('2026-10-20T12:00:00.000Z');
    expect(sameMaterialUploadPartIdentity(existing, submission)).toBe(true);
    expect(
      sameMaterialUploadPartIdentity(existing, {
        ...existing,
        committedAt: '2026-10-20T12:01:00.000Z',
      })
    ).toBe(true);
    expect(
      sameMaterialUploadPartIdentity(
        { ...existing, committedAt: '2026-10-20T12:01:00.000Z' },
        submission
      )
    ).toBe(true);
    for (const changed of [
      { ...submission, uploadId: '00000000-0000-4000-8000-000000000002' },
      { ...submission, index: 1 },
      { ...submission, offset: 1 },
      { ...submission, byteSize: 99 },
      { ...submission, sha256: 'b'.repeat(64) },
    ])
      expect(sameMaterialUploadPartIdentity(existing, changed)).toBe(false);
  });
});
