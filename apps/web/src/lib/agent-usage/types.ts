export type AgentUsageProviderId = string;
export type AgentUsageProviderCategory = 'agent' | 'audio';
export type AgentUsageProviderStatus = 'ready' | 'action_required' | 'unavailable';

export interface AgentUsageWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetIn: string | null;
  resetAt: string | null;
  limitWindowSeconds: number | null;
  valueLabel?: string | null;
  unbounded?: boolean;
}

export interface AgentUsageCredits {
  balance: string | null;
  unlimited: boolean;
  label?: string | null;
}

export interface AgentUsageProvider {
  id: AgentUsageProviderId;
  category: AgentUsageProviderCategory;
  label: string;
  shortLabel: string;
  planLabel: string | null;
  status: AgentUsageProviderStatus;
  detail: string;
  windows: AgentUsageWindow[];
  credits: AgentUsageCredits | null;
  limitReached: boolean;
  refreshedAt: string;
}

export interface AgentUsageStatus {
  providers: AgentUsageProvider[];
  refreshedAt: string;
  cacheTtlSeconds: number;
}

export interface AgentUsageCacheEntry {
  key: string;
  expiresAt: number;
  value: AgentUsageProvider;
}

export interface UsageProviderContext {
  userId: string;
}

export type UsageProviderAdapter = (
  context: UsageProviderContext
) => Promise<AgentUsageProvider | null>;
