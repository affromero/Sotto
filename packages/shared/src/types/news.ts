export const NEWS_CATEGORIES = ['tech', 'science', 'politics', 'business', 'world', 'culture'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  tech: 'Tech',
  science: 'Science',
  politics: 'Politics',
  business: 'Business',
  world: 'World',
  culture: 'Culture',
};

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  source: string;
  category: string | null;
  pubDate: string | null;
  relatedPodcastId?: string;
  relatedPodcastSlug?: string;
  relatedUserHandle?: string;
}

export interface NewsMeta {
  latestFetchedAt: string | null;
  sourceCount: number;
  categoryCounts: Record<string, number>;
}

export interface NewsResponse {
  articles: NewsArticle[];
  nextCursor: string | null;
  meta: NewsMeta;
}
