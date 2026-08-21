import { stat } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { logger } from '../../logger';
import type {
  AgentUsageCacheEntry,
  AgentUsageCredits,
  AgentUsageProvider,
  AgentUsageWindow,
} from '../types';
import {
  buildProvider,
  capitalizePlan,
  ERROR_CACHE_TTL_MS,
  fetchJsonWithTimeout,
  formatResetAt,
  formatUsageDuration,
  friendlyReset,
  getBoolean,
  getNumber,
  getRecord,
  getString,
  hashToken,
  isRecord,
  readJson,
  resetInFromTimestamp,
  usageWindow,
  windowLabel,
} from '../utils';

interface CodexCredentials {
  accessToken: string;
  key: string;
}

const CODEX_TIMEOUT_MS = 5_000;

let codexCache: AgentUsageCacheEntry | null = null;

function codexWindowResetIn(
  window: Record<string, unknown> | null,
  now: Date,
  style: 'duration' | 'friendly'
): string | null {
  const resetAfter = getNumber(window?.reset_after_seconds);
  if (resetAfter !== null) return formatUsageDuration(resetAfter);
  const resetAt = getNumber(window?.reset_at);
  return style === 'friendly' ? friendlyReset(resetAt) : resetInFromTimestamp(resetAt, now);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = getString(value);
    if (stringValue) return stringValue;
  }
  return null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function isSparkLimit(entry: Record<string, unknown>): boolean {
  return [getString(entry.limit_name), getString(entry.metered_feature)]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase().includes('spark'));
}

function compactLimitName(entry: Record<string, unknown>): string {
  const source = firstNonEmptyString(entry.limit_name, entry.metered_feature);
  if (!source) return 'Extra';
  const normalized = source.replace(/_/g, '-').toLowerCase();
  if (normalized.includes('spark')) return 'Spark';

  const suffix = normalized.match(/(?:^|[-\s])(mini|nano|pro|max)(?:$|[-\s])/)?.[1];
  if (suffix) return suffix.charAt(0).toUpperCase() + suffix.slice(1);
  if (normalized.includes('codex')) return 'Codex';
  return 'Extra';
}

function codexAdditionalWindow(
  label: string,
  snapshot: Record<string, unknown>,
  now: Date
): AgentUsageWindow {
  const windowSeconds = getNumber(snapshot.limit_window_seconds);
  return usageWindow({
    label,
    usedPercent: getNumber(snapshot.used_percent) ?? 0,
    resetIn: codexWindowResetIn(snapshot, now, 'duration'),
    resetAt: formatResetAt(getNumber(snapshot.reset_at)),
    limitWindowSeconds: windowSeconds,
  });
}

function codexAdditionalWindowKey(
  entry: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  fallback: string
): string | null {
  if (isSparkLimit(entry)) {
    const seconds = getNumber(snapshot.limit_window_seconds);
    return seconds && seconds >= 6 * 24 * 60 * 60 ? 'codex-spark-weekly' : 'codex-spark';
  }
  const source = firstNonEmptyString(entry.metered_feature, entry.limit_name);
  return source ? `codex-${slug(source)}` : fallback;
}

function codexAdditionalWindowLabel(
  entry: Record<string, unknown>,
  snapshot: Record<string, unknown>
): string {
  const compact = compactLimitName(entry);
  return `${compact} ${windowLabel(getNumber(snapshot.limit_window_seconds), 'Limit')}`;
}

function parseCodexAdditionalWindows(
  payload: Record<string, unknown>,
  now: Date
): AgentUsageWindow[] {
  const additionalLimits = Array.isArray(payload.additional_rate_limits)
    ? payload.additional_rate_limits
    : [];
  if (additionalLimits.length === 0) return [];

  const windows: AgentUsageWindow[] = [];
  const seen = new Set<string>();
  for (const [index, rawEntry] of additionalLimits.entries()) {
    if (!isRecord(rawEntry)) continue;
    const rateLimit = getRecord(rawEntry, 'rate_limit');
    if (!rateLimit) continue;

    const candidates = isSparkLimit(rawEntry)
      ? [getRecord(rateLimit, 'primary_window'), getRecord(rateLimit, 'secondary_window')]
      : [getRecord(rateLimit, 'primary_window') ?? getRecord(rateLimit, 'secondary_window')];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const key = codexAdditionalWindowKey(rawEntry, candidate, `codex-extra-${index}`);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      windows.push(
        codexAdditionalWindow(codexAdditionalWindowLabel(rawEntry, candidate), candidate, now)
      );
    }
  }
  return windows;
}

function parseCodexCredentials(value: unknown, authMtimeMs: number): CodexCredentials | null {
  const tokens = getRecord(value, 'tokens');
  const accessToken = getString(tokens?.access_token);
  if (!accessToken) return null;

  const accountId = getString(tokens?.account_id) ?? 'unknown';
  const lastRefresh = getString(isRecord(value) ? value.last_refresh : undefined) ?? '';
  return {
    accessToken,
    key: `${Math.round(authMtimeMs)}:${accountId}:${hashToken(accessToken)}:${lastRefresh}`,
  };
}

async function getCodexCredentials(): Promise<CodexCredentials | null> {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  const authPath = path.join(codexHome, 'auth.json');
  const [authJson, authStat] = await Promise.all([
    readJson(authPath),
    stat(authPath).catch(() => null),
  ]);
  if (!authJson || !authStat) return null;
  return parseCodexCredentials(authJson, authStat.mtimeMs);
}

export function parseCodexUsagePayload(
  payload: unknown,
  now: Date = new Date()
): {
  windows: AgentUsageWindow[];
  credits: AgentUsageCredits | null;
  planLabel: string | null;
  limitReached: boolean;
  errorCode: string | null;
} {
  if (!isRecord(payload)) {
    return {
      windows: [],
      credits: null,
      planLabel: null,
      limitReached: false,
      errorCode: 'invalid_payload',
    };
  }

  const errorValue = payload.error ?? payload.detail;
  if (errorValue !== undefined) {
    const errorCode =
      getString(getRecord(errorValue, 'error')?.code) ??
      getString(isRecord(errorValue) ? errorValue.code : undefined) ??
      getString(errorValue) ??
      'api_error';
    return {
      windows: [],
      credits: null,
      planLabel: null,
      limitReached: false,
      errorCode,
    };
  }

  const rateLimit = getRecord(payload, 'rate_limit');
  const primaryWindow = getRecord(rateLimit, 'primary_window');
  const secondaryWindow = getRecord(rateLimit, 'secondary_window');
  const creditsRecord = getRecord(payload, 'credits');
  const primaryWindowSeconds = getNumber(primaryWindow?.limit_window_seconds);
  const secondaryWindowSeconds = getNumber(secondaryWindow?.limit_window_seconds);
  const secondaryResetAt = getNumber(secondaryWindow?.reset_at);
  const balance = creditsRecord
    ? (getString(creditsRecord.balance) ?? getNumber(creditsRecord.balance)?.toString() ?? null)
    : null;
  const unlimited = getBoolean(creditsRecord?.unlimited);

  return {
    windows: [
      usageWindow({
        label: windowLabel(primaryWindowSeconds, 'Pri'),
        usedPercent: getNumber(primaryWindow?.used_percent) ?? 0,
        resetIn: codexWindowResetIn(primaryWindow, now, 'duration'),
        resetAt: formatResetAt(getNumber(primaryWindow?.reset_at)),
        limitWindowSeconds: primaryWindowSeconds,
      }),
      ...(secondaryWindow
        ? [
            usageWindow({
              label: windowLabel(secondaryWindowSeconds, 'Sec'),
              usedPercent: getNumber(secondaryWindow.used_percent) ?? 0,
              resetIn: codexWindowResetIn(secondaryWindow, now, 'friendly'),
              resetAt: formatResetAt(secondaryResetAt),
              limitWindowSeconds: secondaryWindowSeconds,
            }),
          ]
        : []),
      ...parseCodexAdditionalWindows(payload, now),
    ],
    credits: balance || unlimited ? { balance, unlimited } : null,
    planLabel: capitalizePlan(getString(payload.plan_type)),
    limitReached: getBoolean(rateLimit?.limit_reached),
    errorCode: null,
  };
}

export async function getCodexUsageProvider(): Promise<AgentUsageProvider> {
  const credentials = await getCodexCredentials();
  const cacheKey = credentials?.key ?? 'no-auth';
  const now = Date.now();
  if (codexCache && codexCache.key === cacheKey && codexCache.expiresAt > now) {
    return codexCache.value;
  }

  if (!credentials) {
    const provider = buildProvider({
      id: 'codex',
      category: 'agent',
      label: 'Codex',
      shortLabel: 'Codex',
      planLabel: null,
      status: 'action_required',
      detail: 'Codex is not authenticated on this server.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    codexCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
    return provider;
  }

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      'https://chatgpt.com/backend-api/wham/usage',
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      },
      CODEX_TIMEOUT_MS
    );

    if (!response.ok) {
      const provider = buildProvider({
        id: 'codex',
        category: 'agent',
        label: 'Codex',
        shortLabel: 'Codex',
        planLabel: null,
        status:
          response.status === 401 || response.status === 403 ? 'action_required' : 'unavailable',
        detail:
          response.status === 401 || response.status === 403
            ? 'Codex auth needs to be refreshed on this server.'
            : 'Codex usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      codexCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const parsed = parseCodexUsagePayload(payload);
    if (parsed.errorCode) {
      const needsAuth =
        parsed.errorCode === 'token_invalidated' || parsed.errorCode === 'token_expired';
      const provider = buildProvider({
        id: 'codex',
        category: 'agent',
        label: 'Codex',
        shortLabel: 'Codex',
        planLabel: null,
        status: needsAuth ? 'action_required' : 'unavailable',
        detail: needsAuth
          ? 'Codex auth needs to be refreshed on this server.'
          : 'Codex usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      codexCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const provider = buildProvider({
      id: 'codex',
      category: 'agent',
      label: 'Codex',
      shortLabel: 'Codex',
      planLabel: parsed.planLabel,
      status: 'ready',
      detail: 'Codex usage windows are current.',
      windows: parsed.windows,
      credits: parsed.credits,
      limitReached: parsed.limitReached,
    });
    codexCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
    return provider;
  } catch (error) {
    logger.warn('Failed to fetch Codex usage status', {
      error: error instanceof Error ? error.message : String(error),
    });
    const provider = buildProvider({
      id: 'codex',
      category: 'agent',
      label: 'Codex',
      shortLabel: 'Codex',
      planLabel: null,
      status: 'unavailable',
      detail: 'Codex usage is unreachable right now.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    codexCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
    return provider;
  }
}

export function resetCodexUsageCacheForTests(): void {
  codexCache = null;
}
