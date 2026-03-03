import { describe, it, expect, vi } from 'vitest';
import { getCheapestModelForProvider, getAiProviderIdsWithPricing, isValidModelId, resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  }),
}));

describe('getCheapestModelForProvider', () => {
  it('returns fast-tier model for anthropic', () => {
    expect(getCheapestModelForProvider('anthropic')).toBe('claude-haiku-4-5-20251001');
  });

  it('returns fast-tier model for openai', () => {
    expect(getCheapestModelForProvider('openai')).toBe('gpt-5-mini');
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
    expect(ids).not.toContain('claude-code');
    expect(ids).not.toContain('together');
    expect(ids).not.toContain('deepgram');
    expect(ids).not.toContain('assemblyai');
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
    expect(result.model).toBe('gpt-5');
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
});
