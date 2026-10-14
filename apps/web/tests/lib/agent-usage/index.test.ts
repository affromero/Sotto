import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAutoModelConfig, getAutoModelConfig } from '@/lib/auto-model-config';
import { getClaudeUsageProvider } from '@/lib/agent-usage/providers/claude-code';
import { getCodexUsageProvider } from '@/lib/agent-usage/providers/codex';
import { getElevenLabsUsageProvider } from '@/lib/agent-usage/providers/elevenlabs';
import { getCartesiaUsageProvider } from '@/lib/agent-usage/providers/cartesia';
import { buildProvider } from '@/lib/agent-usage/utils';
import {
  formatUsageDuration,
  getAgentUsageStatus,
  parseCartesiaCreditUsagePayload,
  parseClaudeUsageHeaders,
  parseCodexUsagePayload,
  parseElevenLabsSubscriptionPayload,
  resolveCartesiaBillingWindow,
} from '@/lib/agent-usage';

vi.mock('@/lib/auto-model-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auto-model-config')>()),
  getAutoModelConfig: vi.fn(),
}));

vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  captureSottoProviderAdmission: async ({ signal }: { signal?: AbortSignal }) => {
    signal?.throwIfAborted();
    return { validate: async (requestSignal: AbortSignal) => requestSignal.throwIfAborted() };
  },
}));

vi.mock('@/lib/agent-usage/providers/claude-code', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-usage/providers/claude-code')>()),
  getClaudeUsageProvider: vi.fn(),
}));
vi.mock('@/lib/agent-usage/providers/codex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-usage/providers/codex')>()),
  getCodexUsageProvider: vi.fn(),
}));
vi.mock('@/lib/agent-usage/providers/elevenlabs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-usage/providers/elevenlabs')>()),
  getElevenLabsUsageProvider: vi.fn(),
}));
vi.mock('@/lib/agent-usage/providers/cartesia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-usage/providers/cartesia')>()),
  getCartesiaUsageProvider: vi.fn(),
}));

describe('configured provider usage', () => {
  const execution = {
    userId: 'usage-recipient',
    authorize: async () => ({ userId: 'usage-recipient' }),
  };

  beforeEach(() => {
    vi.mocked(getAutoModelConfig).mockResolvedValue(defaultAutoModelConfig());
    for (const [id, adapter] of [
      ['claude-code', getClaudeUsageProvider],
      ['codex', getCodexUsageProvider],
      ['elevenlabs', getElevenLabsUsageProvider],
      ['cartesia', getCartesiaUsageProvider],
    ] as const) {
      vi.mocked(adapter).mockResolvedValue(
        buildProvider({
          id,
          category: id === 'claude-code' || id === 'codex' ? 'agent' : 'audio',
          label: id,
          shortLabel: id,
          planLabel: null,
          status: 'action_required',
          detail: 'Authentication needs to be refreshed.',
          windows: [],
          credits: null,
          limitReached: false,
        })
      );
    }
  });

  afterEach(() => vi.resetAllMocks());

  it.each([
    { disabled: ['claude-code'], expected: ['codex', 'elevenlabs', 'cartesia'] },
    { disabled: ['codex'], expected: ['claude-code', 'elevenlabs', 'cartesia'] },
    { disabled: ['claude-code', 'codex'], expected: ['elevenlabs', 'cartesia'] },
  ])(
    'omits disabled system providers ($disabled) without probing them',
    async ({ disabled, expected }) => {
      vi.mocked(getAutoModelConfig).mockResolvedValue({
        ...defaultAutoModelConfig(),
        includedModels: disabled.map((id) => `__disabled-system-ai-provider:${id}`),
      });
      if (disabled.includes('claude-code')) {
        vi.mocked(getClaudeUsageProvider).mockRejectedValue(
          new Error('Disabled Claude was probed')
        );
      }
      if (disabled.includes('codex')) {
        vi.mocked(getCodexUsageProvider).mockRejectedValue(new Error('Disabled Codex was probed'));
      }

      const usage = await getAgentUsageStatus(execution);

      expect(usage.providers.map((provider) => provider.id)).toEqual(expected);
    }
  );

  it('keeps authentication warnings for enabled system providers', async () => {
    const usage = await getAgentUsageStatus(execution);

    expect(usage.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'claude-code', status: 'action_required' }),
        expect.objectContaining({ id: 'codex', status: 'action_required' }),
      ])
    );
  });

  it('applies provider disabling on the next usage refresh', async () => {
    const enabled = await getAgentUsageStatus(execution);
    expect(enabled.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'claude-code' })])
    );
    vi.mocked(getAutoModelConfig).mockResolvedValue({
      ...defaultAutoModelConfig(),
      includedModels: ['__disabled-system-ai-provider:claude-code'],
    });

    const disabled = await getAgentUsageStatus(execution);

    expect(disabled.providers.map((provider) => provider.id)).toEqual([
      'codex',
      'elevenlabs',
      'cartesia',
    ]);
  });
});

describe('agent-usage helpers', () => {
  it('rejects a canceled usage request before inspecting provider accounts', async () => {
    const controller = new AbortController();
    const failure = new Error('Usage request canceled');
    controller.abort(failure);
    await expect(
      getAgentUsageStatus({
        userId: 'canceled-recipient',
        signal: controller.signal,
        authorize: async () => {
          throw new Error('Canceled requests must not reach authorization');
        },
      })
    ).rejects.toBe(failure);
  });
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
    expect(windows[1].resetIn).toBe('Jun 29');
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
    const parsed = parseElevenLabsSubscriptionPayload({
      tier: 'creator',
      status: 'active',
      character_count: 25_000,
      character_limit: 100_000,
      character_refresh_period: 'monthly_period',
      next_character_count_reset_unix: now.getTime() / 1000 + 86_400,
      can_extend_character_limit: false,
    });

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
