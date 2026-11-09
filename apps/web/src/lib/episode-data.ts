import { cache } from 'react';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

/**
 * Cached episode fetch for the detail page.
 * Memoized per-request via React.cache — generateMetadata and EpisodePage
 * share the same result without duplicate DB queries.
 *
 * Does NOT include interactions (those depend on userId from auth).
 */
export const getEpisodeForDetailPage = cache(async (episodeId: string) => {
  return sottoTransaction(prismaUnfiltered, async (database) => {
    await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
    const current = await database.episode.findUnique({
      where: { id: episodeId },
      select: {
        deletedAt: true,
        assessmentAudioAssessmentId: true,
        assessmentSection: { select: { id: true } },
      },
    });
    if (
      !current ||
      current.deletedAt ||
      current.assessmentSection ||
      current.assessmentAudioAssessmentId
    )
      return null;
    return database.episode.findUnique({
      where: { id: episodeId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        segments: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            speaker: true,
            text: true,
            audioUrl: true,
            order: true,
            startTime: true,
            duration: true,
            wordTimings: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
        references: {
          orderBy: { number: 'asc' },
          select: {
            id: true,
            number: true,
            title: true,
            authors: true,
            year: true,
            url: true,
            type: true,
            publisher: true,
            doi: true,
            verificationStatus: true,
            verificationDetails: true,
            contentDomain: true,
          },
        },
        vocabularyEntries: {
          orderBy: { number: 'asc' },
          select: {
            id: true,
            number: true,
            word: true,
            translation: true,
            partOfSpeech: true,
            pronunciation: true,
            exampleSentence: true,
            difficulty: true,
          },
        },
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            audioUrl: true,
            duration: true,
            changeType: true,
            changeSummary: true,
            interactionId: true,
            createdAt: true,
          },
        },
        voices: {
          select: { speaker: true, voiceId: true, provider: true },
        },
      },
    });
  });
});

/** Anonymous share images must not reveal private or held-out lesson metadata. */
export async function getShareableEpisodeMetadata(episodeId: string) {
  return sottoTransaction(prismaUnfiltered, async (database) => {
    await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
    const episode = await database.episode.findUnique({
      where: { id: episodeId },
      select: {
        title: true,
        topic: true,
        duration: true,
        visibility: true,
        deletedAt: true,
        assessmentAudioAssessmentId: true,
        assessmentSection: { select: { id: true } },
        user: { select: { name: true } },
      },
    });
    if (
      !episode ||
      episode.deletedAt ||
      episode.assessmentSection ||
      episode.assessmentAudioAssessmentId ||
      episode.visibility === 'PRIVATE'
    )
      return null;
    return {
      title: episode.title,
      topic: episode.topic,
      duration: episode.duration,
      user: episode.user,
    };
  });
}
