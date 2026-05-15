import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { getVideoGenerationStatus, getAvatarGenerationStatus } from '@/lib/video-gate';
import { getMusicGenerationStatus } from '@/lib/music-gate';
import { resolveAudioUrl } from '@/lib/r2';
import { findVoiceName, formatModelName } from '@/lib/voice-pool';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import type { Metadata } from 'next';
import { PodcastPlayerView } from './PodcastPlayerView';
import { PodcastJsonLd } from '@/components/player/PodcastJsonLd';
import { CostBreakdown } from '@/components/player/CostBreakdown';
import { getPodcastCostBreakdown } from '@/lib/podcast-cost-stats';
import { JoinCTA } from '@/components/referral/JoinCTA';
import { getPodcastForDetailPage } from '@/lib/podcast-data';
import styles from './page.module.css';

interface PodcastPageProps {
  params: Promise<{ podcastId: string }>;
}

export async function generateMetadata({ params }: PodcastPageProps): Promise<Metadata> {
  const { podcastId } = await params;
  const podcast = await getPodcastForDetailPage(podcastId);

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
        const readyTracks = podcast.voiceTracks.filter(t => t.status === 'READY');
        const defaultTrack = podcast.defaultVoiceTrackId
          ? readyTracks.find(t => t.id === podcast.defaultVoiceTrackId)
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

  // Parallel: auth + cached podcast fetch (cache hit if generateMetadata already ran)
  const [session, podcast] = await Promise.all([
    auth(),
    getPodcastForDetailPage(podcastId),
  ]);
  const userId = session?.user?.id;

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

  const isOwner = userId === podcast.userId;
  const isAdmin = session?.user?.role === 'ADMIN';

  // Compute voiceIds needed for clone lookup (pure computation, no DB)
  const allVoiceIds = [...new Set(
    podcast.voiceTracks.flatMap((t) => t.voices.map((v) => v.voiceId)).filter(Boolean)
  )];

  // All secondary queries in parallel
  const [interactions, quizData, likeAndSave, clones, ownerData] = await Promise.all([
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

    // Quiz
    prisma.podcastQuiz.findUnique({
      where: { podcastId: podcast.id },
      select: { status: true, attemptCount: true, avgScore: true },
    }),

    // Like + Save
    userId
      ? Promise.all([
          prisma.like.findUnique({
            where: { userId_podcastId: { userId, podcastId: podcast.id } },
          }),
          prisma.save.findUnique({
            where: { userId_podcastId: { userId, podcastId: podcast.id } },
          }),
        ])
      : Promise.resolve([null, null] as const),

    // Voice clone names
    allVoiceIds.length > 0
      ? prisma.voiceClone.findMany({
          where: { externalVoiceId: { in: allVoiceIds } },
          select: { externalVoiceId: true, name: true },
        })
      : Promise.resolve([]),

    // Owner-only gates (already internally parallel)
    isOwner && userId
      ? Promise.all([
          getFreeTierStatus(userId),
          getVideoGenerationStatus(userId),
          getAvatarGenerationStatus(userId),
          getMusicGenerationStatus(userId),
          podcast.status === 'READY' ? getPodcastCostBreakdown(podcastId) : Promise.resolve(undefined),
        ])
      : Promise.resolve(null),
  ]);

  // Quiz
  const hasQuiz = quizData?.status === 'READY';
  const quizStats = hasQuiz && quizData.attemptCount > 0
    ? { attemptCount: quizData.attemptCount, avgScore: quizData.avgScore }
    : undefined;

  // Like/Save
  const [like, save] = likeAndSave;
  const isLiked = !!like;
  const isSaved = !!save;

  // Owner data
  let canMakePrivate: boolean | undefined;
  let videoStatus: { dailyUsed: number; dailyLimit: number; dailyRemaining: number; resetInSeconds?: number; isByokUser: boolean; isProUser: boolean } | undefined;
  let avatarStatus: { dailyUsed: number; dailyLimit: number; dailyRemaining: number; resetInSeconds?: number; isByokUser: boolean; isProUser: boolean } | undefined;
  let musicStatus: { dailyUsed: number; dailyLimit: number; dailyRemaining: number; resetInSeconds?: number; isByokUser: boolean; isProUser: boolean } | undefined;
  let costBreakdown: Awaited<ReturnType<typeof getPodcastCostBreakdown>> | undefined;
  let ownerIsPro = false;
  let ownerIsByok = false;
  if (ownerData) {
    const [freeTier, vidStatus, avStatus, musStatus, costStats] = ownerData;
    canMakePrivate = true;
    videoStatus = vidStatus;
    avatarStatus = avStatus;
    musicStatus = musStatus;
    costBreakdown = costStats;
    ownerIsPro = freeTier.isProUser;
    ownerIsByok = freeTier.isByokUser;
  }

  const visibility = podcast.visibility;

  // Build a voiceId → name map for tooltip enrichment
  const voiceNameMap = new Map<string, string>();
  for (const clone of clones) {
    voiceNameMap.set(clone.externalVoiceId, clone.name);
  }
  for (const voiceId of allVoiceIds) {
    if (!voiceNameMap.has(voiceId)) {
      const name = findVoiceName(voiceId);
      if (name) voiceNameMap.set(voiceId, name);
    }
  }

  // Build original track display name from podcast's own voice assignments
  const originalVoiceNames: string[] = [];
  const seenVoiceIds = new Set<string>();
  for (const pv of podcast.voices) {
    if (pv.voiceId && !seenVoiceIds.has(pv.voiceId)) {
      seenVoiceIds.add(pv.voiceId);
      const name = voiceNameMap.get(pv.voiceId) ?? findVoiceName(pv.voiceId) ?? pv.voiceId;
      originalVoiceNames.push(name);
    }
  }
  const providerLabel = podcast.ttsProvider
    ? getProviderMeta(podcast.ttsProvider as Parameters<typeof getProviderMeta>[0]).displayName
    : null;
  const modelLabel = podcast.ttsModel ? formatModelName(podcast.ttsModel) : null;
  const providerSuffix = providerLabel
    ? `[${modelLabel ? `${providerLabel} - ${modelLabel}` : providerLabel}]`
    : '';
  const originalTrackName = originalVoiceNames.length > 0
    ? `${originalVoiceNames.join(' + ')} ${providerSuffix}`.trim()
    : providerSuffix || 'Original';

  // Resolve audio URLs: presigned for PRIVATE/UNLISTED, public CDN for PUBLIC
  const [resolvedAudioUrl, resolvedSegments, resolvedVersions, resolvedVoiceTracks, resolvedVideoUrl, resolvedMusicUrl] =
    await Promise.all([
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
      Promise.all(
        (isOwner
          ? podcast.voiceTracks
          : podcast.voiceTracks.filter((t) =>
              t.status === 'READY' &&
              (t.proposalStatus === null || t.proposalStatus === 'ACCEPTED')
            )
        ).map(async (t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          audioUrl: await resolveAudioUrl(t.audioUrl, visibility),
          duration: t.duration,
          ttsProvider: t.ttsProvider,
          ttsModel: t.ttsModel,
          failureReason: t.failureReason,
          voices: t.voices.map((v) => ({
            ...v,
            voiceName: voiceNameMap.get(v.voiceId) ?? null,
          })),
          contributor: t.contributor,
          proposalStatus: t.proposalStatus,
          proposalMessage: t.proposalMessage,
        }))
      ),
      podcast.videoUrl ? resolveAudioUrl(podcast.videoUrl, visibility) : Promise.resolve(null),
      podcast.musicUrl ? resolveAudioUrl(podcast.musicUrl, visibility) : Promise.resolve(null),
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
    lowReferences: podcast.lowReferences,
    sourcePlatform: podcast.sourcePlatform,
    aiProvider: podcast.aiProvider,
    aiModel: podcast.aiModel,
    ttsProvider: podcast.ttsProvider,
    ttsModel: podcast.ttsModel,
    language: podcast.language,
    aiAutoResolved: podcast.aiAutoResolved,
    ttsAutoResolved: podcast.ttsAutoResolved,
    forkedFromId: podcast.forkedFromId,
    isVoiceOnlyFork: podcast.isVoiceOnlyFork,
    ownerIsPro: false,
    remixNote: podcast.remixNote,
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
    musicUrl: resolvedMusicUrl ?? null,
    musicVolume: podcast.musicVolume,
    musicBaked: podcast.musicBaked,
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
      isVoiceOnlyFork: f.isVoiceOnlyFork,
      createdAt: f.createdAt.toISOString(),
      user: f.user,
    })),
    versions: resolvedVersions,
    voiceTracks: resolvedVoiceTracks,
    defaultVoiceTrackId: podcast.defaultVoiceTrackId,
    originalTrackName,
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
        <PodcastPlayerView podcast={podcastData} isOwner={isOwner} isAdmin={isAdmin} isAuthenticated={!!userId} currentUserId={userId} canMakePrivate={canMakePrivate} videoStatus={videoStatus} avatarStatus={avatarStatus} musicStatus={musicStatus} hasQuiz={hasQuiz} quizStats={quizStats} />
        {costBreakdown && costBreakdown.total > 0 && (
          <CostBreakdown breakdown={costBreakdown} isPro={ownerIsPro} isByok={ownerIsByok} />
        )}
        {!userId && podcast.visibility === 'PUBLIC' && (
          <JoinCTA creatorHandle={podcast.user.handle} creatorName={podcast.user.name} />
        )}
      </div>
    </main>
  );
}
