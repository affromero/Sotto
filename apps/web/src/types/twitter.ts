import { TweetMentionStatus } from '@prisma/client';

export interface TweetParseResult {
  topic: string;
  title: string;
  depth: 'eli5' | 'quick_overview' | 'standard' | 'deep_dive';
  audienceLevel: 'beginner' | 'intermediate' | 'expert';
  tone: 'casual' | 'professional' | 'socratic' | 'comedic' | 'satirical' | 'storytelling';
  focusAreas: string[];
  audience?: 'general' | 'kids' | 'mature';
  durationTarget?: number;
  sourceUrl?: string;
  sourceUrls?: string[];
  isDebate?: boolean;
  viewpoints?: string[];
  isSelfAuthored?: boolean;
  requestedAiModel?: string;
  requestedTtsProvider?: string;
  requestedTtsModel?: string;
  requestedImageModel?: string;
  requestedVideoModel?: string;
  requestedAvatarModel?: string;
  costPreference?: 'cheapest';
}

export interface TwitterMediaVariant {
  bit_rate?: number;
  content_type: string;
  url: string;
}

export interface TwitterMedia {
  media_key: string;
  type: 'video' | 'animated_gif' | 'photo';
  url?: string;
  duration_ms?: number;
  variants?: TwitterMediaVariant[];
  preview_image_url?: string;
  alt_text?: string;
}

export interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{
    type: 'replied_to' | 'quoted' | 'retweeted';
    id: string;
  }>;
  created_at: string;
  conversation_id?: string;
  attachments?: {
    media_keys?: string[];
  };
  entities?: {
    urls?: Array<{
      start: number;
      end: number;
      url: string;
      expanded_url: string;
      display_url: string;
    }>;
  };
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count?: number;
  };
}

export interface TwitterMentionsResult {
  tweets: TwitterTweet[];
  mediaByKey: Map<string, TwitterMedia>;
}

export interface ThreadTweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  urls: string[];
  createdAt: string;
  inReplyToTweetId?: string;
  publicMetrics?: {
    likeCount: number;
    retweetCount: number;
    replyCount: number;
    quoteCount: number;
  };
  authorVerified?: boolean;
  authorVerifiedType?: string;
  authorBio?: string;
}

export interface ThreadData {
  rootTweet: ThreadTweet;
  replies: ThreadTweet[];
  participantCount: number;
  tweetCount: number;
  isSelfAuthored: boolean;
}

export interface TwitterMention {
  tweet: TwitterTweet;
  parentTweet?: TwitterTweet;
}

export interface TwitterSettingsData {
  twitterHandle: string | null;
  twitterEnabled: boolean;
  voicePreferences: Array<{ speaker: string; voiceId: string }>;
  preferredTtsProvider: string | null;
  preferredTtsModel: string | null;
  preferredAiProvider: string | null;
  preferredAiModel: string | null;
}

export interface TweetMentionData {
  id: string;
  tweetId: string;
  authorId: string;
  text: string;
  parsedTopic: string | null;
  status: TweetMentionStatus;
  podcastId: string | null;
  replyTweetId: string | null;
  createdAt: string;
}

export interface TwitterConfigData {
  autoTweetEnabled: boolean;
  minLikes: number;
  minPlays: number;
  minForks: number;
  trendPollingEnabled: boolean;
  trendPollIntervalMs: number;
  maxTrendPodcastsPerDay: number;
  trendSearchQueries: string[];
  tweetTemplate: string;
  defaultAiModel: string | null;
  defaultTtsProvider: string | null;
  defaultTtsModel: string | null;
}

export type AutoTweetTrigger = 'threshold' | 'manual' | 'trend';
export type AutoTweetStatus = 'pending' | 'posted' | 'failed';

export interface TwitterAutoTweetData {
  id: string;
  podcastId: string;
  tweetId: string | null;
  tweetText: string | null;
  trigger: AutoTweetTrigger;
  status: AutoTweetStatus;
  errorMessage: string | null;
  createdAt: string;
  podcast?: {
    title: string;
    topic: string;
  };
}

export interface TweetAuthor {
  username: string;
  name: string;
  verified?: boolean;
  verifiedType?: string;
}

export interface EnrichedTrendTweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorVerified?: boolean;
  authorVerifiedType?: string;
  engagementScore: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  createdAt: string;
  tweetUrl: string;
}

export interface TweetSearchResult {
  tweets: TwitterTweet[];
  authorMap: Map<string, TweetAuthor>;
}

export interface TrendTopic {
  query: string;
  tweets: EnrichedTrendTweet[];
  totalTweetCount: number;
}
