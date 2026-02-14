// @sotto/shared — shared types, validations, and design tokens

// Enums (string unions, Prisma-free)
export type {
  UserRole,
  PodcastStatus,
  PodcastVisibility,
  PodcastSource,
  Speaker,
  InteractionStatus,
  SubscriptionTier,
  SubscriptionStatus,
  ReferenceType,
  VerificationStatus,
  TweetMentionStatus,
  TeamInviteStatus,
  NotificationType,
  VoiceCloneSource,
  VoiceRequestStatus,
  FeedbackType,
  FeedbackStatus,
} from './types/enums';

// Types
export type {
  PodcastSummary,
  PodcastDetail,
  ForkedFromInfo,
  ForkSummary,
  SegmentData,
  InteractionSummary,
  CreatePodcastRequest,
  GeneratePodcastRequest,
} from './types/podcast';

export type { ReferenceData, VerificationLayerResult } from './types/reference';

export type {
  TweetParseResult,
  TwitterTweet,
  TwitterMention,
  TwitterSettingsData,
  TweetMentionData,
} from './types/twitter';

export type {
  DiscoveryMessage,
  DiscoveryMetadata,
  DiscoveryState,
} from './types/discovery';

export type { PlayerState, PlayerControls } from './types/player';

export type {
  InteractionRequest,
  InteractionResponse,
  ResolutionChoice,
} from './types/interaction';

export type { FeedResponse, FeedSort, FeedFilters } from './types/feed';

export type { NotificationData, PushSubscriptionData } from './types/notification';

export type {
  PodcastVersionSummary,
  PodcastVersionDetail,
} from './types/version';

export type {
  ServiceBreakdown,
  CategoryBreakdown,
  UsageDataPoint,
  AnalyticsSummary,
  AnalyticsResponse,
} from './types/analytics';

export type { ApiKeyData, ApiKeyCreated } from './types/api-key';

export type { TeamSummary, TeamMember, TeamInviteData } from './types/team';

export type {
  ImportPodcastRequest,
  ImportProgress,
  TranscriptionResult,
  SourcePlatformValue,
  SourcePlatformInfo,
} from './types/import';

export { SOURCE_PLATFORMS, SOURCE_PLATFORM_HELP } from './types/import';

export type { PitchDocument, PitchVersion, PitchManifest } from './types/pitch';

// Theme / design tokens
export { colors, spacing, typography, borderRadius } from './theme';

// Validations (shared Zod schemas)
export {
  createPodcastSchema,
  interactionSchema,
  updateProfileSchema,
  feedQuerySchema,
  paginationSchema,
  handleSchema,
  discoveryMessageSchema,
} from './validations';
