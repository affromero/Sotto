import type {
  AgentUsageProvider,
  AgentUsageStatus,
  UsageProviderAdapter,
  UsageProviderContext,
} from './types';
import { getClaudeUsageProvider, parseClaudeUsageHeaders } from './providers/claude-code';
import { getCodexUsageProvider, parseCodexUsagePayload } from './providers/codex';
import {
  getElevenLabsUsageProvider,
  parseElevenLabsSubscriptionPayload,
} from './providers/elevenlabs';
import {
  getCartesiaUsageProvider,
  parseCartesiaCreditUsagePayload,
  resolveCartesiaBillingWindow,
} from './providers/cartesia';
import { ERROR_CACHE_TTL_MS, formatUsageDuration, nowIso } from './utils';
import { captureSottoProviderAdmission } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { getAutoModelConfig, resolveDisabledSystemAiProviders } from '@/lib/auto-model-config';

const PROVIDER_ADAPTERS: { id: string; adapter: UsageProviderAdapter }[] = [
  { id: 'claude-code', adapter: getClaudeUsageProvider },
  { id: 'codex', adapter: getCodexUsageProvider },
  { id: 'elevenlabs', adapter: getElevenLabsUsageProvider },
  { id: 'cartesia', adapter: getCartesiaUsageProvider },
];
export type { AgentUsageProvider, AgentUsageStatus, UsageProviderContext } from './types';
export {
  formatUsageDuration,
  parseCartesiaCreditUsagePayload,
  parseClaudeUsageHeaders,
  parseCodexUsagePayload,
  parseElevenLabsSubscriptionPayload,
  resolveCartesiaBillingWindow,
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
  await admit.validate(signal);
  const disabledProviders = resolveDisabledSystemAiProviders(await getAutoModelConfig());
  const results = await Promise.allSettled(
    PROVIDER_ADAPTERS.filter(
      ({ id }) => (id !== 'claude-code' && id !== 'codex') || !disabledProviders.has(id)
    ).map(async ({ adapter }) => {
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
