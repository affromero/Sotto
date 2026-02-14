/**
 * Behavioral event types for the Sotto ML data pipeline.
 * Discriminated union of all event categories.
 */

// ============ EVENT CONTEXT (shared by all events) ============

export interface EventContext {
  sessionId: string;
  userId?: string;
  pageUrl: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
  userAgent?: string;
  referrer?: string;
  clientTs: number; // unix ms
}

// ============ PLAYBACK EVENTS ============

export interface PlaybackPlayEvent {
  eventType: 'playback.play';
  podcastId: string;
  position: number;
  speed: number;
}

export interface PlaybackPauseEvent {
  eventType: 'playback.pause';
  podcastId: string;
  position: number;
  listenedSinceLast: number;
}

export interface PlaybackSeekEvent {
  eventType: 'playback.seek';
  podcastId: string;
  fromPosition: number;
  toPosition: number;
}

export interface PlaybackSpeedChangeEvent {
  eventType: 'playback.speed_change';
  podcastId: string;
  fromSpeed: number;
  toSpeed: number;
  position: number;
}

export interface PlaybackHeartbeatEvent {
  eventType: 'playback.heartbeat';
  podcastId: string;
  position: number;
  speed: number;
  cumulativeListenSeconds: number;
}

export interface PlaybackCompleteEvent {
  eventType: 'playback.complete';
  podcastId: string;
  totalListenSeconds: number;
  speed: number;
  pauseCount: number;
  seekCount: number;
  speedChanges: number;
  interactionCount: number;
}

export interface PlaybackSegmentTransitionEvent {
  eventType: 'playback.segment_transition';
  podcastId: string;
  fromSegmentOrder: number;
  toSegmentOrder: number;
  position: number;
}

export interface PlaybackAbandonEvent {
  eventType: 'playback.abandon';
  podcastId: string;
  abandonPosition: number;
  abandonPercent: number;
  totalListenSeconds: number;
  lastSpeed: number;
  pauseCount: number;
  seekCount: number;
  speedChanges: number;
  interactionCount: number;
  timeSinceLastSeek: number;
  timeSinceLastSpeedChange: number;
  sessionDuration: number;
}

// ============ FEED EVENTS ============

export interface FeedImpressionEvent {
  eventType: 'feed.impression';
  podcastId: string;
  position: number;
  feedSort?: string;
  searchQuery?: string;
}

export interface FeedClickEvent {
  eventType: 'feed.click';
  podcastId: string;
  position: number;
  feedSort?: string;
  searchQuery?: string;
  dwellTimeMs: number;
}

export interface FeedSearchEvent {
  eventType: 'feed.search';
  query: string;
  resultCount: number;
  filters?: Record<string, string>;
}

// ============ DISCOVERY EVENTS ============

export interface DiscoveryChipClickEvent {
  eventType: 'discovery.chip_click';
  label: string;
  chipIndex: number;
  messageIndex: number;
}

export interface DiscoveryChipDismissEvent {
  eventType: 'discovery.chip_dismiss';
  label: string;
  chipIndex: number;
  messageIndex: number;
}

export interface DiscoveryMessageSentEvent {
  eventType: 'discovery.message_sent';
  messageLength: number;
  messageIndex: number;
  isChipBased: boolean;
}

export interface DiscoveryMetadataCompleteEvent {
  eventType: 'discovery.metadata_complete';
  turnsCount: number;
  topic: string;
  depth: string;
  audience: string;
  tone: string;
  durationTarget: number;
}

// ============ SOCIAL EVENTS ============

export interface SocialLikeEvent {
  eventType: 'social.like';
  podcastId: string;
}

export interface SocialUnlikeEvent {
  eventType: 'social.unlike';
  podcastId: string;
}

export interface SocialSaveEvent {
  eventType: 'social.save';
  podcastId: string;
}

export interface SocialUnsaveEvent {
  eventType: 'social.unsave';
  podcastId: string;
}

export interface SocialFollowEvent {
  eventType: 'social.follow';
  targetUserId: string;
}

export interface SocialUnfollowEvent {
  eventType: 'social.unfollow';
  targetUserId: string;
}

export interface SocialForkEvent {
  eventType: 'social.fork';
  podcastId: string;
}

// ============ NAVIGATION EVENTS ============

export interface PageViewEvent {
  eventType: 'page.view';
  path: string;
  title?: string;
}

// ============ INTERACTION EVENTS ============

export interface InteractionAskEvent {
  eventType: 'interaction.ask';
  podcastId: string;
  questionLength: number;
  playbackPosition: number;
}

// ============ DISCRIMINATED UNION ============

export type EventPayload =
  | PlaybackPlayEvent
  | PlaybackPauseEvent
  | PlaybackSeekEvent
  | PlaybackSpeedChangeEvent
  | PlaybackHeartbeatEvent
  | PlaybackCompleteEvent
  | PlaybackSegmentTransitionEvent
  | PlaybackAbandonEvent
  | FeedImpressionEvent
  | FeedClickEvent
  | FeedSearchEvent
  | DiscoveryChipClickEvent
  | DiscoveryChipDismissEvent
  | DiscoveryMessageSentEvent
  | DiscoveryMetadataCompleteEvent
  | SocialLikeEvent
  | SocialUnlikeEvent
  | SocialSaveEvent
  | SocialUnsaveEvent
  | SocialFollowEvent
  | SocialUnfollowEvent
  | SocialForkEvent
  | PageViewEvent
  | InteractionAskEvent;

export type EventType = EventPayload['eventType'];

export interface BehavioralEventInput {
  context: EventContext;
  payload: EventPayload;
}

export interface EventBatch {
  events: BehavioralEventInput[];
}
