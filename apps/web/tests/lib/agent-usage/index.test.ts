import { describe, expect, it } from 'vitest';
import {
  formatUsageDuration,
  parseCartesiaCreditUsagePayload,
  parseClaudeUsageHeaders,
  parseCodexUsagePayload,
  parseElevenLabsSubscriptionPayload,
  resolveCartesiaBillingWindow,
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

  it('parses Codex model-specific additional rate limits', () => {
    const now = new Date('2026-06-27T10:00:00.000Z');
    const parsed = parseCodexUsagePayload(
      {
        plan_type: 'pro',
        rate_limit: {
          limit_reached: false,
          primary_window: {
            used_percent: 22,
            reset_at: now.getTime() / 1000 + 7200,
            limit_window_seconds: 18000,
          },
          secondary_window: {
            used_percent: 43,
            reset_at: now.getTime() / 1000 + 604800,
            limit_window_seconds: 604800,
          },
        },
        additional_rate_limits: [
          {
            limit_name: 'GPT-5.3-Codex-Spark',
            metered_feature: 'gpt_5_3_codex_spark',
            rate_limit: {
              primary_window: {
                used_percent: 30,
                reset_at: now.getTime() / 1000 + 3600,
                limit_window_seconds: 18000,
              },
              secondary_window: {
                used_percent: 100,
                reset_at: now.getTime() / 1000 + 604800,
                limit_window_seconds: 604800,
              },
            },
          },
          {
            limit_name: 'GPT-5.3-Codex-Mini',
            metered_feature: 'gpt_5_3_codex_mini',
            rate_limit: {
              primary_window: {
                used_percent: 12,
                reset_at: now.getTime() / 1000 + 3600,
                limit_window_seconds: 18000,
              },
            },
          },
          {
            limit_name: 'GPT-5.3-Codex-Mini duplicate',
            metered_feature: 'gpt_5_3_codex_mini',
            rate_limit: {
              primary_window: {
                used_percent: 99,
                reset_at: now.getTime() / 1000 + 3600,
                limit_window_seconds: 18000,
              },
            },
          },
          'malformed',
        ],
      },
      now
    );

    expect(parsed.errorCode).toBeNull();
    expect(parsed.planLabel).toBe('Pro');
    expect(parsed.windows.map((window) => window.label)).toEqual([
      '5h',
      'Wk',
      'Spark 5h',
      'Spark Wk',
      'Mini 5h',
    ]);
    expect(parsed.windows).toMatchObject([
      { label: '5h', usedPercent: 22, resetIn: '2h00m' },
      { label: 'Wk', usedPercent: 43 },
      { label: 'Spark 5h', usedPercent: 30, resetIn: '1h00m' },
      { label: 'Spark Wk', usedPercent: 100 },
      { label: 'Mini 5h', usedPercent: 12 },
    ]);
  });

  it('reports Codex API errors without throwing', () => {
    const parsed = parseCodexUsagePayload({ error: { code: 'token_invalidated' } });

    expect(parsed.errorCode).toBe('token_invalidated');
    expect(parsed.windows).toEqual([]);
  });

  it('parses ElevenLabs subscription credits and reset time', () => {
    const now = new Date('2026-06-27T10:00:00.000Z');
    const parsed = parseElevenLabsSubscriptionPayload(
      {
        tier: 'creator',
        status: 'active',
        character_count: 25_000,
        character_limit: 100_000,
        character_refresh_period: 'monthly_period',
        next_character_count_reset_unix: now.getTime() / 1000 + 86_400,
        can_extend_character_limit: false,
      },
      now
    );

    expect(parsed.errorCode).toBeNull();
    expect(parsed.planLabel).toBe('Creator');
    expect(parsed.credits?.label).toBe('75,000 credits left');
    expect(parsed.limitReached).toBe(false);
    expect(parsed.windows).toMatchObject([{ label: 'Mo', usedPercent: 25, remainingPercent: 75 }]);
  });

  it('parses Cartesia usage as used-only without a configured monthly limit', () => {
    const now = new Date('2026-06-27T10:00:00.000Z');
    const parsed = parseCartesiaCreditUsagePayload(
      {
        data: [
          {
            start_ts: '2026-06-01T00:00:00.000Z',
            end_ts: '2026-06-15T00:00:00.000Z',
            credits: 1200,
          },
          {
            start_ts: '2026-06-15T00:00:00.000Z',
            end_ts: '2026-06-27T10:00:00.000Z',
            credits: 345,
          },
        ],
      },
      {
        monthlyLimit: null,
        windowStart: new Date('2026-06-01T00:00:00.000Z'),
        windowEnd: new Date('2026-07-01T00:00:00.000Z'),
        now,
      }
    );

    expect(parsed.errorCode).toBeNull();
    expect(parsed.credits?.label).toBe('1,545 credits used');
    expect(parsed.windows).toMatchObject([
      { label: 'Mo', usedPercent: 0, valueLabel: '1,545 used', unbounded: true },
    ]);
  });

  it('parses Cartesia remaining credits with a configured monthly limit', () => {
    const now = new Date('2026-06-27T10:00:00.000Z');
    const parsed = parseCartesiaCreditUsagePayload(
      { data: [{ credits: 4000 }] },
      {
        monthlyLimit: 10_000,
        windowStart: new Date('2026-06-01T00:00:00.000Z'),
        windowEnd: new Date('2026-07-01T00:00:00.000Z'),
        now,
      }
    );

    expect(parsed.credits?.label).toBe('6,000 credits left');
    expect(parsed.limitReached).toBe(false);
    expect(parsed.windows).toMatchObject([
      { label: 'Mo', usedPercent: 40, remainingPercent: 60, valueLabel: '40%' },
    ]);
  });

  it('resolves Cartesia monthly billing windows from a configured reset day', () => {
    const window = resolveCartesiaBillingWindow(new Date('2026-06-27T10:00:00.000Z'), 15);

    expect(window.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });
});
