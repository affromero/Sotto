// String union equivalents of Prisma enums — Prisma-free for mobile consumption

export type UserRole = 'USER' | 'CREATOR' | 'ADMIN' | 'SYSTEM';

export type PodcastStatus =
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
  | 'TRANSCRIBING';

export type PodcastVisibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

export type PodcastSource = 'WEB' | 'TWITTER' | 'TELEGRAM' | 'API' | 'IMPORT';

export type Speaker = 'HOST' | 'EXPERT';

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
  | 'CONTENT_REMOVED';

export type VoiceCloneSource = 'UPLOAD' | 'RECORD';

export type VoiceRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED';

export type FeedbackType = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL' | 'PRAISE' | 'CONCERN';

export type FeedbackStatus = 'NEW' | 'REVIEWED' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';
