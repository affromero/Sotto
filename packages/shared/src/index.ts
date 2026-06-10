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
  NotificationType,
  VoiceCloneSource,
  VoiceRequestStatus,
  VoiceTrackStatus,
  ProposalStatus,
  FeedbackType,
  FeedbackStatus,
  CefrLevel,
  SkillType,
  ClassStatus,
  SectionStatus,
  SpeakingGradeStatus,
  EdgeType,
  PracticeKind,
  PracticeStatus,
  ExamInstitution,
  MockExamStatus,
} from './types/enums';

// Types
export type {
  PodcastSummary,
  PodcastDetail,
  SegmentData,
  WordTiming,
  InteractionSummary,
  CreatePodcastRequest,
  GeneratePodcastRequest,
  AiModelOption,
  TtsOption,
  ScriptTurn,
  VoiceProfile,
  VoiceTrackSummary,
  VoiceTrackContributor,
} from './types/podcast';

export type { ReferenceData, VerificationLayerResult } from './types/reference';

export type {
  ClassDocument,
  ClassDocumentSection,
  ClassDocumentQuestion,
  ClassDocumentPrompt,
} from './types/class-document';

export type {
  DiscoveryMessage,
  DiscoveryMetadata,
  DiscoveryState,
  TasteQuestion,
  TasteAnswer,
  InspireSection,
} from './types/discovery';

export { INSPIRE_SECTION_LABELS } from './types/discovery';


export type { PlayerState, PlayerControls } from './types/player';

export type {
  InteractionRequest,
  InteractionResponse,
  ResolutionChoice,
} from './types/interaction';

export type { NotificationData, PushSubscriptionData } from './types/notification';

export type { PodcastVersionSummary, PodcastVersionDetail } from './types/version';

export type {
  ServiceBreakdown,
  CategoryBreakdown,
  UsageDataPoint,
  AnalyticsSummary,
  AnalyticsResponse,
  CreatorOverview,
  CreatorTopPodcast,
  CreatorDailyPlays,
  CreatorPrivateActivity,
  CreatorAudienceInsights,
  CreatorAnalyticsResponse,
} from './types/analytics';

export type { ApiKeyData, ApiKeyCreated } from './types/api-key';

export type {
  EventContext,
  EventPayload,
  EventType,
  BehavioralEventInput,
  EventBatch,
} from './types/events';

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
  STT_PROVIDER_DISPLAY,
  LANGUAGE_DISPLAY,
  getAiProviderLabel,
  getAiModelLabel,
  getTtsProviderLabel,
  getTtsModelLabel,
  getLanguageLabel,
} from './provider-display';

export type { PitchDocument, PitchVersion, PitchManifest } from './types/pitch';

// Brand copy (single source of truth)
export { BRAND } from './brand';
export type { Brand } from './brand';

// Theme / design tokens
export { colors, darkColors, spacing, typography, borderRadius } from './theme';
export type { ColorScheme } from './theme';

// Generation messages (rotating sub-messages for pipeline stages)
export { STAGE_MESSAGES, resolveMessage } from './generation-messages';
export type { StageMessage, StageMessagePool } from './generation-messages';

// Validations (shared Zod schemas)
export {
  createPodcastSchema,
  interactionSchema,
  updateProfileSchema,
  paginationSchema,
  handleSchema,
  discoveryMessageSchema,
} from './validations';
