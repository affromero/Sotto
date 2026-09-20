import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import type { InitialStitchInputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import { resolvePublishedStorageReference } from '@/lib/sidedoor/storage/migration/storage-publication';

/** Transient comparison for completed replay only. Never persist this projection or admit work from it. */
export async function normalizeCompletedStitchStorage(
  database: Prisma.TransactionClient,
  current: InitialStitchInputs,
  expected: InitialStitchInputs,
  signal?: AbortSignal
) {
  const normalized = structuredClone(current);
  const captured = structuredClone(expected);
  for (const [index, segment] of normalized.segments.entries()) {
    signal?.throwIfAborted();
    const original = captured.segments[index];
    if (!original || segment.id !== original.id || segment.audioUrl === original.audioUrl) continue;
    const input = normalized.storageInputs[index];
    const saved = captured.storageInputs[index];
    const consumer = `segment:${segment.id}:audio`;
    if (
      !segment.audioUrl ||
      !original.audioUrl ||
      !input ||
      !saved ||
      input.consumer !== consumer ||
      saved.consumer !== consumer ||
      saved.reference !== original.audioUrl
    )
      continue;
    const proof = await resolvePublishedStorageReference(database, {
      consumer,
      originalReference: original.audioUrl,
      currentReference: segment.audioUrl,
      signal,
    });
    if (
      !proof ||
      proof.originalAssetId !== saved.assetId ||
      proof.current.assetId !== input.assetId ||
      input.reference !== segment.audioUrl ||
      !isDeepStrictEqual(proof.current.prepared.target, {
        backendId: input.backendId,
        binding: input.binding,
        key: input.key,
      }) ||
      !isDeepStrictEqual(proof.original.target, {
        backendId: saved.backendId,
        binding: saved.binding,
        key: saved.key,
      })
    )
      continue;
    segment.audioUrl = original.audioUrl;
    normalized.storageInputs[index] = structuredClone(saved);
  }
  if (
    normalized.previousAudio.audioUrl &&
    captured.previousAudio.audioUrl &&
    normalized.previousAudio.audioUrl !== captured.previousAudio.audioUrl
  ) {
    const proof = await resolvePublishedStorageReference(database, {
      consumer: `episode:${normalized.episodeId}:audio`,
      originalReference: captured.previousAudio.audioUrl,
      currentReference: normalized.previousAudio.audioUrl,
      signal,
    });
    if (proof) normalized.previousAudio.audioUrl = captured.previousAudio.audioUrl;
  }
  signal?.throwIfAborted();
  return normalized;
}
