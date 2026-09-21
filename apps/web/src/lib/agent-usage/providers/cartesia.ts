import { AccessError } from 'thesidedoor-core/access';
import { captureUsageAccount } from '../account';
import { logger } from '../../logger';
import { CARTESIA_USAGE_ALLOWANCE } from '../../provider-usage/allowances';
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
  ERROR_CACHE_TTL_MS,
  fetchJsonWithTimeout,
  formatCreditLabel,
  formatWholeNumber,
  getNumber,
  isRecord,
  percentFromUsage,
  resetInFromDate,
  usageWindow,
} from '../utils';

const CARTESIA_TIMEOUT_MS = 7_000;
const CARTESIA_USAGE_API_VERSION = '2026-03-01';

let cartesiaCache: AgentUsageCacheEntry | null = null;

function optionalPositiveInteger(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveCartesiaUsageAllowance(extraData: Record<string, string> | null): {
  monthlyLimit: number | null;
  planId: string | null;
  planLabel: string | null;
} {
  const planId = extraData?.usagePlan?.trim().toLowerCase() || null;
  const preset = CARTESIA_USAGE_ALLOWANCE.presets.find((item) => item.id === planId) ?? null;
  const explicitLimit = optionalPositiveInteger(extraData?.monthlyCreditLimit);
  const monthlyLimit = explicitLimit ?? preset?.monthlyLimit ?? null;

  return {
    monthlyLimit,
    planId,
    planLabel: preset?.label ?? (monthlyLimit !== null ? 'Custom' : null),
  };
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function utcDateForMonthlyReset(year: number, monthIndex: number, resetDay: number): Date {
  const clampedDay = Math.min(resetDay, daysInUtcMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, clampedDay, 0, 0, 0, 0));
}

function addUtcMonths(
  year: number,
  monthIndex: number,
  months: number
): { year: number; monthIndex: number } {
  const targetMonth = monthIndex + months;
  const target = new Date(Date.UTC(year, targetMonth, 1, 0, 0, 0, 0));
  return { year: target.getUTCFullYear(), monthIndex: target.getUTCMonth() };
}

export function resolveCartesiaBillingWindow(
  now: Date = new Date(),
  resetDay = 1
): { start: Date; end: Date; configuredResetDay: number | null } {
  const safeResetDay = Math.min(31, Math.max(1, Math.floor(resetDay)));
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentReset = utcDateForMonthlyReset(currentYear, currentMonth, safeResetDay);

  if (now.getTime() >= currentReset.getTime()) {
    const next = addUtcMonths(currentYear, currentMonth, 1);
    return {
      start: currentReset,
      end: utcDateForMonthlyReset(next.year, next.monthIndex, safeResetDay),
      configuredResetDay: safeResetDay,
    };
  }

  const previous = addUtcMonths(currentYear, currentMonth, -1);
  return {
    start: utcDateForMonthlyReset(previous.year, previous.monthIndex, safeResetDay),
    end: currentReset,
    configuredResetDay: safeResetDay,
  };
}

function sumCartesiaCredits(payload: unknown): number | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  return payload.data.reduce((sum, item) => {
    if (!isRecord(item)) return sum;
    return sum + (getNumber(item.credits) ?? 0);
  }, 0);
}

export function parseCartesiaCreditUsagePayload(
  payload: unknown,
  input: {
    monthlyLimit: number | null;
    windowStart: Date;
    windowEnd: Date;
    now?: Date;
  }
): {
  windows: AgentUsageWindow[];
  credits: AgentUsageCredits | null;
  limitReached: boolean;
  errorCode: string | null;
  detail: string | null;
} {
  const now = input.now ?? new Date();
  const usedCredits = sumCartesiaCredits(payload);
  if (usedCredits === null) {
    return {
      windows: [],
      credits: null,
      limitReached: false,
      errorCode: 'invalid_payload',
      detail: null,
    };
  }

  const monthlyLimit = input.monthlyLimit;
  const hasLimit = monthlyLimit !== null && monthlyLimit > 0;
  const usedPercent = hasLimit ? percentFromUsage(usedCredits, monthlyLimit) : 0;
  const remaining = hasLimit ? Math.max(0, monthlyLimit - usedCredits) : null;

  return {
    windows: [
      usageWindow({
        label: 'Mo',
        usedPercent,
        resetIn: resetInFromDate(input.windowEnd, now),
        resetAt: input.windowEnd.toISOString(),
        limitWindowSeconds: null,
        valueLabel: hasLimit ? `${usedPercent}%` : `${formatWholeNumber(usedCredits)} used`,
        unbounded: !hasLimit,
      }),
    ],
    credits:
      remaining !== null
        ? {
            balance: null,
            unlimited: false,
            label: formatCreditLabel(remaining),
          }
        : {
            balance: null,
            unlimited: false,
            label: `${formatWholeNumber(usedCredits)} credits used`,
          },
    limitReached: hasLimit && usedCredits >= monthlyLimit,
    errorCode: null,
    detail: hasLimit
      ? 'Cartesia credit usage is current.'
      : 'Cartesia credit usage is current; add a monthly credit limit in provider settings to show remaining credits.',
  };
}

export async function getCartesiaUsageProvider(
  context: UsageProviderContext
): Promise<AgentUsageProvider | null> {
  const account = await captureUsageAccount(context, 'cartesia');
  const { admission, signal, fields: credentials } = account;
  if (!credentials) return null;

  const adminKey = credentials.extraData?.adminApiKey?.trim() || null;
  const allowance = resolveCartesiaUsageAllowance(credentials.extraData);
  const monthlyLimit = allowance.monthlyLimit;
  const resetDay = optionalPositiveInteger(credentials.extraData?.billingResetDay) ?? 1;

  const nowDate = new Date();
  const billingWindow = resolveCartesiaBillingWindow(nowDate, resetDay);
  const cacheKey = account.fingerprint([
    billingWindow.start.toISOString(),
    billingWindow.end.toISOString(),
  ]);
  const now = Date.now();
  if (cartesiaCache && cartesiaCache.key === cacheKey && cartesiaCache.expiresAt > now) {
    return structuredClone(cartesiaCache.value);
  }

  const publish = async (provider: AgentUsageProvider, ttl: number) => {
    await admission.validate(signal);
    cartesiaCache = {
      key: cacheKey,
      expiresAt: Date.now() + ttl,
      value: structuredClone(provider),
    };
    return provider;
  };

  if (!adminKey) {
    const provider = buildProvider({
      id: 'cartesia',
      category: 'audio',
      label: 'Cartesia',
      shortLabel: 'Cartesia',
      planLabel: allowance.planLabel,
      status: 'action_required',
      detail: 'Add a Cartesia admin API key in provider settings to show credit usage.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    return publish(provider, ERROR_CACHE_TTL_MS);
  }

  const params = new URLSearchParams({
    start_ts: billingWindow.start.toISOString(),
    end_ts: nowDate.toISOString(),
  });

  try {
    const url = `https://api.cartesia.ai/usage/credits?${params.toString()}`;
    const transport = admission.createTransport([{ method: 'GET', url }]);
    const { response, payload } = await fetchJsonWithTimeout(
      url,
      {
        signal,
        headers: {
          Authorization: `Bearer ${adminKey}`,
          'Cartesia-Version': CARTESIA_USAGE_API_VERSION,
          'User-Agent': 'sotto-provider-usage/0.1',
        },
      },
      CARTESIA_TIMEOUT_MS,
      transport.authenticatedFetch
    );

    if (!response.ok) {
      const provider = buildProvider({
        id: 'cartesia',
        category: 'audio',
        label: 'Cartesia',
        shortLabel: 'Cartesia',
        planLabel: allowance.planLabel,
        status:
          response.status === 401 || response.status === 403 ? 'action_required' : 'unavailable',
        detail:
          response.status === 401 || response.status === 403
            ? 'Cartesia admin API key needs to be refreshed.'
            : 'Cartesia credit usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      return await publish(provider, ERROR_CACHE_TTL_MS);
    }

    const parsed = parseCartesiaCreditUsagePayload(payload, {
      monthlyLimit,
      windowStart: billingWindow.start,
      windowEnd: billingWindow.end,
      now: nowDate,
    });

    if (parsed.errorCode) {
      const provider = buildProvider({
        id: 'cartesia',
        category: 'audio',
        label: 'Cartesia',
        shortLabel: 'Cartesia',
        planLabel: allowance.planLabel,
        status: 'unavailable',
        detail: 'Cartesia credit usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      return await publish(provider, ERROR_CACHE_TTL_MS);
    }

    const provider = buildProvider({
      id: 'cartesia',
      category: 'audio',
      label: 'Cartesia',
      shortLabel: 'Cartesia',
      planLabel: allowance.planLabel,
      status: 'ready',
      detail: parsed.detail ?? 'Cartesia credit usage is current.',
      windows: parsed.windows,
      credits: parsed.credits,
      limitReached: parsed.limitReached,
    });
    return await publish(provider, AUDIO_PROVIDER_CACHE_TTL_MS);
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    signal.throwIfAborted();
    if (error instanceof AccessError) throw error;
    logger.warn('Failed to fetch Cartesia credit usage status');
    const provider = buildProvider({
      id: 'cartesia',
      category: 'audio',
      label: 'Cartesia',
      shortLabel: 'Cartesia',
      planLabel: allowance.planLabel,
      status: 'unavailable',
      detail: 'Cartesia credit usage is unreachable right now.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    return publish(provider, ERROR_CACHE_TTL_MS);
  }
}

export function resetCartesiaUsageCacheForTests(): void {
  cartesiaCache = null;
}
