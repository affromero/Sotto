import type { Prisma } from '@/generated/prisma/client';
import type { generateEpisodeTranscript } from '@/lib/pdf-generator';

/** Capture exactly the displayed transcript inputs and its publication identity. */
export async function readEpisodeTranscript(database: Prisma.TransactionClient, episodeId: string) {
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: {
      userId: true,
      currentVersion: true,
      lastCompletedStitchKey: true,
      status: true,
      pdfUrl: true,
      title: true,
      topic: true,
      createdAt: true,
      user: { select: { name: true } },
      segments: {
        orderBy: { order: 'asc' },
        select: { speaker: true, text: true, startTime: true },
      },
      references: { orderBy: { number: 'asc' } },
    },
  });
  const transcript: Parameters<typeof generateEpisodeTranscript>[0] = {
    title: episode.title,
    topic: episode.topic,
    creatorName: episode.user.name || 'Anonymous',
    createdAt: episode.createdAt,
    segments: episode.segments,
    references: episode.references.map((ref) => ({
      id: ref.id,
      number: ref.number,
      title: ref.title,
      authors: ref.authors,
      year: ref.year,
      url: ref.url,
      type: ref.type,
      publisher: ref.publisher,
      doi: ref.doi,
      verificationStatus: ref.verificationStatus,
      verificationDetails: ref.verificationDetails as Record<string, unknown> | null,
      contentDomain: ref.contentDomain ?? null,
    })),
  };
  return {
    userId: episode.userId,
    currentVersion: episode.currentVersion,
    lastCompletedStitchKey: episode.lastCompletedStitchKey,
    status: episode.status,
    pdfUrl: episode.pdfUrl,
    transcript,
  };
}
