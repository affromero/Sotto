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
