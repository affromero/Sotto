import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';
import type { Metadata } from 'next';
import { PodcastPlayerView } from './PodcastPlayerView';
import styles from './page.module.css';

interface PodcastPageProps {
  params: Promise<{ podcastId: string }>;
}

export async function generateMetadata({ params }: PodcastPageProps): Promise<Metadata> {
  const { podcastId } = await params;
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      title: true,
      topic: true,
      audioUrl: true,
      defaultVoiceTrackId: true,
      voiceTracks: { where: { status: 'READY' }, select: { id: true, audioUrl: true } },
      user: { select: { name: true } },
    },
  });

  if (!podcast) return { title: 'Podcast Not Found' };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';
  const podcastUrl = `${appUrl}/podcast/${podcastId}`;
  const creatorName = podcast.user.name || 'Anonymous';

  return {
    title: podcast.title,
    description: podcast.topic,
    openGraph: {
      title: podcast.title,
      description: podcast.topic,
      type: 'article',
      url: podcastUrl,
      siteName: 'Sotto',
      ...(() => {
        const defaultTrack = podcast.defaultVoiceTrackId
          ? podcast.voiceTracks.find(t => t.id === podcast.defaultVoiceTrackId)
          : null;
        const ogAudioUrl = defaultTrack?.audioUrl || podcast.audioUrl;
        return ogAudioUrl ? { audio: ogAudioUrl } : {};
      })(),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${podcast.title} — by ${creatorName}`,
      description: podcast.topic,
      site: '@SottoFM',
    },
    alternates: {
      canonical: podcastUrl,
      types: {
        'application/json+oembed': `${appUrl}/api/oembed?url=${encodeURIComponent(podcastUrl)}`,
      },
    },
  };
}

export default async function PodcastPage({ params }: PodcastPageProps) {
  const { podcastId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const podcast = await prisma.podcast.findUnique({
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
        },
      },
      interactions: {
        where: userId ? { userId } : { id: 'none' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          question: true,
          timestamp: true,
          status: true,
          answer: true,
          helpful: true,
          segmentOrder: true,
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
        },
      },
      forkedFrom: {
        select: {
          id: true,
          title: true,
          user: {
            select: {
              id: true,
              name: true,
              handle: true,
              image: true,
            },
          },
        },
      },
      forks: {
        take: 10,
        orderBy: { forkCount: 'desc' },
        select: {
          id: true,
          title: true,
          remixNote: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              handle: true,
              image: true,
            },
          },
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
      voiceTracks: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          name: true,
          status: true,
          audioUrl: true,
          duration: true,
          ttsProvider: true,
          failureReason: true,
          voices: { select: { speaker: true, voiceId: true } },
        },
      },
    },
  });

  if (!podcast) {
    notFound();
  }

  // Check visibility
  if (podcast.visibility === 'PRIVATE' && podcast.userId !== userId) {
    notFound();
  }

  // Check if current user has liked/saved
  let isLiked = false;
  let isSaved = false;
  if (userId) {
    const [like, save] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_podcastId: { userId, podcastId: podcast.id } },
      }),
      prisma.save.findUnique({
        where: { userId_podcastId: { userId, podcastId: podcast.id } },
      }),
    ]);
    isLiked = !!like;
    isSaved = !!save;
  }

  const isOwner = userId === podcast.userId;
  let canMakePrivate: boolean | undefined;
  if (isOwner && userId) {
    const freeTier = await getFreeTierStatus(userId);
    const plan = freeTier.isProUser ? 'PRO' as const : 'FREE' as const;
    canMakePrivate = getTierFeatures(plan, freeTier.isByokUser).privateAllowed;
  }

  const podcastData = {
    id: podcast.id,
    title: podcast.title,
    topic: podcast.topic,
    status: podcast.status,
    visibility: podcast.visibility,
    audioUrl: podcast.audioUrl,
    duration: podcast.duration,
    playCount: podcast.playCount,
    likeCount: podcast.likeCount,
    forkCount: podcast.forkCount,
    saveCount: podcast.saveCount,
    commentCount: podcast.commentCount,
    createdAt: podcast.createdAt.toISOString(),
    source: podcast.source,
    isHumanContent: podcast.isHumanContent,
    sourcePlatform: podcast.sourcePlatform,
    aiProvider: podcast.aiProvider,
    aiModel: podcast.aiModel,
    ttsProvider: podcast.ttsProvider,
    ttsModel: podcast.ttsModel,
    language: podcast.language,
    forkedFromId: podcast.forkedFromId,
    remixNote: podcast.remixNote,
    failureReason: podcast.failureReason,
    currentVersion: podcast.currentVersion,
    user: podcast.user,
    segments: podcast.segments.map((s) => ({
      ...s,
      startTime: s.startTime,
      duration: s.duration,
    })),
    interactions: podcast.interactions,
    references: podcast.references.map((r) => ({
      ...r,
      verificationDetails: r.verificationDetails as Record<string, unknown> | null,
    })),
    pdfUrl: podcast.pdfUrl,
    tags: podcast.tags.map((pt) => pt.tag),
    forkedFrom: podcast.forkedFrom
      ? {
          id: podcast.forkedFrom.id,
          title: podcast.forkedFrom.title,
          user: podcast.forkedFrom.user,
        }
      : null,
    forks: podcast.forks.map((f) => ({
      id: f.id,
      title: f.title,
      remixNote: f.remixNote,
      createdAt: f.createdAt.toISOString(),
      user: f.user,
    })),
    versions: podcast.versions.map((v) => ({
      id: v.id,
      version: v.version,
      audioUrl: v.audioUrl,
      duration: v.duration,
      changeType: v.changeType,
      changeSummary: v.changeSummary,
      interactionId: v.interactionId,
      createdAt: v.createdAt.toISOString(),
    })),
    voiceTracks: (isOwner
      ? podcast.voiceTracks
      : podcast.voiceTracks.filter(t => t.status === 'READY')
    ).map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      audioUrl: t.audioUrl,
      duration: t.duration,
      ttsProvider: t.ttsProvider,
      failureReason: t.failureReason,
      voices: t.voices,
    })),
    defaultVoiceTrackId: podcast.defaultVoiceTrackId,
    isLiked,
    isSaved,
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <PodcastPlayerView podcast={podcastData} isOwner={isOwner} isAuthenticated={!!userId} currentUserId={userId} canMakePrivate={canMakePrivate} />
      </div>
    </main>
  );
}
