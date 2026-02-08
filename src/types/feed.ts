import { PodcastSummary } from './podcast';

export interface FeedResponse {
  podcasts: PodcastSummary[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type FeedSort = 'recent' | 'popular' | 'trending';

export interface FeedFilters {
  search?: string;
  tag?: string;
  sort: FeedSort;
  page: number;
  limit: number;
}
