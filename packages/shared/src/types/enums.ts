// String union equivalents of Prisma enums — Prisma-free for mobile consumption

export type UserRole = 'USER' | 'ADMIN' | 'SYSTEM';

export type PodcastStatus =
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
  | 'VIDEO_READY'
  | 'VIDEO_FAILED'
  | 'AVATAR_FAILED'
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

// Mock exams: a full-length practice exam modeled on a flagship CEFR exam's FORMAT.
// Never affiliated with the real institution; structure only, never exam content.
export type ExamInstitution = 'GOETHE' | 'DELE' | 'CAMBRIDGE' | 'CEFR_GENERIC';

export type MockExamStatus =
  | 'GENERATING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'SCORED'
  | 'FAILED';

// The learner's chosen teaching approach, grounded in SLA research. Shapes how
// content is generated so a learner can switch methods if one is not working.
export type PedagogyStyle = 'BALANCED' | 'IMMERSION' | 'GRAMMAR' | 'COMMUNICATION' | 'INTENSIVE';
