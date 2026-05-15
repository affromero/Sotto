import { describe, it, expect, vi } from 'vitest';
import { getCheapestModelForProvider, getAiProviderIdsWithPricing, isValidModelId, resolveAiModelAndProvider, getModelContextWindow, getModelMaxOutputTokens, type AiProviderId } from '@/lib/providers/ai-registry';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  }),
}));

describe('getCheapestModelForProvider', () => {
  it('returns fast-tier model for anthropic', () => {
    expect(getCheapestModelForProvider('anthropic')).toBe('claude-haiku-4-5-20251001');
  });

  it('returns fast-tier model for openai', () => {
    expect(getCheapestModelForProvider('openai')).toBe('gpt-5-nano');
  });

  it('returns fast-tier model for google', () => {
    expect(getCheapestModelForProvider('google')).toBe('gemini-3.1-flash-lite-preview');
  });

  it('returns first model when no fast tier exists (claude-code)', () => {
    expect(getCheapestModelForProvider('claude-code')).toBe('haiku');
  });

  it('returns null for provider with no models', () => {
    expect(getCheapestModelForProvider('deepgram')).toBeNull();
    expect(getCheapestModelForProvider('assemblyai')).toBeNull();
    expect(getCheapestModelForProvider('together')).toBeNull();
  });

  it('returns null for unknown provider', () => {
    expect(getCheapestModelForProvider('nonexistent' as AiProviderId)).toBeNull();
  });
});

describe('isValidModelId', () => {
  it('returns true for known Anthropic model', () => {
    expect(isValidModelId('claude-sonnet-4-6')).toBe(true);
  });

  it('returns true for known OpenAI model', () => {
    expect(isValidModelId('gpt-5-mini')).toBe(true);
  });

  it('returns true for known Google model', () => {
    expect(isValidModelId('gemini-3.1-flash-lite-preview')).toBe(true);
    expect(isValidModelId('gemini-3.1-pro-preview')).toBe(true);
  });

  it('returns true for gpt-5-nano', () => {
    expect(isValidModelId('gpt-5-nano')).toBe(true);
  });

  it('returns false for unknown model', () => {
    expect(isValidModelId('gpt-99-turbo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidModelId('')).toBe(false);
  });
});

describe('getAiProviderIdsWithPricing', () => {
  it('returns only providers whose models have pricing data', () => {
    const ids = getAiProviderIdsWithPricing();
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('google');
    expect(ids).not.toContain('claude-code');
    expect(ids).not.toContain('together');
    expect(ids).not.toContain('deepgram');
    expect(ids).not.toContain('assemblyai');
  });
});

describe('getModelContextWindow', () => {
  it('returns context window for Anthropic model', () => {
    expect(getModelContextWindow('claude-sonnet-4-6')).toBe(200_000);
  });

  it('returns context window for OpenAI model', () => {
    expect(getModelContextWindow('gpt-5-mini')).toBe(400_000);
  });

  it('returns context window for Google model', () => {
    expect(getModelContextWindow('gemini-3.1-flash-lite-preview')).toBe(1_000_000);
  });

  it('returns null for unknown model', () => {
    expect(getModelContextWindow('nonexistent')).toBeNull();
  });
});

describe('getModelMaxOutputTokens', () => {
  it('returns max output for Opus (128K)', () => {
    expect(getModelMaxOutputTokens('claude-opus-4-6')).toBe(128_000);
  });

  it('returns max output for Haiku (64K)', () => {
    expect(getModelMaxOutputTokens('claude-haiku-4-5-20251001')).toBe(64_000);
  });

  it('returns max output for OpenAI model (128K)', () => {
    expect(getModelMaxOutputTokens('gpt-5-nano')).toBe(128_000);
  });

  it('returns null for unknown model', () => {
    expect(getModelMaxOutputTokens('nonexistent')).toBeNull();
  });
});

describe('resolveAiModelAndProvider — unknown model fallthrough', () => {
  it('falls through to BYOK key when podcastAiModel is not in registry', async () => {
    const result = await resolveAiModelAndProvider({
      podcastAiModel: 'nonexistent-model-xyz',
      aiKey: { provider: 'openai', apiKey: 'sk-test' },
    });

    // Should fall through to BYOK default model, NOT pair unknown model with 'anthropic'
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5.4');  // defaultModel changed to gpt-5.4
  });

  it('falls through to auto-model when podcastAiModel is unknown and no BYOK key', async () => {
    const result = await resolveAiModelAndProvider({
      podcastAiModel: 'nonexistent-model-xyz',
    });

    // Should fall through to auto-model config
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
  });

  it('returns known model with its provider when podcastAiModel is valid', async () => {
    const result = await resolveAiModelAndProvider({
      podcastAiModel: 'gpt-5-mini',
    });

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5-mini');
  });

  it('keeps claude-code composite models routed to local Claude Code', async () => {
    const result = await resolveAiModelAndProvider({
      podcastAiModel: 'claude-code:sonnet',
    });

    expect(result.provider).toBe('claude-code');
    expect(result.model).toBe('claude-code:sonnet');
  });
});
