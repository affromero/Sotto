// String union equivalents of Prisma enums — Prisma-free for mobile consumption

export type UserRole = 'USER' | 'ADMIN';

export type EpisodeStatus =
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
  | 'TRANSCRIBING';

export type EpisodeVisibility = 'UNLISTED' | 'PRIVATE';

export type EpisodeSource = 'WEB' | 'API' | 'AGENT' | 'IMPORT' | 'ADMIN' | 'CLASS';

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
  | 'EPISODE_READY'
  | 'EPISODE_FAILED'
  | 'KEY_INVALID'
  | 'SCRIPT_READY'
  | 'PLATFORM_ANNOUNCEMENT'
  | 'PIPELINE_FAILURE';

export type FeedbackType = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL' | 'PRAISE' | 'CONCERN';

export type FeedbackStatus = 'NEW' | 'REVIEWED' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';

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
  | 'VOCAB_EPISODE'
  | 'GRAMMAR_GRAMMAR';

// Ungated single-skill practice. VOCAB is first-class (spaced-repetition recall)
// and is intentionally NOT part of SkillType (which gates the four class sections).
export type PracticeKind =
  | 'FULL'
  | 'GRAMMAR'
  | 'READING'
  | 'LISTENING'
  | 'SPEAKING'
  | 'WRITING'
  | 'VOCAB';

export type PracticeStatus = 'ACTIVE' | 'COMPLETED';

export type FocusTargetKind = 'WORD' | 'PHRASE' | 'SENTENCE';

export type FocusTargetSource = 'TRANSCRIPT' | 'CLASS' | 'PRACTICE' | 'NOTES' | 'LIVE' | 'MANUAL';

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
