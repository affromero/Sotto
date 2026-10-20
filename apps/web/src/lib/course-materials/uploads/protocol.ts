import {
  materialUploadFileSizeSchema,
  materialUploadLimits,
  materialUploadPartIdentitySchema,
  materialUploadPartMetadataSchema,
  materialUploadPartReceiptSchema,
  type MaterialUploadPartIdentity,
  type MaterialUploadPartMetadata,
  type MaterialUploadPartReceipt,
} from '@sotto/shared';

export interface MaterialUploadPlannedPart {
  index: number;
  offset: number;
  byteSize: number;
}

export class MaterialUploadProtocolError extends Error {
  constructor(
    readonly code: 'invalid_part' | 'incomplete_upload' | 'receipt_conflict',
    message: string
  ) {
    super(message);
    this.name = 'MaterialUploadProtocolError';
  }
}

/** Declared file bytes come from the reserved server session, not a part request. */
export function planMaterialUploadPart(
  declaredFileBytes: number,
  index: number
): MaterialUploadPlannedPart {
  const bytes = materialUploadFileSizeSchema.parse(declaredFileBytes);
  const count = Math.ceil(bytes / materialUploadLimits.partBytes);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count)
    throw new MaterialUploadProtocolError('invalid_part', 'The part index is outside this file.');
  const offset = index * materialUploadLimits.partBytes;
  return { index, offset, byteSize: Math.min(materialUploadLimits.partBytes, bytes - offset) };
}

export function planMaterialUploadParts(declaredFileBytes: number): MaterialUploadPlannedPart[] {
  const bytes = materialUploadFileSizeSchema.parse(declaredFileBytes);
  return Array.from({ length: Math.ceil(bytes / materialUploadLimits.partBytes) }, (_, index) =>
    planMaterialUploadPart(bytes, index)
  );
}

/** The client checksum is required; client offsets and lengths must match the server plan. */
export function validateMaterialUploadPartMetadata(
  declaredFileBytes: number,
  input: MaterialUploadPartMetadata
): MaterialUploadPartMetadata {
  const metadata = materialUploadPartMetadataSchema.parse(input);
  const planned = planMaterialUploadPart(declaredFileBytes, metadata.index);
  if (metadata.offset !== planned.offset || metadata.byteSize !== planned.byteSize)
    throw new MaterialUploadProtocolError(
      'invalid_part',
      'The part offset and length must match the declared file plan.'
    );
  return { schemaVersion: 1, ...planned, sha256: metadata.sha256 };
}

/** Timestamps are server receipt data, not part submission identity. */
export function sameMaterialUploadPartIdentity(
  receipt: MaterialUploadPartReceipt,
  submission: MaterialUploadPartIdentity | MaterialUploadPartReceipt
): boolean {
  const existing = materialUploadPartReceiptSchema.parse(receipt);
  const proposed =
    'committedAt' in submission
      ? materialUploadPartReceiptSchema.parse(submission)
      : materialUploadPartIdentitySchema.parse(submission);
  return (
    existing.uploadId === proposed.uploadId &&
    existing.index === proposed.index &&
    existing.offset === proposed.offset &&
    existing.byteSize === proposed.byteSize &&
    existing.sha256 === proposed.sha256
  );
}

/**
 * Returns exact ordered coverage. Whole-file SHA-256 still requires hashing the
 * concatenated original bytes during finalization.
 */
export function validateMaterialUploadCompletion(
  uploadId: string,
  declaredFileBytes: number,
  receipts: readonly MaterialUploadPartReceipt[]
): MaterialUploadPartReceipt[] {
  const plan = planMaterialUploadParts(declaredFileBytes);
  const ordered = receipts.map((receipt) => materialUploadPartReceiptSchema.parse(receipt));
  ordered.sort((left, right) => left.index - right.index);
  if (ordered.length !== plan.length)
    throw new MaterialUploadProtocolError(
      'incomplete_upload',
      'Every planned part needs exactly one committed receipt.'
    );
  for (const [index, receipt] of ordered.entries()) {
    const expected = plan[index]!;
    if (
      receipt.uploadId !== uploadId ||
      receipt.index !== expected.index ||
      receipt.offset !== expected.offset ||
      receipt.byteSize !== expected.byteSize
    )
      throw new MaterialUploadProtocolError(
        'receipt_conflict',
        "The committed parts do not form this upload's exact contiguous coverage."
      );
  }
  return ordered;
}
