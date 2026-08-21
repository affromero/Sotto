import { getSharedByokKey } from '../../byok';
import { logger } from '../../logger';
import type {
  AgentUsageCacheEntry,
  AgentUsageCredits,
  AgentUsageProvider,
  AgentUsageWindow,
  UsageProviderContext,
} from '../types';
import {
  AUDIO_PROVIDER_CACHE_TTL_MS,
  buildProvider,
  capitalizePlan,
  ERROR_CACHE_TTL_MS,
  fetchJsonWithTimeout,
  formatCreditLabel,
  formatResetAt,
  friendlyReset,
  getBoolean,
  getEnvString,
  getNumber,
  getRecord,
  getString,
  hashToken,
  isRecord,
  percentFromUsage,
  usageWindow,
} from '../utils';

const ELEVENLABS_TIMEOUT_MS = 7_000;

let elevenLabsCache: AgentUsageCacheEntry | null = null;

async function getElevenLabsUsageKey(userId: string): Promise<string | null> {
  const byokKey = await getSharedByokKey(userId, 'elevenlabs');
  return byokKey?.apiKey ?? getEnvString('ELEVENLABS_API_KEY');
}

function billingPeriodLabel(period: string | null): string {
  switch (period) {
    case 'monthly_period':
      return 'Mo';
    case '3_month_period':
      return '3mo';
    case '6_month_period':
      return '6mo';
    case 'annual_period':
      return 'Yr';
    default:
      return 'Cycle';
  }
}

export function parseElevenLabsSubscriptionPayload(payload: unknown): {
  windows: AgentUsageWindow[];
  credits: AgentUsageCredits | null;
  planLabel: string | null;
  limitReached: boolean;
  errorCode: string | null;
  detail: string | null;
} {
  if (!isRecord(payload)) {
    return {
      windows: [],
      credits: null,
      planLabel: null,
      limitReached: false,
      errorCode: 'invalid_payload',
      detail: null,
    };
  }

  const errorValue = payload.error ?? payload.detail;
  if (errorValue !== undefined) {
    return {
      windows: [],
      credits: null,
      planLabel: null,
      limitReached: false,
      errorCode:
        getString(getRecord(errorValue, 'error')?.code) ??
        getString(isRecord(errorValue) ? errorValue.code : undefined) ??
        getString(errorValue) ??
        'api_error',
      detail: null,
    };
  }

  const characterCount = getNumber(payload.character_count);
  const characterLimit = getNumber(payload.character_limit);
  const resetAt = getNumber(payload.next_character_count_reset_unix);
  const remaining =
    characterCount !== null && characterLimit !== null
      ? Math.max(0, characterLimit - characterCount)
      : null;
  const usedPercent = percentFromUsage(characterCount, characterLimit);
  const canExtend = getBoolean(payload.can_extend_character_limit);
  const status = getString(payload.status);

  return {
    windows: [
      usageWindow({
        label: billingPeriodLabel(
          getString(payload.character_refresh_period) ?? getString(payload.billing_period)
        ),
        usedPercent,
        resetIn: friendlyReset(resetAt),
        resetAt: formatResetAt(resetAt),
        limitWindowSeconds: null,
        valueLabel: `${usedPercent}%`,
      }),
    ],
    credits:
      remaining !== null
        ? {
            balance: null,
            unlimited: false,
            label: formatCreditLabel(remaining),
          }
        : null,
    planLabel: capitalizePlan(getString(payload.tier)),
    limitReached:
      characterLimit !== null &&
      characterLimit > 0 &&
      characterCount !== null &&
      characterCount >= characterLimit &&
      !canExtend,
    errorCode: null,
    detail:
      status && status !== 'active'
        ? `ElevenLabs subscription status is ${status}.`
        : 'ElevenLabs subscription credits are current.',
  };
}

export async function getElevenLabsUsageProvider(
  context: UsageProviderContext
): Promise<AgentUsageProvider | null> {
  const apiKey = await getElevenLabsUsageKey(context.userId);
  if (!apiKey) return null;

  const cacheKey = hashToken(apiKey);
  const now = Date.now();
  if (elevenLabsCache && elevenLabsCache.key === cacheKey && elevenLabsCache.expiresAt > now) {
    return elevenLabsCache.value;
  }

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      'https://api.elevenlabs.io/v1/user/subscription',
      {
        headers: {
          'xi-api-key': apiKey,
          'User-Agent': 'sotto-provider-usage/0.1',
        },
      },
      ELEVENLABS_TIMEOUT_MS
    );

    if (!response.ok) {
      const provider = buildProvider({
        id: 'elevenlabs',
        category: 'audio',
        label: 'ElevenLabs',
        shortLabel: 'ElevenLabs',
        planLabel: null,
        status:
          response.status === 401 || response.status === 403 ? 'action_required' : 'unavailable',
        detail:
          response.status === 401 || response.status === 403
            ? 'ElevenLabs API key needs to be refreshed.'
            : 'ElevenLabs subscription usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      elevenLabsCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const parsed = parseElevenLabsSubscriptionPayload(payload);
    if (parsed.errorCode) {
      const provider = buildProvider({
        id: 'elevenlabs',
        category: 'audio',
        label: 'ElevenLabs',
        shortLabel: 'ElevenLabs',
        planLabel: null,
        status: 'unavailable',
        detail: 'ElevenLabs subscription usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      elevenLabsCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const provider = buildProvider({
      id: 'elevenlabs',
      category: 'audio',
      label: 'ElevenLabs',
      shortLabel: 'ElevenLabs',
      planLabel: parsed.planLabel,
      status: 'ready',
      detail: parsed.detail ?? 'ElevenLabs subscription credits are current.',
      windows: parsed.windows,
      credits: parsed.credits,
      limitReached: parsed.limitReached,
    });
    elevenLabsCache = {
      key: cacheKey,
      expiresAt: now + AUDIO_PROVIDER_CACHE_TTL_MS,
      value: provider,
    };
    return provider;
  } catch (error) {
    logger.warn('Failed to fetch ElevenLabs subscription usage status', {
      error: error instanceof Error ? error.message : String(error),
    });
    const provider = buildProvider({
      id: 'elevenlabs',
      category: 'audio',
      label: 'ElevenLabs',
      shortLabel: 'ElevenLabs',
      planLabel: null,
      status: 'unavailable',
      detail: 'ElevenLabs subscription usage is unreachable right now.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    elevenLabsCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
    return provider;
  }
}

export function resetElevenLabsUsageCacheForTests(): void {
  elevenLabsCache = null;
}
