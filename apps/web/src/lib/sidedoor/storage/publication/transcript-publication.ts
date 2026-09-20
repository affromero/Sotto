import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { readEpisodeTranscript } from '@/lib/episodes/episode-transcript';
import { transcriptSource } from '@/lib/sidedoor/storage/publication/transcript-export';
import { resolvePublishedStorageReference } from '@/lib/sidedoor/storage/migration/storage-publication';

const publicationSchema = z
  .object({
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reference: z.string().min(1),
  })
  .strict();

export function prepareTranscriptPublication(options: {
  operationId: string;
  fingerprint: string;
  reference: string;
  episode: Awaited<ReturnType<typeof readEpisodeTranscript>>;
}) {
  return publicationSchema.parse({
    operationId: options.operationId,
    fingerprint: options.fingerprint,
    reference: options.reference,
    sourceFingerprint: createHash('sha256')
      .update(JSON.stringify(transcriptSource(options.episode)))
      .digest('hex'),
  });
}

/** Owner-scoped evidence survives erasure of the requester's producing job. */
export async function verifyTranscriptPublication(
  database: Prisma.TransactionClient,
  episodeId: string,
  episode: Awaited<ReturnType<typeof readEpisodeTranscript>>,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  if (!episode.pdfUrl) return false;
  const row = await database.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { transcriptPublication: true },
  });
  signal?.throwIfAborted();
  const parsed = publicationSchema.safeParse(row.transcriptPublication);
  if (!parsed.success) return false;
  const expected = prepareTranscriptPublication({
    ...parsed.data,
    reference: episode.pdfUrl,
    episode,
  });
  if (parsed.data.sourceFingerprint !== expected.sourceFingerprint) return false;
  return (
    (await resolvePublishedStorageReference(database, {
      consumer: `episode:${episodeId}:transcript`,
      originalReference: parsed.data.reference,
      currentReference: episode.pdfUrl,
      signal,
    })) !== null
  );
}
