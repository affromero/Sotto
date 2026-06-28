import type {
  AgentUsageProvider,
  AgentUsageStatus,
  UsageProviderAdapter,
  UsageProviderContext,
} from './types';
import {
  getClaudeUsageProvider,
  parseClaudeUsageHeaders,
  resetClaudeUsageCacheForTests,
} from './providers/claude-code';
import {
  getCodexUsageProvider,
  parseCodexUsagePayload,
  resetCodexUsageCacheForTests,
} from './providers/codex';
import {
  getElevenLabsUsageProvider,
  parseElevenLabsSubscriptionPayload,
  resetElevenLabsUsageCacheForTests,
} from './providers/elevenlabs';
import {
  getCartesiaUsageProvider,
  parseCartesiaCreditUsagePayload,
  resetCartesiaUsageCacheForTests,
  resolveCartesiaBillingWindow,
  resolveCartesiaUsageAllowance,
} from './providers/cartesia';
import { ERROR_CACHE_TTL_MS, formatUsageDuration, nowIso } from './utils';

const PROVIDER_ADAPTERS: UsageProviderAdapter[] = [
  getClaudeUsageProvider,
  getCodexUsageProvider,
  getElevenLabsUsageProvider,
  getCartesiaUsageProvider,
];

export type {
  AgentUsageCredits,
  AgentUsageProvider,
  AgentUsageProviderCategory,
  AgentUsageProviderId,
  AgentUsageProviderStatus,
  AgentUsageStatus,
  AgentUsageWindow,
  UsageProviderContext,
} from './types';

export {
  formatUsageDuration,
  parseCartesiaCreditUsagePayload,
  parseClaudeUsageHeaders,
  parseCodexUsagePayload,
  parseElevenLabsSubscriptionPayload,
  resolveCartesiaBillingWindow,
  resolveCartesiaUsageAllowance,
};

export async function getAgentUsageStatus(userId: string): Promise<AgentUsageStatus> {
  const context: UsageProviderContext = { userId };
  const providers = (
    await Promise.all(PROVIDER_ADAPTERS.map((adapter) => adapter(context)))
  ).filter((provider): provider is AgentUsageProvider => provider !== null);

  return {
    providers,
    refreshedAt: nowIso(),
    cacheTtlSeconds: Math.floor(ERROR_CACHE_TTL_MS / 1000),
  };
}

export function resetAgentUsageCacheForTests(): void {
  resetClaudeUsageCacheForTests();
  resetCodexUsageCacheForTests();
  resetElevenLabsUsageCacheForTests();
  resetCartesiaUsageCacheForTests();
}
