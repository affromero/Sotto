import { describe, expect, it } from 'vitest';
import { matchesPublishedStorageIdentity } from '@/lib/sidedoor/storage/migration/storage-publication';

describe('published storage identity', () => {
  const original = {
    consumer: 'episode:one:audio',
    reference: '/original',
    assetId: 'a'.repeat(64),
    backendId: 'b'.repeat(64),
    binding: 'c'.repeat(64),
    key: 'audio/original',
  };
  const expected = {
    original,
    currentReference: '/moved',
    contentSha256: 'd'.repeat(64),
    contentBytes: 42,
  };
  const proof = {
    originalAssetId: original.assetId,
    original: {
      target: { backendId: original.backendId, binding: original.binding, key: original.key },
    },
    content: { sha256: expected.contentSha256, bytes: expected.contentBytes },
  };

  it('accepts the original asset and verified identical relocated bytes', () => {
    expect(matchesPublishedStorageIdentity(proof, expected)).toBe(true);
    expect(
      matchesPublishedStorageIdentity(
        { ...proof, content: null },
        { ...expected, currentReference: original.reference }
      )
    ).toBe(true);
  });

  it('rejects an unproven move or changed source and bytes', () => {
    expect(matchesPublishedStorageIdentity(null, expected)).toBe(false);
    expect(matchesPublishedStorageIdentity({ ...proof, content: null }, expected)).toBe(false);
    expect(matchesPublishedStorageIdentity({ ...proof, originalAssetId: 'other' }, expected)).toBe(
      false
    );
    expect(
      matchesPublishedStorageIdentity(
        { ...proof, original: { target: { ...proof.original.target, key: 'other' } } },
        expected
      )
    ).toBe(false);
    expect(
      matchesPublishedStorageIdentity(
        { ...proof, content: { ...proof.content, sha256: 'e'.repeat(64) } },
        expected
      )
    ).toBe(false);
    expect(
      matchesPublishedStorageIdentity(
        { ...proof, content: { ...proof.content, bytes: expected.contentBytes + 1 } },
        expected
      )
    ).toBe(false);
  });
});
