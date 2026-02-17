// @sotto/shared — shared types, validations, and design tokens

// Enums (string unions, Prisma-free)
export type {
  UserRole,
  PodcastStatus,
  PodcastVisibility,
  PodcastSource,
  Speaker,
  InteractionStatus,
  ReferenceType,
  VerificationStatus,
  TweetMentionStatus,
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
  TasteQuestion,
  TasteAnswer,
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

export type {
  ImportPodcastRequest,
  ImportProgress,
  TranscriptionResult,
  SourcePlatformValue,
  SourcePlatformInfo,
  SttProviderId,
} from './types/import';

export { SOURCE_PLATFORMS, SOURCE_PLATFORM_HELP } from './types/import';

export { getContentBadgeLabel, getPodcastBadges } from './content-badge';
export type { PodcastBadge } from './content-badge';

export {
  AI_PROVIDER_DISPLAY,
  AI_MODEL_DISPLAY,
  AI_MODEL_SHORT_DISPLAY,
  TTS_PROVIDER_DISPLAY,
  TTS_MODEL_DISPLAY,
  LANGUAGE_DISPLAY,
  getAiProviderLabel,
  getAiModelLabel,
  getTtsProviderLabel,
  getTtsModelLabel,
  getLanguageLabel,
} from './provider-display';

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
