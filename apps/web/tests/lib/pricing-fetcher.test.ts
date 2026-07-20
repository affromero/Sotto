import { describe, it, expect, vi } from 'vitest';
import { filterToKnownModels, type ExtractedModelPricing } from '@/lib/pricing-fetcher';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('filterToKnownModels', () => {
  it('keeps models that exist in the AI registry', () => {
    const extracted: ExtractedModelPricing[] = [
      {
        modelId: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet',
        inputPerMTok: 3.0,
        outputPerMTok: 15.0,
      },
      { modelId: 'gpt-5-mini', displayName: 'GPT-5 Mini', inputPerMTok: 0.25, outputPerMTok: 2.0 },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(2);
    expect(result[0].modelId).toBe('claude-sonnet-4-6');
    expect(result[1].modelId).toBe('gpt-5-mini');
  });

  it('keeps models that exist in pricetoken catalog but not AI registry', () => {
    const extracted: ExtractedModelPricing[] = [
      {
        modelId: 'deepseek-chat',
        displayName: 'DeepSeek Chat',
        inputPerMTok: 0.27,
        outputPerMTok: 1.1,
      },
      { modelId: 'grok-3', displayName: 'Grok 3', inputPerMTok: 3.0, outputPerMTok: 15.0 },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(2);
  });

  it('filters out completely unknown models', () => {
    const extracted: ExtractedModelPricing[] = [
      {
        modelId: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet',
        inputPerMTok: 3.0,
        outputPerMTok: 15.0,
      },
      { modelId: 'totally-fake-model', displayName: 'Fake', inputPerMTok: 1.0, outputPerMTok: 1.0 },
      {
        modelId: 'gpt-99-turbo',
        displayName: 'GPT-99 Turbo',
        inputPerMTok: 0.5,
        outputPerMTok: 5.0,
      },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('claude-sonnet-4-6');
  });

  it('returns empty array for all unknown models', () => {
    const extracted: ExtractedModelPricing[] = [
      { modelId: 'unknown-1', displayName: 'U1', inputPerMTok: 1.0, outputPerMTok: 1.0 },
      { modelId: 'unknown-2', displayName: 'U2', inputPerMTok: 2.0, outputPerMTok: 2.0 },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterToKnownModels([])).toHaveLength(0);
  });

  it('preserves optional fields (contextWindow, maxOutputTokens)', () => {
    const extracted: ExtractedModelPricing[] = [
      {
        modelId: 'claude-opus-4-6',
        displayName: 'Claude Opus',
        inputPerMTok: 5.0,
        outputPerMTok: 25.0,
        contextWindow: 200_000,
        maxOutputTokens: 128_000,
      },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(1);
    expect(result[0].contextWindow).toBe(200_000);
    expect(result[0].maxOutputTokens).toBe(128_000);
  });
});
