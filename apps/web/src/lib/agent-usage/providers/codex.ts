import { stat } from 'fs/promises';
import { createHmac } from 'node:crypto';
import { abortable } from 'thesidedoor-core/runtime/stream';
import { ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { AccessError } from 'thesidedoor-core/access';
import { captureLocalUsageAccount } from '../account';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';
import { getCodexSshHost } from '@/lib/agent-availability';
import { captureCodexMaterialInvocation } from '@/lib/codex-client';
import type { AgentEffortLevel } from '@/lib/agent-models/id';
import { homedir } from 'os';
import path from 'path';
import { installCurrentProviderCredentialSnapshot } from '../../agent-credentials';
import { renewCodexUsageAccount, CodexRefreshError } from '../../agent-credentials/codex-refresh';
import { logger } from '../../logger';
import type {
  AgentUsageCacheEntry,
  AgentUsageCredits,
  AgentUsageProvider,
  AgentUsageWindow,
  UsageProviderContext,
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
  accountId: string;
  home: string;
  expiresAt: number | null;
  key: string;
  authMode: string | null;
  apiKeyConfigured: boolean;
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

function parseCodexCredentials(
  value: unknown,
  authMtimeMs: number,
  home: string
): CodexCredentials | null {
  const tokens = getRecord(value, 'tokens');
  const accessToken = getString(tokens?.access_token);
  if (!accessToken) return null;

  const accountId = getString(tokens?.account_id) ?? 'unknown';
  const lastRefresh = getString(isRecord(value) ? value.last_refresh : undefined) ?? '';
  let expiresAt: number | null = null;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')
    );
    if (isRecord(claims)) expiresAt = getNumber(claims.exp);
  } catch {
    /* Opaque access tokens are checked by the provider. */
  }
  return {
    accessToken,
    accountId,
    home,
    expiresAt: expiresAt === null ? null : expiresAt * 1000,
    key: `${Math.round(authMtimeMs)}:${accountId}:${hashToken(accessToken)}:${lastRefresh}`,
    authMode: getString(isRecord(value) ? value.auth_mode : undefined),
    apiKeyConfigured:
      isRecord(value) &&
      value.OPENAI_API_KEY !== undefined &&
      value.OPENAI_API_KEY !== null &&
      value.OPENAI_API_KEY !== '',
  };
}

async function getCodexCredentials(signal?: AbortSignal): Promise<CodexCredentials | null> {
  signal?.throwIfAborted();
  installCurrentProviderCredentialSnapshot('codex');
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(homedir(), '.codex'));
  const authPath = path.join(codexHome, 'auth.json');
  const statResult = stat(authPath).catch(() => null);
  const [authJson, authStat] = await Promise.all([
    readJson(authPath, signal),
    signal ? abortable(statResult, signal) : statResult,
  ]);
  signal?.throwIfAborted();
  if (!authJson || !authStat) return null;
  return parseCodexCredentials(authJson, authStat.mtimeMs, codexHome);
}

/** Durable account identity intentionally excludes rotating OAuth credentials and cache keys. */
export async function captureCodexMaterialBinding(
  context: UsageProviderContext,
  options: { model: string; effort?: AgentEffortLevel }
) {
  const capturedContext = { ...context };
  const capturedOptions = Object.freeze({ ...options });
  if (getCodexSshHost())
    throw new Error('Material recognition cannot bind a remote Codex account.');
  const captured = await captureLocalUsageAccount(capturedContext, 'codex', getCodexCredentials);
  const credentials = captured.credentials;
  if (
    getCodexSshHost() ||
    process.env.CODEX_API_KEY ||
    !credentials ||
    credentials.authMode !== 'chatgpt' ||
    credentials.apiKeyConfigured ||
    credentials.accountId.trim().toLowerCase() === 'unknown'
  )
    throw new Error('Material recognition requires an identifiable local Codex OAuth account.');
  const selection = captureCodexMaterialInvocation(capturedOptions);
  const key = deriveOwnedCredentialKey();
  let fingerprint: string;
  try {
    fingerprint = createHmac('sha256', key)
      .update(
        JSON.stringify({
          schemaVersion: 1,
          purpose: 'material-recognition-local-codex',
          provider: 'codex',
          authority: captured.admission.identity,
          accountId: credentials.accountId,
          home: credentials.home,
          selection,
        })
      )
      .digest('hex');
  } finally {
    key.fill(0);
  }
  return Object.freeze({
    fingerprint,
    selection,
    validate: async () => {
      const current = await captureCodexMaterialBinding(capturedContext, capturedOptions);
      if (current.fingerprint !== fingerprint)
        throw new Error('The selected Codex account, model or material authority changed.');
    },
  });
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

export async function getCodexUsageProvider(
  context: UsageProviderContext
): Promise<AgentUsageProvider> {
  const captured = await captureLocalUsageAccount(context, 'codex', getCodexCredentials);
  let { credentials, admission, fingerprint } = captured;
  const { signal } = captured;
  let cacheKey = fingerprint();
  const now = Date.now();
  if (codexCache && codexCache.key === cacheKey && codexCache.expiresAt > now) {
    return structuredClone(codexCache.value);
  }
  const publish = async (provider: AgentUsageProvider) => {
    await admission.validate(signal);
    codexCache = {
      key: cacheKey,
      expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
      value: structuredClone(provider),
    };
    return provider;
  };

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
    return publish(provider);
  }

  try {
    let renewed = false;
    const renew = async () => {
      if (!credentials || renewed || credentials.accountId === 'unknown')
        throw new CodexRefreshError('action_required');
      renewed = true;
      await admission.validate(signal);
      const expected = credentials;
      await renewCodexUsageAccount(
        expected,
        getCodexCredentials,
        (renewalSignal) => admission.validate(renewalSignal),
        signal
      );
      await admission.validate(signal);
      const captured = await captureLocalUsageAccount(context, 'codex', getCodexCredentials);
      if (
        !captured.credentials ||
        captured.credentials.accountId !== expected.accountId ||
        captured.credentials.home !== expected.home
      )
        throw new CodexRefreshError('unavailable');
      credentials = captured.credentials;
      admission = captured.admission;
      fingerprint = captured.fingerprint;
      cacheKey = fingerprint();
    };
    if (credentials.expiresAt !== null && credentials.expiresAt <= Date.now()) await renew();
    const transport = admission.createTransport([
      { method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage' },
    ]);
    const fetchUsage = () =>
      fetchJsonWithTimeout(
        'https://chatgpt.com/backend-api/wham/usage',
        {
          signal,
          headers: { Authorization: `Bearer ${credentials!.accessToken}` },
        },
        CODEX_TIMEOUT_MS,
        transport.authenticatedFetch
      );
    let { response, payload } = await fetchUsage();
    const authError = parseCodexUsagePayload(payload).errorCode;
    if (
      !renewed &&
      (response.status === 401 ||
        authError === 'token_expired' ||
        authError === 'token_invalidated')
    ) {
      await renew();
      ({ response, payload } = await fetchUsage());
    }

    if (!response.ok) {
      const provider = buildProvider({
        id: 'codex',
        category: 'agent',
        label: 'Codex',
        shortLabel: 'Codex',
        planLabel: null,
        status: response.status === 401 ? 'action_required' : 'unavailable',
        detail:
          response.status === 401
            ? 'Codex sign-in could not be renewed. Reconnect Codex on this server.'
            : 'Codex usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      return await publish(provider);
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
          ? 'Codex sign-in could not be renewed. Reconnect Codex on this server.'
          : 'Codex usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      return await publish(provider);
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
    return await publish(provider);
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    if (error instanceof ProcessExecutionError && error.code === 'cleanup_failed') throw error;
    signal.throwIfAborted();
    if (error instanceof AccessError) throw error;
    if (error instanceof CodexRefreshError && error.reason === 'action_required') {
      return publish(
        buildProvider({
          id: 'codex',
          category: 'agent',
          label: 'Codex',
          shortLabel: 'Codex',
          planLabel: null,
          status: 'action_required',
          detail: 'Codex sign-in could not be renewed. Reconnect Codex on this server.',
          windows: [],
          credits: null,
          limitReached: false,
        })
      );
    }
    logger.warn('Failed to fetch Codex usage status');
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
    return publish(provider);
  }
}

export function resetCodexUsageCacheForTests(): void {
  codexCache = null;
}
