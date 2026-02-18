export interface ServiceBreakdown {
  service: string;
  count: number;
  totalCost: number;
}

export interface CategoryBreakdown {
  category: string;
  count: number;
  totalCost: number;
}

export interface UsageDataPoint {
  date: string;
  count: number;
  totalCost: number;
}

export interface AnalyticsSummary {
  totalCost: number;
  totalRequests: number;
  avgDurationMs: number | null;
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  byService: ServiceBreakdown[];
  byCategory: CategoryBreakdown[];
  timeSeries: UsageDataPoint[];
  period: string;
}

// Creator analytics

export interface CreatorOverview {
  totalPlays: number;
  uniqueListeners: number;
  avgCompletion: number;
  totalListenHours: number;
  podcastCount: number;
}

export interface CreatorTopPodcast {
  id: string;
  title: string | null;
  plays: number;
  completionPercent: number;
  likes: number;
  forks: number;
}

export interface CreatorDailyPlays {
  day: string;
  plays: number;
}

export interface CreatorEngagement {
  likes: number;
  saves: number;
  comments: number;
  forks: number;
  follows: number;
  interactions: number;
}

export interface CreatorAudienceInsights {
  devices: Array<{ device: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
}

export interface CreatorAnalyticsResponse {
  overview: CreatorOverview;
  topPodcasts: CreatorTopPodcast[];
  dailyPlays: CreatorDailyPlays[];
  engagement: CreatorEngagement;
  audienceInsights: CreatorAudienceInsights;
  period: string;
}
