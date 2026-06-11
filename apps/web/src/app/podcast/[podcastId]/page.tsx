import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getVideoGenerationStatus, getAvatarGenerationStatus } from '@/lib/video-gate';
import { resolveAudioUrl } from '@/lib/r2';
import type { Metadata } from 'next';
import { PodcastPlayerView } from './PodcastPlayerView';
import { PodcastJsonLd } from '@/components/player/PodcastJsonLd';
import { JoinCTA } from '@/components/referral/JoinCTA';
import { getPodcastForDetailPage } from '@/lib/podcast-data';
import { absolutePodcastUrl, getAppBaseUrl } from '@/lib/urls';
import styles from './page.module.css';

interface PodcastPageProps {
  params: Promise<{ podcastId: string }>;
}

export async function generateMetadata({ params }: PodcastPageProps): Promise<Metadata> {
  const { podcastId } = await params;
  const podcast = await getPodcastForDetailPage(podcastId);

  if (!podcast) return { title: 'Podcast Not Found' };

  const appUrl = getAppBaseUrl();
  const podcastUrl = absolutePodcastUrl(
    { id: podcast.id, slug: podcast.slug },
    podcast.user.handle,
    appUrl
  );
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
      ...(podcast.visibility === 'PUBLIC' && podcast.audioUrl ? { audio: podcast.audioUrl } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${podcast.title} — by ${creatorName}`,
      description: podcast.topic,
    },
    alternates: { canonical: podcastUrl },
  };
}

export default async function PodcastPage({ params }: PodcastPageProps) {
  const { podcastId } = await params;

  // Parallel: auth + cached podcast fetch (cache hit if generateMetadata already ran)
  const [session, podcast] = await Promise.all([auth(), getPodcastForDetailPage(podcastId)]);
  const userId = session?.user?.id;

  if (!podcast) {
    notFound();
  }

  // Check visibility
  if (podcast.visibility === 'PRIVATE' && podcast.userId !== userId) {
    notFound();
  }

  const isOwner = userId === podcast.userId;
  const isAdmin = session?.user?.role === 'ADMIN';

  // All secondary queries in parallel
  const [interactions, ownerData] = await Promise.all([
    // Interactions (separate from cached query because it depends on userId)
    userId
      ? prisma.interaction.findMany({
          where: { podcastId: podcast.id, userId },
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
        })
      : Promise.resolve([]),

    // Owner-only gates (already internally parallel)
    isOwner && userId
      ? Promise.all([
          getVideoGenerationStatus(userId),
          getAvatarGenerationStatus(userId),
        ])
      : Promise.resolve(null),
  ]);

  // Owner data
  let videoStatus:
    | {
        available: boolean;
        hasByokKey: boolean;
      }
    | undefined;
  let avatarStatus:
    | {
        available: boolean;
        hasByokKey: boolean;
      }
    | undefined;
  if (ownerData) {
    const [vidStatus, avStatus] = ownerData;
    videoStatus = vidStatus;
    avatarStatus = avStatus;
  }

  const visibility = podcast.visibility;

  // Resolve audio URLs: presigned for PRIVATE/UNLISTED, public CDN for PUBLIC
  const [
    resolvedAudioUrl,
    resolvedSegments,
    resolvedVersions,
    resolvedVideoUrl,
  ] = await Promise.all([
    resolveAudioUrl(podcast.audioUrl, visibility),
    Promise.all(
      podcast.segments.map(async (s) => ({
        ...s,
        audioUrl: await resolveAudioUrl(s.audioUrl, visibility),
        startTime: s.startTime,
        duration: s.duration,
        wordTimings: s.wordTimings as Array<{ word: string; start: number; end: number }> | null,
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
    podcast.videoUrl ? resolveAudioUrl(podcast.videoUrl, visibility) : Promise.resolve(null),
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
    saveCount: podcast.saveCount,
    createdAt: podcast.createdAt.toISOString(),
    source: podcast.source,
    isHumanContent: podcast.isHumanContent,
    lowReferences: podcast.lowReferences,
    sourcePlatform: podcast.sourcePlatform,
    aiProvider: podcast.aiProvider,
    aiModel: podcast.aiModel,
    ttsProvider: podcast.ttsProvider,
    ttsModel: podcast.ttsModel,
    language: podcast.language,
    aiAutoResolved: podcast.aiAutoResolved,
    ttsAutoResolved: podcast.ttsAutoResolved,
    failureReason: podcast.failureReason,
    failedAtStatus: podcast.failedAtStatus,
    errorId: podcast.errorId,
    verificationMode: podcast.verificationMode,
    currentVersion: podcast.currentVersion,
    user: podcast.user,
    segments: resolvedSegments,
    interactions,
    references: podcast.references.map((r) => ({
      ...r,
      verificationDetails: r.verificationDetails as Record<string, unknown> | null,
    })),
    vocabularyEntries: podcast.vocabularyEntries,
    pdfUrl: podcast.pdfUrl,
    videoUrl: resolvedVideoUrl ?? null,
    tags: podcast.tags.map((pt) => pt.tag),
    versions: resolvedVersions,
    isSaved: false,
  };

  const showJsonLd =
    podcast.visibility === 'PUBLIC' && podcast.status === 'READY' && resolvedAudioUrl;

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
        <PodcastPlayerView
          podcast={podcastData}
          isOwner={isOwner}
          isAdmin={isAdmin}
          isAuthenticated={!!userId}
          videoStatus={videoStatus}
          avatarStatus={avatarStatus}
        />
        {!userId && podcast.visibility === 'PUBLIC' && (
          <JoinCTA creatorHandle={podcast.user.handle} creatorName={podcast.user.name} />
        )}
      </div>
    </main>
  );
}
