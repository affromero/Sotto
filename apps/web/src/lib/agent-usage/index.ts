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
import { captureSottoProviderAdmission } from '@/lib/sidedoor/credentials/runtime/provider-execution';

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

export async function getAgentUsageStatus(
  execution: UsageProviderContext
): Promise<AgentUsageStatus> {
  const siblings = new AbortController();
  const signal = execution.signal
    ? AbortSignal.any([execution.signal, siblings.signal])
    : siblings.signal;
  const context: UsageProviderContext = { ...execution, signal };
  const admit = await captureSottoProviderAdmission(context);
  const results = await Promise.allSettled(
    PROVIDER_ADAPTERS.map(async (adapter) => {
      try {
        await admit.validate(signal);
        const provider = await adapter(context);
        await admit.validate(signal);
        return provider;
      } catch (error) {
        if (!siblings.signal.aborted) siblings.abort(error);
        throw error;
      }
    })
  );
  signal.throwIfAborted();
  const providers: AgentUsageProvider[] = [];
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    if (result.value) providers.push(result.value);
  }
  await admit.validate(signal);

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
