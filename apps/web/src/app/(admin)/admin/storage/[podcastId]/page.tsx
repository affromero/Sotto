import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { listObjectsDetailed } from '@/lib/r2';
import { findByVoiceId } from '@/lib/voice-pool';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { computeCompletenessChecklist } from '@/lib/data-completeness';
import type { CompletenessInput } from '@/lib/data-completeness';
import { getPodcastCostBreakdown } from '@/lib/podcast-cost-stats';
import { InspectorContent } from './InspectorContent';
import { InspectorVoices } from './InspectorVoices';
import styles from './page.module.css';

interface PageProps {
  params: Promise<{ podcastId: string }>;
}

export default async function PodcastInspectorPage({ params }: PageProps) {
  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      audioUrl: true,
      aiProvider: true,
      aiModel: true,
      ttsProvider: true,
      ttsModel: true,
      sttProvider: true,
      sttModel: true,
      playCount: true,
      likeCount: true,
      forkCount: true,
      saveCount: true,
      commentCount: true,
      user: { select: { name: true, email: true } },
    },
  });

  if (!podcast) notFound();

  // Parallel data fetching (split into two groups for TypeScript tuple inference)
  const [
    script,
    segments,
    references,
    discovery,
    podcastVoices,
    voiceTracks,
    podcastTags,
    interactions,
    ratingsAgg,
    playbackCount,
  ] = await Promise.all([
    // Script
    prisma.script.findUnique({
      where: { podcastId },
      select: { turns: true, soundCues: true, verificationAttempts: true },
    }),
    // Segments
    prisma.segment.findMany({
      where: { podcastId },
      select: { id: true, speaker: true, text: true, audioUrl: true, order: true, duration: true },
      orderBy: { order: 'asc' },
    }),
    // References
    prisma.reference.findMany({
      where: { podcastId },
      select: { verificationStatus: true },
    }),
    // Discovery
    prisma.discovery.findUnique({
      where: { podcastId },
      select: {
        topic: true,
        depth: true,
        audience: true,
        tone: true,
        focusAreas: true,
        _count: { select: { messages: true } },
      },
    }),
    // Voice assignments
    prisma.podcastVoice.findMany({
      where: { podcastId },
      select: { speaker: true, voiceId: true, provider: true },
    }),
    // Voice tracks
    prisma.voiceTrack.findMany({
      where: { podcastId },
      select: {
        id: true,
        name: true,
        ttsProvider: true,
        ttsModel: true,
        status: true,
        voices: { select: { speaker: true, voiceId: true, provider: true } },
        _count: { select: { segments: true } },
      },
    }),
    // Tags
    prisma.podcastTag.findMany({
      where: { podcastId },
      select: { tag: { select: { name: true, slug: true } } },
    }),
    // Interactions
    prisma.interaction.findMany({
      where: { podcastId },
      select: { status: true, incorporated: true },
    }),
    // Ratings
    prisma.podcastRating.aggregate({
      where: { podcastId },
      _avg: {
        overallSatisfaction: true,
        voiceNaturalness: true,
        contentAccuracy: true,
        conversationFlow: true,
      },
      _count: true,
    }),
    // Playback sessions
    prisma.playbackSession.count({ where: { podcastId } }),
  ]);

  const [
    podcastFeature,
    apiCostBreakdown,
    pipelineEventsRaw,
    segmentVoiceMapRaw,
    r2Files,
  ] = await Promise.all([
    // ML Features
    prisma.podcastFeature.findUnique({
      where: { podcastId },
      select: {
        avgCompletionRate: true,
        totalUniqueListeners: true,
        totalListenMinutes: true,
        relistenRate: true,
      },
    }),
    // API costs (4-bucket breakdown)
    getPodcastCostBreakdown(podcastId),
    // Pipeline events
    prisma.pipelineEvent.groupBy({
      by: ['type'],
      where: { podcastId },
      _count: true,
    }),
    // Segment voice map
    prisma.voiceTrackSegment.findMany({
      where: { segment: { podcastId } },
      select: {
        segmentId: true,
        voiceTrackId: true,
        audioUrl: true,
        duration: true,
      },
    }),
    // R2 files
    listObjectsDetailed(`podcasts/${podcastId}/`).catch(() => []),
  ]);

  // Process script data
  const turns = Array.isArray(script?.turns) ? (script.turns as { speaker: string; text: string }[]) : [];
  const soundCues = Array.isArray(script?.soundCues) ? script.soundCues : [];
  const wordCount = turns.reduce((sum, t) => sum + t.text.split(/\s+/).length, 0);

  const scriptData = script
    ? {
        turns,
        wordCount,
        soundCueCount: soundCues.length,
        verificationAttempts: script.verificationAttempts,
      }
    : null;

  // Process references
  const refByStatus: Record<string, number> = {};
  for (const ref of references) {
    refByStatus[ref.verificationStatus] = (refByStatus[ref.verificationStatus] ?? 0) + 1;
  }

  // Process segments
  const segmentsWithAudio = segments.filter((s) => s.audioUrl !== null).length;
  const durations = segments.map((s) => s.duration).filter((d): d is number => d !== null);
  const segmentData = {
    total: segments.length,
    withAudio: segmentsWithAudio,
    withoutAudio: segments.length - segmentsWithAudio,
    durationRange: durations.length > 0 ? { min: Math.min(...durations), max: Math.max(...durations) } : null,
    totalDuration: durations.reduce((sum, d) => sum + d, 0),
  };

  // Process interactions
  const interactionByStatus: Record<string, number> = {};
  let incorporatedCount = 0;
  for (const i of interactions) {
    interactionByStatus[i.status] = (interactionByStatus[i.status] ?? 0) + 1;
    if (i.incorporated) incorporatedCount++;
  }

  // Process discovery
  const discoveryData = discovery
    ? {
        messageCount: discovery._count.messages,
        topic: discovery.topic,
        depth: discovery.depth,
        audience: discovery.audience,
        tone: discovery.tone,
        focusAreas: discovery.focusAreas,
      }
    : null;

  // Process tags
  const tags = podcastTags.map((pt) => pt.tag);

  // Process ratings
  const ratingsData =
    ratingsAgg._count > 0
      ? {
          count: ratingsAgg._count,
          avgOverall: ratingsAgg._avg.overallSatisfaction ?? 0,
          avgVoice: ratingsAgg._avg.voiceNaturalness ?? 0,
          avgAccuracy: ratingsAgg._avg.contentAccuracy ?? 0,
          avgFlow: ratingsAgg._avg.conversationFlow ?? 0,
        }
      : null;

  // Process pipeline events
  const pipelineEvents: Record<string, number> = {};
  for (const e of pipelineEventsRaw) {
    pipelineEvents[e.type] = e._count;
  }

  // Process voice assignments with resolved names
  const voiceAssignments = podcastVoices.map((v) => ({
    speaker: v.speaker,
    voiceId: v.voiceId,
    provider: v.provider,
    resolvedName: v.voiceId ? (findByVoiceId(v.voiceId)?.name ?? null) : null,
  }));

  // Process voice tracks
  const voiceTrackData = voiceTracks.map((vt) => ({
    id: vt.id,
    name: vt.name,
    ttsProvider: vt.ttsProvider,
    ttsModel: vt.ttsModel,
    status: vt.status,
    segmentCount: vt._count.segments,
    voices: vt.voices.map((v) => ({
      speaker: v.speaker,
      voiceId: v.voiceId,
      provider: v.provider,
    })),
  }));

  // Process segment voice map
  const segmentVoiceMap = segments.map((seg) => {
    const trackSegments = voiceTracks.map((vt) => {
      const vts = segmentVoiceMapRaw.find(
        (s) => s.segmentId === seg.id && s.voiceTrackId === vt.id
      );
      return {
        trackId: vt.id,
        trackName: vt.name,
        hasAudio: vts?.audioUrl !== null && vts?.audioUrl !== undefined,
        duration: vts?.duration ?? null,
      };
    });

    return {
      order: seg.order,
      speaker: seg.speaker,
      textExcerpt: seg.text.length > 80 ? seg.text.slice(0, 80) + '...' : seg.text,
      hasAudio: seg.audioUrl !== null,
      trackSegments,
    };
  });

  // Compute completeness
  const verifiedRefs = references.filter((r) => r.verificationStatus === 'VERIFIED').length;
  const answeredStatuses = ['ANSWERED', 'RESOLVED', 'INCORPORATING', 'INCORPORATED'];
  const answeredCount = interactions.filter((i) => answeredStatuses.includes(i.status)).length;
  const completedTrackCount = voiceTracks.filter((vt) => vt.status === 'READY').length;
  const segVoiceMapWithAudio = segmentVoiceMapRaw.filter((s) => s.audioUrl !== null).length;

  const completenessInput: CompletenessInput = {
    hasScript: turns.length > 0,
    hasAudio: podcast.audioUrl !== null,
    segmentCount: segments.length,
    segmentsWithAudio,
    referenceCount: references.length,
    verifiedReferenceCount: verifiedRefs,
    discoveryMessageCount: discovery?._count.messages ?? 0,
    voiceAssignmentCount: podcastVoices.length,
    completedVoiceTrackCount: completedTrackCount,
    tagCount: podcastTags.length,
    answeredInteractionCount: answeredCount,
    ratingCount: ratingsAgg._count,
    playbackSessionCount: playbackCount,
    hasMLFeatures: podcastFeature !== null,
    apiCostLogCount: apiCostBreakdown.callCount,
    segmentVoiceMapCount: segVoiceMapWithAudio,
  };

  const completeness = computeCompletenessChecklist(completenessInput);

  // Get all TTS provider metadata
  const providerMeta = getAllProviderMeta();

  return (
    <div className={styles.container}>
      {/* Breadcrumb */}
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/admin/storage" className={styles.breadcrumbLink}>
          &larr; Back to Storage
        </Link>
      </nav>

      <InspectorContent
        podcast={podcast}
        script={scriptData}
        r2Files={r2Files}
        references={{
          total: references.length,
          byStatus: refByStatus,
        }}
        segments={segmentData}
        interactions={{
          total: interactions.length,
          byStatus: interactionByStatus,
          incorporatedCount,
        }}
        discovery={discoveryData}
        tags={tags}
        ratings={ratingsData}
        apiCosts={{
          totalCost: apiCostBreakdown.total,
          callCount: apiCostBreakdown.callCount,
          text: apiCostBreakdown.text,
          audio: apiCostBreakdown.audio,
          video: apiCostBreakdown.video,
          avatar: apiCostBreakdown.avatar,
        }}
        pipelineEvents={pipelineEvents}
        mlFeatures={podcastFeature}
        completeness={completeness}
      />

      <InspectorVoices
        voiceAssignments={voiceAssignments}
        voiceTracks={voiceTrackData}
        segmentVoiceMap={segmentVoiceMap}
        providerMeta={providerMeta}
      />
    </div>
  );
}
