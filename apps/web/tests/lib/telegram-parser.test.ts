import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGenerateResponse = vi.fn();
const { mockGetAiKey } = vi.hoisted(() => ({
  mockGetAiKey: vi.fn(),
}));

const mockProvider = {
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  streamResponse: vi.fn(),
};

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: vi.fn(() => mockProvider),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: vi.fn((id: string) => {
    if (id === 'anthropic') return { defaultModel: 'claude-haiku-4-5-20251001' };
    if (id === 'openai') return { defaultModel: 'gpt-5' };
    if (id === 'claude-code') return { defaultModel: 'opus' };
    return { defaultModel: '' };
  }),
  getProviderForModel: vi.fn((id: string) => {
    if (id === 'claude-haiku-4-5-20251001') return 'anthropic';
    if (id === 'gpt-5-mini') return 'openai';
    if (id === 'sonnet') return 'claude-code';
    return null;
  }),
  isValidAiProviderId: vi.fn((id: string) => ['anthropic', 'openai', 'claude-code'].includes(id)),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { parseTelegramIntent } from '@/lib/telegram-parser';
import type { TelegramParseResult } from '@/types/telegram';

const result: TelegramParseResult = {
  topic: 'Private AI Briefings',
  title: 'Private AI Briefings',
  depth: 'standard',
  audienceLevel: 'beginner',
  tone: 'professional',
  focusAreas: ['privacy', 'automation'],
  isComplete: true,
};

describe('parseTelegramIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAiKey.mockImplementation(async (_userId: string, provider?: string) => {
      if (provider === 'openai') return { apiKey: 'openai-key', provider: 'openai' };
      return { apiKey: 'anthropic-key', provider: 'anthropic' };
    });
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(result),
      inputTokens: 20,
      outputTokens: 30,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('uses the user BYOK default model', async () => {
    const parsed = await parseTelegramIntent('make a private briefing', { userId: 'user-1' });

    expect(parsed).toEqual(result);
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        apiKeyOverride: 'anthropic-key',
      }),
    );
  });

  it('requires a user AI key when no local model is selected', async () => {
    mockGetAiKey.mockResolvedValue(null);

    await expect(parseTelegramIntent('make a private briefing', { userId: 'user-1' })).rejects.toThrow(
      'AI key or explicit local AI model is required to parse Telegram messages.',
    );
  });

  it('uses explicit hosted models with the matching provider key', async () => {
    await parseTelegramIntent('make a private briefing', {
      userId: 'user-1',
      aiModel: 'gpt-5-mini',
    });

    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'openai');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        model: 'gpt-5-mini',
        apiKeyOverride: 'openai-key',
      }),
    );
  });

  it('uses local Claude Code models without an AI key', async () => {
    mockGetAiKey.mockResolvedValue(null);

    await parseTelegramIntent('make a private briefing', { aiModel: 'claude-code:sonnet' });

    expect(mockGetAiKey).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        model: 'claude-code:sonnet',
        apiKeyOverride: undefined,
      }),
    );
  });
});
