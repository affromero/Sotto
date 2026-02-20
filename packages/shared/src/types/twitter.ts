import type { TweetMentionStatus } from './enums';

export interface TweetParseResult {
  topic: string;
  title: string;
  depth: 'eli5' | 'quick_overview' | 'standard' | 'deep_dive';
  audienceLevel: 'beginner' | 'intermediate' | 'expert';
  tone: 'casual' | 'professional' | 'socratic';
  focusAreas: string[];
  sourceUrl?: string;
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
}

export interface TwitterMention {
  tweet: TwitterTweet;
  parentTweet?: TwitterTweet;
}

export interface TwitterSettingsData {
  twitterHandle: string | null;
  twitterEnabled: boolean;
  voicePreferences: Array<{ speaker: string; voiceId: string }>;
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
