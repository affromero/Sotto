import type { Prisma } from '@/generated/prisma/client';

export class InteractionEpisodeNotFoundError extends Error {
  constructor() {
    super('Episode not found');
    this.name = 'InteractionEpisodeNotFoundError';
  }
}

/** Called within the transaction that admits, reads, or publishes an interaction. */
export async function readInteractionEpisode(
  database: Prisma.TransactionClient,
  episodeId: string
) {
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
  const episode = await database.episode.findUnique({
    where: { id: episodeId },
    select: {
      userId: true,
      visibility: true,
      deletedAt: true,
      assessmentAudioAssessmentId: true,
      assessmentSection: { select: { id: true } },
    },
  });
  if (
    !episode ||
    episode.deletedAt ||
    episode.assessmentSection ||
    episode.assessmentAudioAssessmentId
  )
    throw new InteractionEpisodeNotFoundError();
  return episode;
}
