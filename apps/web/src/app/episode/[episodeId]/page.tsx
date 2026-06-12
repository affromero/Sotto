import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getVideoGenerationStatus, getAvatarGenerationStatus } from '@/lib/video-gate';
import { resolveAudioUrl } from '@/lib/r2';
import type { Metadata } from 'next';
import { EpisodePlayerView } from './EpisodePlayerView';
import { JoinCTA } from '@/components/referral/JoinCTA';
import { getEpisodeForDetailPage } from '@/lib/episode-data';
import { absoluteEpisodeUrl, getAppBaseUrl } from '@/lib/urls';
import styles from './page.module.css';

interface EpisodePageProps {
  params: Promise<{ episodeId: string }>;
}

export async function generateMetadata({ params }: EpisodePageProps): Promise<Metadata> {
  const { episodeId } = await params;
  const episode = await getEpisodeForDetailPage(episodeId);

  if (!episode) return { title: 'Lesson Not Found' };

  const appUrl = getAppBaseUrl();
  const episodeUrl = absoluteEpisodeUrl(
    { id: episode.id, slug: episode.slug },
    episode.user.handle,
    appUrl
  );
  const creatorName = episode.user.name || 'Anonymous';

  return {
    title: episode.title,
    description: episode.topic,
    openGraph: {
      title: episode.title,
      description: episode.topic,
      type: 'article',
      url: episodeUrl,
      siteName: 'Sotto',
      ...(episode.visibility === 'PUBLIC' && episode.audioUrl ? { audio: episode.audioUrl } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${episode.title} — by ${creatorName}`,
      description: episode.topic,
    },
    alternates: { canonical: episodeUrl },
  };
}

export default async function EpisodePage({ params }: EpisodePageProps) {
  const { episodeId } = await params;

  // Parallel: auth + cached episode fetch (cache hit if generateMetadata already ran)
  const [session, episode] = await Promise.all([auth(), getEpisodeForDetailPage(episodeId)]);
  const userId = session?.user?.id;

  if (!episode) {
    notFound();
  }

  // Check visibility
  if (episode.visibility === 'PRIVATE' && episode.userId !== userId) {
    notFound();
  }

  const isOwner = userId === episode.userId;
  const isAdmin = session?.user?.role === 'ADMIN';

  // All secondary queries in parallel
  const [interactions, ownerData] = await Promise.all([
    // Interactions (separate from cached query because it depends on userId)
    userId
      ? prisma.interaction.findMany({
          where: { episodeId: episode.id, userId },
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

  const visibility = episode.visibility;

  // Resolve audio URLs: presigned for PRIVATE/UNLISTED, public CDN for PUBLIC
  const [
    resolvedAudioUrl,
    resolvedSegments,
    resolvedVersions,
    resolvedVideoUrl,
  ] = await Promise.all([
    resolveAudioUrl(episode.audioUrl, visibility),
    Promise.all(
      episode.segments.map(async (s) => ({
        ...s,
        audioUrl: await resolveAudioUrl(s.audioUrl, visibility),
        startTime: s.startTime,
        duration: s.duration,
        wordTimings: s.wordTimings as Array<{ word: string; start: number; end: number }> | null,
      }))
    ),
    Promise.all(
      episode.versions.map(async (v) => ({
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
    episode.videoUrl ? resolveAudioUrl(episode.videoUrl, visibility) : Promise.resolve(null),
  ]);

  const episodeData = {
    id: episode.id,
    title: episode.title,
    topic: episode.topic,
    slug: episode.slug,
    status: episode.status,
    visibility,
    audioUrl: resolvedAudioUrl,
    duration: episode.duration,
    playCount: episode.playCount,
    saveCount: episode.saveCount,
    createdAt: episode.createdAt.toISOString(),
    source: episode.source,
    lowReferences: episode.lowReferences,
    sourcePlatform: episode.sourcePlatform,
    aiProvider: episode.aiProvider,
    aiModel: episode.aiModel,
    ttsProvider: episode.ttsProvider,
    ttsModel: episode.ttsModel,
    language: episode.language,
    aiAutoResolved: episode.aiAutoResolved,
    ttsAutoResolved: episode.ttsAutoResolved,
    failureReason: episode.failureReason,
    failedAtStatus: episode.failedAtStatus,
    errorId: episode.errorId,
    verificationMode: episode.verificationMode,
    currentVersion: episode.currentVersion,
    user: episode.user,
    segments: resolvedSegments,
    interactions,
    references: episode.references.map((r) => ({
      ...r,
      verificationDetails: r.verificationDetails as Record<string, unknown> | null,
    })),
    vocabularyEntries: episode.vocabularyEntries,
    pdfUrl: episode.pdfUrl,
    videoUrl: resolvedVideoUrl ?? null,
    tags: episode.tags.map((pt) => pt.tag),
    versions: resolvedVersions,
    isSaved: false,
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <EpisodePlayerView
          episode={episodeData}
          isOwner={isOwner}
          isAdmin={isAdmin}
          isAuthenticated={!!userId}
          videoStatus={videoStatus}
          avatarStatus={avatarStatus}
        />
        {!userId && episode.visibility === 'PUBLIC' && (
          <JoinCTA creatorHandle={episode.user.handle} creatorName={episode.user.name} />
        )}
      </div>
    </main>
  );
}
