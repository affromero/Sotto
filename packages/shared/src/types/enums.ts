// String union equivalents of Prisma enums — Prisma-free for mobile consumption

export type UserRole = 'USER' | 'ADMIN' | 'SYSTEM';

export type PodcastStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'DISCOVERING'
  | 'EXTRACTING'
  | 'SCRIPTING'
  | 'VERIFYING_SCRIPT'
  | 'VALIDATING_REFERENCES'
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

export type PodcastSource = 'WEB' | 'TWITTER' | 'TELEGRAM' | 'API' | 'IMPORT';

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

export type TweetMentionStatus =
  | 'PENDING'
  | 'PARSING'
  | 'GENERATING'
  | 'READY'
  | 'REPLIED'
  | 'FAILED'
  | 'IGNORED';

export type TelegramMessageStatus =
  | 'PENDING'
  | 'DISCOVERING'
  | 'GENERATING'
  | 'READY'
  | 'REPLIED'
  | 'FAILED'
  | 'IGNORED';

export type NotificationType =
  | 'PODCAST_READY'
  | 'PODCAST_FAILED'
  | 'KEY_INVALID'
  | 'PODCAST_LIKED'
  | 'PODCAST_FORKED'
  | 'NEW_FOLLOWER'
  | 'SIMILAR_PODCAST_CREATED'
  | 'TWITTER_PODCAST_READY'
  | 'TELEGRAM_PODCAST_READY'
  | 'VOICE_REQUEST_RECEIVED'
  | 'VOICE_REQUEST_APPROVED'
  | 'VOICE_REQUEST_DENIED'
  | 'QUESTION_ON_YOUR_PODCAST'
  | 'QUESTION_UPVOTED'
  | 'COMMENT_ON_YOUR_PODCAST'
  | 'COMMENT_REPLY'
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
  | 'PIPELINE_FAILURE'
  | 'REFERRAL_SIGNUP';

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
  | 'RESOLVED_DISMISSED';

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
  | 'TEXT_CARD';

export type VideoStatus =
  | 'PENDING'
  | 'CLASSIFYING'
  | 'GENERATING_VISUALS'
  | 'GENERATING_AVATARS'
  | 'COMPOSING'
  | 'READY'
  | 'FAILED';
