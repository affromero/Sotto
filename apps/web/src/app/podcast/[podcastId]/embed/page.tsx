import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { EmbedPlayer } from '@/components/player/EmbedPlayer';
import { getAppBaseUrl } from '@/lib/urls';
import type { Metadata } from 'next';

interface EmbedPageProps {
  params: Promise<{ podcastId: string }>;
}

export const metadata: Metadata = {
  robots: 'noindex',
};

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { podcastId } = await params;
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      title: true,
      audioUrl: true,
      duration: true,
      status: true,
      visibility: true,
      user: { select: { name: true } },
    },
  });

  if (!podcast || podcast.status !== 'READY' || !podcast.audioUrl) {
    notFound();
  }

  if (podcast.visibility === 'PRIVATE') {
    notFound();
  }

  return (
    <div style={{ padding: 16, maxWidth: 600 }}>
      <EmbedPlayer
        podcastId={podcast.id}
        title={podcast.title}
        creatorName={podcast.user.name || 'Anonymous'}
        audioUrl={podcast.audioUrl}
        duration={podcast.duration}
        appBaseUrl={getAppBaseUrl()}
      />
    </div>
  );
}
