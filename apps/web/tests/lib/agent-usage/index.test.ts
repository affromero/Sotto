import { describe, expect, it } from 'vitest';
import {
  formatUsageDuration,
  parseClaudeUsageHeaders,
  parseCodexUsagePayload,
} from '@/lib/agent-usage';

describe('agent-usage helpers', () => {
  it('formats usage reset durations compactly', () => {
    expect(formatUsageDuration(55)).toBe('0m');
    expect(formatUsageDuration(7_500)).toBe('2h05m');
    expect(formatUsageDuration(190_800)).toBe('2d05h');
  });

  it('parses Claude OAuth rate-limit headers into 5h and weekly windows', () => {
    const now = new Date('2026-06-27T10:00:00.000Z');
    const headers = new Headers({
      'anthropic-ratelimit-unified-5h-utilization': '0.42',
      'anthropic-ratelimit-unified-5h-reset': String(now.getTime() / 1000 + 7_200),
      'anthropic-ratelimit-unified-7d-utilization': '0.77',
      'anthropic-ratelimit-unified-7d-reset': String(now.getTime() / 1000 + 190_800),
    });

    const windows = parseClaudeUsageHeaders(headers, now);

    expect(windows).toMatchObject([
      { label: '5h', usedPercent: 42, remainingPercent: 58, resetIn: '2h00m' },
      { label: 'Wk', usedPercent: 77, remainingPercent: 23 },
    ]);
    expect(windows[1].resetIn).toContain('2d05h');
  });

  it('parses Codex usage windows and unlimited credits', () => {
    const now = new Date('2026-06-27T10:00:00.000Z');
    const parsed = parseCodexUsagePayload(
      {
        plan_type: 'plus',
        rate_limit: {
          limit_reached: false,
          primary_window: {
            used_percent: 84,
            reset_after_seconds: 3600,
            limit_window_seconds: 18000,
          },
          secondary_window: {
            used_percent: 17,
            reset_at: now.getTime() / 1000 + 604800,
            limit_window_seconds: 604800,
          },
        },
        credits: { unlimited: true, balance: '0' },
      },
      now
    );

    expect(parsed.errorCode).toBeNull();
    expect(parsed.planLabel).toBe('Plus');
    expect(parsed.credits).toEqual({ balance: '0', unlimited: true });
    expect(parsed.windows).toMatchObject([
      { label: '5h', usedPercent: 84, remainingPercent: 16, resetIn: '1h00m' },
      { label: 'Wk', usedPercent: 17, remainingPercent: 83 },
    ]);
  });

  it('reports Codex API errors without throwing', () => {
    const parsed = parseCodexUsagePayload({ error: { code: 'token_invalidated' } });

    expect(parsed.errorCode).toBe('token_invalidated');
    expect(parsed.windows).toEqual([]);
  });
});
