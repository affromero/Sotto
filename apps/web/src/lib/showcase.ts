import { prisma } from '@/lib/prisma';

export interface ShowcasePodcast {
  podcastId: string;
  title: string;
  creatorName: string;
  audioUrl: string;
  duration: number | null;
}

/**
 * Fetch a showcase podcast for the landing page EmbedPlayer.
 * Returns the most recently created public, ready podcast with verificationMode 'showcase'.
 */
export async function getShowcasePodcast(): Promise<ShowcasePodcast | null> {
  try {
    const podcast = await prisma.podcast.findFirst({
      where: {
        verificationMode: 'showcase',
        status: 'READY',
        visibility: 'PUBLIC',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        audioUrl: true,
        duration: true,
        user: {
          select: {
            name: true,
            handle: true,
          },
        },
      },
    });

    if (!podcast?.audioUrl) return null;

    return {
      podcastId: podcast.id,
      title: podcast.title,
      creatorName: podcast.user.handle || podcast.user.name || 'Sotto',
      audioUrl: podcast.audioUrl,
      duration: podcast.duration,
    };
  } catch {
    // DB unavailable at build time — gracefully skip
    return null;
  }
}
