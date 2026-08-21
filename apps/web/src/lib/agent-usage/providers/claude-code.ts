import { homedir } from 'os';
import path from 'path';
import { logger } from '../../logger';
import { getCheapestModelForProvider } from '../../providers/ai-registry';
import type { AgentUsageCacheEntry, AgentUsageProvider, AgentUsageWindow } from '../types';
import {
  buildProvider,
  capitalizePlan,
  ERROR_CACHE_TTL_MS,
  execFileText,
  fetchWithTimeout,
  formatResetAt,
  friendlyReset,
  getNumber,
  getRecord,
  getString,
  hashToken,
  percentFromFraction,
  readJson,
  resetInFromTimestamp,
  usageWindow,
} from '../utils';

interface ClaudeCredentials {
  accessToken: string;
  subscriptionType: string | null;
}

const CLAUDE_CACHE_TTL_MS = 5 * 60 * 1000;
const CLAUDE_TIMEOUT_MS = 10_000;

let claudeCache: AgentUsageCacheEntry | null = null;

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
      resetIn: friendlyReset(weeklyReset),
      resetAt: formatResetAt(weeklyReset),
      limitWindowSeconds: 604_800,
    }),
  ];
}

export async function getClaudeUsageProvider(): Promise<AgentUsageProvider> {
  const credentials = await getClaudeCredentials();
  const cacheKey = credentials ? hashToken(credentials.accessToken) : 'no-auth';
  const now = Date.now();
  if (claudeCache && claudeCache.key === cacheKey && claudeCache.expiresAt > now) {
    return claudeCache.value;
  }

  if (!credentials) {
    const provider = buildProvider({
      id: 'claude-code',
      category: 'agent',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: null,
      status: 'action_required',
      detail: 'Claude Code is not authenticated on this server.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
    return provider;
  }

  const model = getCheapestModelForProvider('anthropic');
  if (!model) {
    const provider = buildProvider({
      id: 'claude-code',
      category: 'agent',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: capitalizePlan(credentials.subscriptionType),
      status: 'unavailable',
      detail: 'Claude usage cannot be checked because no probe model is configured.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
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
        category: 'agent',
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
      claudeCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
      return provider;
    }

    const provider = buildProvider({
      id: 'claude-code',
      category: 'agent',
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
      category: 'agent',
      label: 'Claude Code',
      shortLabel: 'Claude',
      planLabel: capitalizePlan(credentials.subscriptionType),
      status: 'unavailable',
      detail: 'Claude usage is unreachable right now.',
      windows: [],
      credits: null,
      limitReached: false,
    });
    claudeCache = { key: cacheKey, expiresAt: now + ERROR_CACHE_TTL_MS, value: provider };
    return provider;
  }
}

export function resetClaudeUsageCacheForTests(): void {
  claudeCache = null;
}
