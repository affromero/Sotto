// @sotto/shared — shared types, validations, and design tokens

// Enums (string unions, Prisma-free)
export type {
  UserRole,
  EpisodeStatus,
  EpisodeVisibility,
  EpisodeSource,
  Speaker,
  InteractionStatus,
  ReferenceType,
  VerificationStatus,
  NotificationType,
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
  PedagogyStyle,
} from './types/enums';

// Types
export type {
  EpisodeSummary,
  EpisodeDetail,
  SegmentData,
  WordTiming,
  InteractionSummary,
  CreateEpisodeRequest,
  GenerateEpisodeRequest,
  AiModelOption,
  TtsOption,
  ScriptTurn,
  VoiceProfile,
} from './types/episode';

export type { ReferenceData, VerificationLayerResult } from './types/reference';

export type {
  ClassDocument,
  ClassDocumentSection,
  ClassDocumentQuestion,
  ClassDocumentPrompt,
} from './types/class-document';

export type { VerificationMode } from './types/discovery';

export type { PlayerState, PlayerControls } from './types/player';

export type {
  InteractionRequest,
  InteractionResponse,
  ResolutionChoice,
} from './types/interaction';

export type { NotificationData, PushSubscriptionData } from './types/notification';

export type { EpisodeVersionSummary, EpisodeVersionDetail } from './types/version';

export type { ApiKeyData, ApiKeyCreated } from './types/api-key';

export { getContentBadgeLabel, getEpisodeBadges } from './content-badge';
export type { EpisodeBadge } from './content-badge';

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
  createEpisodeSchema,
  interactionSchema,
  updateProfileSchema,
  paginationSchema,
  handleSchema,
  discoveryMessageSchema,
} from './validations';

// API contracts (Zod schemas + endpoint registry for OpenAPI/Rust codegen)
export * from './contracts';
