import { cache } from 'react';
import { prisma } from '@/lib/prisma';

/**
 * Cached podcast fetch for the detail page.
 * Memoized per-request via React.cache — generateMetadata and PodcastPage
 * share the same result without duplicate DB queries.
 *
 * Does NOT include interactions (those depend on userId from auth).
 */
export const getPodcastForDetailPage = cache(async (podcastId: string) => {
  return prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          handle: true,
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
      voiceTracks: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          name: true,
          status: true,
          audioUrl: true,
          duration: true,
          ttsProvider: true,
          ttsModel: true,
          failureReason: true,
          voices: { select: { speaker: true, voiceId: true, provider: true } },
          proposalStatus: true,
          proposalMessage: true,
          contributor: {
            select: { id: true, name: true, handle: true, image: true },
          },
        },
      },
    },
  });
});
