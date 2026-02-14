import { z } from 'zod';

/**
 * Zod schemas for behavioral event validation.
 * Used by the /api/events endpoint to validate incoming batches.
 */

export const eventContextSchema = z.object({
  sessionId: z.string().min(1).max(128),
  userId: z.string().max(128).optional(),
  pageUrl: z.string().max(2048),
  deviceType: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  userAgent: z.string().max(512).optional(),
  referrer: z.string().max(2048).optional(),
  clientTs: z.number().int().positive(),
});

// ============ PLAYBACK PAYLOADS ============

const playbackPlaySchema = z.object({
  eventType: z.literal('playback.play'),
  podcastId: z.string(),
  position: z.number().min(0),
  speed: z.number().min(0.25).max(4),
});

const playbackPauseSchema = z.object({
  eventType: z.literal('playback.pause'),
  podcastId: z.string(),
  position: z.number().min(0),
  listenedSinceLast: z.number().min(0),
});

const playbackSeekSchema = z.object({
  eventType: z.literal('playback.seek'),
  podcastId: z.string(),
  fromPosition: z.number().min(0),
  toPosition: z.number().min(0),
});

const playbackSpeedChangeSchema = z.object({
  eventType: z.literal('playback.speed_change'),
  podcastId: z.string(),
  fromSpeed: z.number().min(0.25).max(4),
  toSpeed: z.number().min(0.25).max(4),
  position: z.number().min(0),
});

const playbackHeartbeatSchema = z.object({
  eventType: z.literal('playback.heartbeat'),
  podcastId: z.string(),
  position: z.number().min(0),
  speed: z.number().min(0.25).max(4),
  cumulativeListenSeconds: z.number().min(0),
});

const playbackCompleteSchema = z.object({
  eventType: z.literal('playback.complete'),
  podcastId: z.string(),
  totalListenSeconds: z.number().min(0),
  speed: z.number().min(0.25).max(4),
  pauseCount: z.number().int().min(0),
  seekCount: z.number().int().min(0),
  speedChanges: z.number().int().min(0),
  interactionCount: z.number().int().min(0),
});

const playbackSegmentTransitionSchema = z.object({
  eventType: z.literal('playback.segment_transition'),
  podcastId: z.string(),
  fromSegmentOrder: z.number().int().min(0),
  toSegmentOrder: z.number().int().min(0),
  position: z.number().min(0),
});

const playbackAbandonSchema = z.object({
  eventType: z.literal('playback.abandon'),
  podcastId: z.string(),
  abandonPosition: z.number().min(0),
  abandonPercent: z.number().min(0).max(100),
  totalListenSeconds: z.number().min(0),
  lastSpeed: z.number().min(0.25).max(4),
  pauseCount: z.number().int().min(0),
  seekCount: z.number().int().min(0),
  speedChanges: z.number().int().min(0),
  interactionCount: z.number().int().min(0),
  timeSinceLastSeek: z.number().min(0),
  timeSinceLastSpeedChange: z.number().min(0),
  sessionDuration: z.number().min(0),
});

// ============ FEED PAYLOADS ============

const feedImpressionSchema = z.object({
  eventType: z.literal('feed.impression'),
  podcastId: z.string(),
  position: z.number().int().min(0),
  feedSort: z.string().optional(),
  searchQuery: z.string().optional(),
});

const feedClickSchema = z.object({
  eventType: z.literal('feed.click'),
  podcastId: z.string(),
  position: z.number().int().min(0),
  feedSort: z.string().optional(),
  searchQuery: z.string().optional(),
  dwellTimeMs: z.number().min(0),
});

const feedSearchSchema = z.object({
  eventType: z.literal('feed.search'),
  query: z.string().max(500),
  resultCount: z.number().int().min(0),
  filters: z.record(z.string()).optional(),
});

// ============ DISCOVERY PAYLOADS ============

const discoveryChipClickSchema = z.object({
  eventType: z.literal('discovery.chip_click'),
  label: z.string().max(200),
  chipIndex: z.number().int().min(0),
  messageIndex: z.number().int().min(0),
});

const discoveryChipDismissSchema = z.object({
  eventType: z.literal('discovery.chip_dismiss'),
  label: z.string().max(200),
  chipIndex: z.number().int().min(0),
  messageIndex: z.number().int().min(0),
});

const discoveryMessageSentSchema = z.object({
  eventType: z.literal('discovery.message_sent'),
  messageLength: z.number().int().min(0),
  messageIndex: z.number().int().min(0),
  isChipBased: z.boolean(),
});

const discoveryMetadataCompleteSchema = z.object({
  eventType: z.literal('discovery.metadata_complete'),
  turnsCount: z.number().int().min(0),
  topic: z.string().max(5000),
  depth: z.string().max(50),
  audience: z.string().max(50),
  tone: z.string().max(50),
  durationTarget: z.number().min(0),
});

// ============ SOCIAL PAYLOADS ============

const socialLikeSchema = z.object({ eventType: z.literal('social.like'), podcastId: z.string() });
const socialUnlikeSchema = z.object({
  eventType: z.literal('social.unlike'),
  podcastId: z.string(),
});
const socialSaveSchema = z.object({ eventType: z.literal('social.save'), podcastId: z.string() });
const socialUnsaveSchema = z.object({
  eventType: z.literal('social.unsave'),
  podcastId: z.string(),
});
const socialFollowSchema = z.object({
  eventType: z.literal('social.follow'),
  targetUserId: z.string(),
});
const socialUnfollowSchema = z.object({
  eventType: z.literal('social.unfollow'),
  targetUserId: z.string(),
});
const socialForkSchema = z.object({ eventType: z.literal('social.fork'), podcastId: z.string() });

// ============ NAVIGATION PAYLOADS ============

const pageViewSchema = z.object({
  eventType: z.literal('page.view'),
  path: z.string().max(2048),
  title: z.string().max(500).optional(),
});

// ============ INTERACTION PAYLOADS ============

const interactionAskSchema = z.object({
  eventType: z.literal('interaction.ask'),
  podcastId: z.string(),
  questionLength: z.number().int().min(0),
  playbackPosition: z.number().min(0),
});

// ============ DISCRIMINATED UNION ============

export const eventPayloadSchema = z.discriminatedUnion('eventType', [
  playbackPlaySchema,
  playbackPauseSchema,
  playbackSeekSchema,
  playbackSpeedChangeSchema,
  playbackHeartbeatSchema,
  playbackCompleteSchema,
  playbackSegmentTransitionSchema,
  playbackAbandonSchema,
  feedImpressionSchema,
  feedClickSchema,
  feedSearchSchema,
  discoveryChipClickSchema,
  discoveryChipDismissSchema,
  discoveryMessageSentSchema,
  discoveryMetadataCompleteSchema,
  socialLikeSchema,
  socialUnlikeSchema,
  socialSaveSchema,
  socialUnsaveSchema,
  socialFollowSchema,
  socialUnfollowSchema,
  socialForkSchema,
  pageViewSchema,
  interactionAskSchema,
]);

export const eventBatchSchema = z.object({
  events: z
    .array(
      z.object({
        context: eventContextSchema,
        payload: eventPayloadSchema,
      })
    )
    .min(1)
    .max(200),
});
