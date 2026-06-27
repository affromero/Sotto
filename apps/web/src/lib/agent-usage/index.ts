import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { logger } from '../logger';
import { getCheapestModelForProvider } from '../providers/ai-registry';

export type AgentUsageProviderId = 'claude-code' | 'codex';
export type AgentUsageProviderStatus = 'ready' | 'action_required' | 'unavailable';

export interface AgentUsageWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetIn: string | null;
  resetAt: string | null;
  limitWindowSeconds: number | null;
}

export interface AgentUsageCredits {
  balance: string | null;
  unlimited: boolean;
}

export interface AgentUsageProvider {
  id: AgentUsageProviderId;
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

interface CacheEntry {
  key: string;
  expiresAt: number;
  value: AgentUsageProvider;
}

interface ClaudeCredentials {
  accessToken: string;
  subscriptionType: string | null;
}

interface CodexCredentials {
  accessToken: string;
  key: string;
}

const CLAUDE_CACHE_TTL_MS = 5 * 60 * 1000;
const CODEX_CACHE_TTL_MS = 60 * 1000;
const CLAUDE_TIMEOUT_MS = 10_000;
const CODEX_TIMEOUT_MS = 5_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let claudeCache: CacheEntry | null = null;
let codexCache: CacheEntry | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function buildProvider(input: Omit<AgentUsageProvider, 'refreshedAt'>): AgentUsageProvider {
  return {
    ...input,
    refreshedAt: nowIso(),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentFromFraction(value: number | null): number {
  if (value === null) return 0;
  return clampPercent(value * 100);
}

export function formatUsageDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);

  if (days > 0) return `${days}d${String(hours).padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

function formatResetAt(timestampSeconds: number | null): string | null {
  if (!timestampSeconds || timestampSeconds <= 0) return null;
  return new Date(timestampSeconds * 1000).toISOString();
}

function resetInFromTimestamp(timestampSeconds: number | null, now: Date): string | null {
  if (!timestampSeconds || timestampSeconds <= 0) return null;
  return formatUsageDuration(timestampSeconds - now.getTime() / 1000);
}

function friendlyReset(timestampSeconds: number | null, now: Date): string | null {
  if (!timestampSeconds || timestampSeconds <= 0) return null;
  const reset = new Date(timestampSeconds * 1000);
  const duration = resetInFromTimestamp(timestampSeconds, now);
  return `${MONTHS[reset.getMonth()]} ${reset.getDate()} (${duration})`;
}

function windowLabel(seconds: number | null, fallback: string): string {
  if (seconds === 18_000) return '5h';
  if (seconds === 604_800) return 'Wk';
  if (seconds === 86_400) return '24h';
  if (seconds && seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds && seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return fallback;
}

function usageWindow(input: {
  label: string;
  usedPercent: number;
  resetIn: string | null;
  resetAt: string | null;
  limitWindowSeconds: number | null;
}): AgentUsageWindow {
  const usedPercent = clampPercent(input.usedPercent);
  return {
    label: input.label,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetIn: input.resetIn,
    resetAt: input.resetAt,
    limitWindowSeconds: input.limitWindowSeconds,
  };
}

async function readJson(pathname: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(pathname, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function execFileText(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout.trim() || null);
      }
    );
    child.stdin?.end();
  });
}

function parseClaudeCredentials(value: unknown): ClaudeCredentials | null {
  const oauth = getRecord(value, 'claudeAiOauth');
  const accessToken = getString(oauth?.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    subscriptionType: getString(oauth?.subscriptionType),
  };
}

async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const envCredentials = getString(process.env.CLAUDE_CODE_CREDENTIALS_JSON);
  if (envCredentials) {
    try {
      const parsed = parseClaudeCredentials(JSON.parse(envCredentials) as unknown);
      if (parsed) return parsed;
    } catch {
      logger.warn('Failed to parse CLAUDE_CODE_CREDENTIALS_JSON for usage status');
    }
  }

  if (process.platform === 'darwin') {
    const keychainJson = await execFileText(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      3000
    );
    if (keychainJson) {
      try {
        const parsed = parseClaudeCredentials(JSON.parse(keychainJson) as unknown);
        if (parsed) return parsed;
      } catch {
        logger.warn('Failed to parse Claude Code credentials from macOS Keychain');
      }
    }
  }

  const claudeHome = process.env.CLAUDE_HOME || path.join(homedir(), '.claude');
  const fileCredentials = await readJson(path.join(claudeHome, '.credentials.json'));
  return parseClaudeCredentials(fileCredentials);
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; payload: unknown | null }> {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const text = await response.text();
  if (!text.trim()) return { response, payload: null };
  try {
    return { response, payload: JSON.parse(text) as unknown };
  } catch {
    return { response, payload: null };
  }
}

export function parseClaudeUsageHeaders(
  headers: Headers,
  now: Date = new Date()
): AgentUsageWindow[] {
  const fiveHourReset = getNumber(headers.get('anthropic-ratelimit-unified-5h-reset'));
  const weeklyReset = getNumber(headers.get('anthropic-ratelimit-unified-7d-reset'));
  const fiveHourExpired = Boolean(fiveHourReset && fiveHourReset < now.getTime() / 1000);
  const weeklyExpired = Boolean(weeklyReset && weeklyReset < now.getTime() / 1000);

  const fiveHourUsed = fiveHourExpired
    ? 0
    : percentFromFraction(getNumber(headers.get('anthropic-ratelimit-unified-5h-utilization')));
  const weeklyUsed = weeklyExpired
    ? 0
    : percentFromFraction(getNumber(headers.get('anthropic-ratelimit-unified-7d-utilization')));

  return [
    usageWindow({
      label: '5h',
      usedPercent: fiveHourUsed,
      resetIn: resetInFromTimestamp(fiveHourReset, now),
      resetAt: formatResetAt(fiveHourReset),
      limitWindowSeconds: 18_000,
    }),
    usageWindow({
      label: 'Wk',
      usedPercent: weeklyUsed,
      resetIn: friendlyReset(weeklyReset, now),
      resetAt: formatResetAt(weeklyReset),
      limitWindowSeconds: 604_800,
    }),
  ];
}

function capitalizePlan(plan: string | null): string | null {
  if (!plan || plan === 'unknown' || plan === 'free') return null;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
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
        resetIn: formatUsageDuration(getNumber(primaryWindow?.reset_after_seconds) ?? 0),
        resetAt: null,
        limitWindowSeconds: primaryWindowSeconds,
      }),
      ...(secondaryWindow
        ? [
            usageWindow({
              label: windowLabel(secondaryWindowSeconds, 'Sec'),
              usedPercent: getNumber(secondaryWindow.used_percent) ?? 0,
              resetIn: friendlyReset(secondaryResetAt, now),
              resetAt: formatResetAt(secondaryResetAt),
              limitWindowSeconds: secondaryWindowSeconds,
            }),
          ]
        : []),
    ],
    credits: balance || unlimited ? { balance, unlimited } : null,
    planLabel: capitalizePlan(getString(payload.plan_type)),
    limitReached: getBoolean(rateLimit?.limit_reached),
    errorCode: null,
  };
}

async function getClaudeUsageProvider(): Promise<AgentUsageProvider> {
  const credentials = await getClaudeCredentials();
  const cacheKey = credentials ? hashToken(credentials.accessToken) : 'no-auth';
  const now = Date.now();
  if (claudeCache && claudeCache.key === cacheKey && claudeCache.expiresAt > now) {
    return claudeCache.value;
  }

  if (!credentials) {
    const provider = buildProvider({
      id: 'claude-code',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: null,
      status: 'action_required',
      detail: 'Claude Code is not authenticated on this server.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
    return provider;
  }

  const model = getCheapestModelForProvider('anthropic');
  if (!model) {
    const provider = buildProvider({
      id: 'claude-code',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: capitalizePlan(credentials.subscriptionType),
      status: 'unavailable',
      detail: 'Claude usage cannot be checked because no probe model is configured.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
    return provider;
  }

  try {
    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'sotto-agent-usage/0.1',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      },
      CLAUDE_TIMEOUT_MS
    );

    if (!response.ok) {
      const provider = buildProvider({
        id: 'claude-code',
        label: 'Claude Code',
        shortLabel: 'Claude',
        planLabel: capitalizePlan(credentials.subscriptionType),
        status:
          response.status === 401 || response.status === 403 ? 'action_required' : 'unavailable',
        detail:
          response.status === 401 || response.status === 403
            ? 'Claude Code auth needs to be refreshed on this server.'
            : 'Claude usage is unavailable right now.',
        windows: [],
        credits: null,
        limitReached: false,
      });
      claudeCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const provider = buildProvider({
      id: 'claude-code',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: capitalizePlan(credentials.subscriptionType),
      status: 'ready',
      detail: 'Claude Code usage windows are current.',
      windows: parseClaudeUsageHeaders(response.headers),
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + CLAUDE_CACHE_TTL_MS, value: provider };
    return provider;
  } catch (error) {
    logger.warn('Failed to fetch Claude Code usage status', {
      error: error instanceof Error ? error.message : String(error),
    });
    const provider = buildProvider({
      id: 'claude-code',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: capitalizePlan(credentials.subscriptionType),
      status: 'unavailable',
      detail: 'Claude usage is unreachable right now.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
    return provider;
  }
}

async function getCodexUsageProvider(): Promise<AgentUsageProvider> {
  const credentials = await getCodexCredentials();
  const cacheKey = credentials?.key ?? 'no-auth';
  const now = Date.now();
  if (codexCache && codexCache.key === cacheKey && codexCache.expiresAt > now) {
    return codexCache.value;
  }

  if (!credentials) {
    const provider = buildProvider({
      id: 'codex',
      label: 'Codex',
      shortLabel: 'Codex',
      planLabel: null,
      status: 'action_required',
      detail: 'Codex is not authenticated on this server.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    codexCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
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
      codexCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const parsed = parseCodexUsagePayload(payload);
    if (parsed.errorCode) {
      const needsAuth =
        parsed.errorCode === 'token_invalidated' || parsed.errorCode === 'token_expired';
      const provider = buildProvider({
        id: 'codex',
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
      codexCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const provider = buildProvider({
      id: 'codex',
      label: 'Codex',
      shortLabel: 'Codex',
      planLabel: parsed.planLabel,
      status: 'ready',
      detail: 'Codex usage windows are current.',
      windows: parsed.windows,
      credits: parsed.credits,
      limitReached: parsed.limitReached,
    });
    codexCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
    return provider;
  } catch (error) {
    logger.warn('Failed to fetch Codex usage status', {
      error: error instanceof Error ? error.message : String(error),
    });
    const provider = buildProvider({
      id: 'codex',
      label: 'Codex',
      shortLabel: 'Codex',
      planLabel: null,
      status: 'unavailable',
      detail: 'Codex usage is unreachable right now.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    codexCache = { key: cacheKey, expiresAt: now + CODEX_CACHE_TTL_MS, value: provider };
    return provider;
  }
}

export async function getAgentUsageStatus(): Promise<AgentUsageStatus> {
  const providers = await Promise.all([getClaudeUsageProvider(), getCodexUsageProvider()]);
  return {
    providers,
    refreshedAt: nowIso(),
    cacheTtlSeconds: Math.floor(CODEX_CACHE_TTL_MS / 1000),
  };
}

export function resetAgentUsageCacheForTests(): void {
  claudeCache = null;
  codexCache = null;
}
