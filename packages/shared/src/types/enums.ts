// String union equivalents of Prisma enums — Prisma-free for mobile consumption

export type UserRole = 'USER' | 'ADMIN' | 'SYSTEM';

export type PodcastStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'DISCOVERING'
  | 'EXTRACTING'
  | 'RESEARCHING'
  | 'PLANNING'
  | 'SCRIPTING'
  | 'COMPILING'
  | 'SCRIPT_READY'
  | 'GENERATING_AUDIO'
  | 'STITCHING'
  | 'READY'
  | 'UPDATING'
  | 'FAILED'
  | 'IMPORTING'
  | 'TRANSCRIBING'
  | 'DUPLICATE_REVIEW';

export type PodcastVisibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

export type PodcastSource =
  | 'WEB'
  | 'API'
  | 'AGENT'
  | 'IMPORT'
  | 'ADMIN'
  | 'CLASS';

export type Speaker = string;

export type InteractionStatus =
  | 'PENDING'
  | 'ANSWERING'
  | 'ANSWERED'
  | 'RESOLVED'
  | 'INCORPORATING'
  | 'INCORPORATED';

export type ReferenceType = 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE' | 'VIDEO' | 'REPORT';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'REPLACED' | 'REMOVED';

export type NotificationType =
  | 'PODCAST_READY'
  | 'PODCAST_FAILED'
  | 'KEY_INVALID'
  | 'VOICE_REQUEST_RECEIVED'
  | 'VOICE_REQUEST_APPROVED'
  | 'VOICE_REQUEST_DENIED'
  | 'QUESTION_ON_YOUR_PODCAST'
  | 'SCRIPT_READY'
  | 'ACCOUNT_WARNING'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_BANNED'
  | 'CONTENT_REMOVED'
  | 'PLATFORM_ANNOUNCEMENT'
  | 'VOICE_VERIFICATION_REQUIRED'
  | 'VOICE_VERIFICATION_PASSED'
  | 'VOICE_VERIFICATION_FAILED'
  | 'VOICE_BLOCKED_DUPLICATE'
  | 'VOICE_OWNERSHIP_ALERT'
  | 'VOICE_TRACK_FAILED'
  | 'VOICE_TRACK_READY'
  | 'VIDEO_READY'
  | 'MUSIC_READY'
  | 'MUSIC_FAILED'
  | 'PIPELINE_FAILURE'
  | 'REFERRAL_SIGNUP'
  | 'AVATAR_IMAGE_REQUEST_RECEIVED'
  | 'AVATAR_IMAGE_REQUEST_APPROVED'
  | 'AVATAR_IMAGE_REQUEST_DENIED'
  | 'AVATAR_IMAGE_REQUEST_REVOKED';

export type ReportReason =
  | 'HARASSMENT'
  | 'HATE_SPEECH'
  | 'VIOLENCE'
  | 'SEXUAL_CONTENT'
  | 'MISINFORMATION'
  | 'SPAM'
  | 'IMPERSONATION'
  | 'COPYRIGHT'
  | 'VOICE_THEFT'
  | 'MUSIC_UPLOAD'
  | 'FALSE_HUMAN_BADGE'
  | 'FALSE_CLAIM'
  | 'OTHER';

export type ReportStatus =
  | 'PENDING'
  | 'REVIEWING'
  | 'RESOLVED_ACTIONED'
  | 'RESOLVED_DISMISSED'
  | 'ASSET_REPLACED'
  | 'DELISTED';

export type VoiceCloneSource = 'UPLOAD' | 'RECORD' | 'IMPORT';

export type VoiceVerificationStatus =
  | 'PENDING_VERIFICATION'
  | 'AWAITING_CHALLENGE'
  | 'CHALLENGE_SUBMITTED'
  | 'VERIFIED'
  | 'BLOCKED'
  | 'REJECTED'
  | 'ADMIN_VERIFIED'
  | 'ADMIN_BLOCKED'
  | 'PROTECTED';

export type VoiceRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED';

export type VoiceTrackStatus =
  | 'PENDING'
  | 'GENERATING_AUDIO'
  | 'STITCHING'
  | 'READY'
  | 'FAILED'
  | 'STALE';

export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export type FeedbackType = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL' | 'PRAISE' | 'CONCERN';

export type FeedbackStatus = 'NEW' | 'REVIEWED' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';

export type VisualType =
  | 'DATA_CHART'
  | 'QUOTE'
  | 'COMPARISON'
  | 'TIMELINE'
  | 'DIAGRAM'
  | 'STOCK_FOOTAGE'
  | 'AI_ILLUSTRATION'
  | 'TEXT_CARD'
  | 'MAP_OVERLAY'
  | 'DATA_TABLE'
  | 'SOURCE_FIGURE';

export type VideoStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'CLASSIFYING'
  | 'GENERATING_VISUALS'
  | 'GENERATING_TRANSITIONS'
  | 'GENERATING_AVATARS'
  | 'COMPOSING'
  | 'READY'
  | 'FAILED';

export type MusicStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'READY'
  | 'FAILED';

// Language learning
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type SkillType = 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING';

export type ClassStatus =
  | 'LOCKED'
  | 'GENERATING'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'PASSED'
  | 'FAILED';

export type SectionStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'PASSED'
  | 'FAILED';

export type SpeakingGradeStatus = 'PENDING' | 'GRADING' | 'SCORED' | 'FAILED';

export type EdgeType =
  | 'VOCAB_VOCAB'
  | 'VOCAB_GRAMMAR'
  | 'VOCAB_CLASS'
  | 'VOCAB_PODCAST'
  | 'GRAMMAR_GRAMMAR';

// Ungated single-skill practice. VOCAB is first-class (spaced-repetition recall)
// and is intentionally NOT part of SkillType (which gates the four class sections).
export type PracticeKind = 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING' | 'VOCAB';

export type PracticeStatus = 'ACTIVE' | 'COMPLETED';
