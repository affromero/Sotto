import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';
import { resolveAudioUrl } from '@/lib/r2';
import type { Metadata } from 'next';
import { PodcastPlayerView } from './PodcastPlayerView';
import { PodcastJsonLd } from '@/components/player/PodcastJsonLd';
import { JoinCTA } from '@/components/referral/JoinCTA';
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
      slug: true,
      audioUrl: true,
      visibility: true,
      defaultVoiceTrackId: true,
      voiceTracks: { where: { status: 'READY' }, select: { id: true, audioUrl: true } },
      user: { select: { name: true, handle: true } },
    },
  });

  if (!podcast) return { title: 'Podcast Not Found' };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';
  // Use vanity URL as canonical when slug + handle exist
  const vanityPath = podcast.slug && podcast.user.handle
    ? `/@${podcast.user.handle}/${podcast.slug}`
    : `/podcast/${podcastId}`;
  const podcastUrl = `${appUrl}${vanityPath}`;
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
        if (podcast.visibility !== 'PUBLIC') return {};
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
          contentDomain: true,
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

  // Redirect drafts to the create page (owner only)
  if (podcast.status === 'DRAFT') {
    if (podcast.userId === userId) {
      redirect(`/create?draftId=${podcastId}`);
    }
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
  const isAdmin = session?.user?.role === 'ADMIN';
  let canMakePrivate: boolean | undefined;
  if (isOwner && userId) {
    const freeTier = await getFreeTierStatus(userId);
    const plan = freeTier.isProUser ? 'PRO' as const : 'FREE' as const;
    canMakePrivate = getTierFeatures(plan, freeTier.isByokUser, session?.user?.role as string | undefined).privateAllowed;
  }

  const visibility = podcast.visibility;

  // Resolve audio URLs: presigned for PRIVATE/UNLISTED, public CDN for PUBLIC
  const [resolvedAudioUrl, resolvedSegments, resolvedVersions, resolvedVoiceTracks] =
    await Promise.all([
      resolveAudioUrl(podcast.audioUrl, visibility),
      Promise.all(
        podcast.segments.map(async (s) => ({
          ...s,
          audioUrl: await resolveAudioUrl(s.audioUrl, visibility),
          startTime: s.startTime,
          duration: s.duration,
        }))
      ),
      Promise.all(
        podcast.versions.map(async (v) => ({
          id: v.id,
          version: v.version,
          audioUrl: (await resolveAudioUrl(v.audioUrl, visibility)) ?? v.audioUrl,
          duration: v.duration,
          changeType: v.changeType,
          changeSummary: v.changeSummary,
          interactionId: v.interactionId,
          createdAt: v.createdAt.toISOString(),
        }))
      ),
      Promise.all(
        (isOwner
          ? podcast.voiceTracks
          : podcast.voiceTracks.filter((t) => t.status === 'READY')
        ).map(async (t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          audioUrl: await resolveAudioUrl(t.audioUrl, visibility),
          duration: t.duration,
          ttsProvider: t.ttsProvider,
          failureReason: t.failureReason,
          voices: t.voices,
        }))
      ),
    ]);

  const podcastData = {
    id: podcast.id,
    title: podcast.title,
    topic: podcast.topic,
    slug: podcast.slug,
    status: podcast.status,
    visibility,
    audioUrl: resolvedAudioUrl,
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
    verificationMode: podcast.verificationMode,
    currentVersion: podcast.currentVersion,
    user: podcast.user,
    segments: resolvedSegments,
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
    versions: resolvedVersions,
    voiceTracks: resolvedVoiceTracks,
    defaultVoiceTrackId: podcast.defaultVoiceTrackId,
    isLiked,
    isSaved,
  };

  const showJsonLd =
    podcast.visibility === 'PUBLIC' &&
    podcast.status === 'READY' &&
    resolvedAudioUrl;

  return (
    <main className={styles.main}>
      {showJsonLd && (
        <PodcastJsonLd
          id={podcast.id}
          title={podcast.title}
          topic={podcast.topic}
          slug={podcast.slug}
          createdAt={podcast.createdAt.toISOString()}
          duration={podcast.duration}
          audioUrl={resolvedAudioUrl}
          creator={{ name: podcast.user.name, handle: podcast.user.handle }}
        />
      )}
      <div className={styles.container}>
        <PodcastPlayerView podcast={podcastData} isOwner={isOwner} isAdmin={isAdmin} isAuthenticated={!!userId} currentUserId={userId} canMakePrivate={canMakePrivate} />
        {!userId && podcast.visibility === 'PUBLIC' && (
          <JoinCTA creatorHandle={podcast.user.handle} creatorName={podcast.user.name} />
        )}
      </div>
    </main>
  );
}
