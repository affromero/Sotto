import { describe, it, expect, vi } from 'vitest';
import { filterToKnownModels, type ExtractedModelPricing } from '@/lib/pricing-fetcher';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('filterToKnownModels', () => {
  it('keeps models that exist in the registry', () => {
    const extracted: ExtractedModelPricing[] = [
      { modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet', inputPerMTok: 3.0, outputPerMTok: 15.0 },
      { modelId: 'gpt-5-mini', displayName: 'GPT-5 Mini', inputPerMTok: 0.25, outputPerMTok: 2.0 },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(2);
    expect(result[0].modelId).toBe('claude-sonnet-4-6');
    expect(result[1].modelId).toBe('gpt-5-mini');
  });

  it('filters out unknown models', () => {
    const extracted: ExtractedModelPricing[] = [
      { modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet', inputPerMTok: 3.0, outputPerMTok: 15.0 },
      { modelId: 'totally-fake-model', displayName: 'Fake', inputPerMTok: 1.0, outputPerMTok: 1.0 },
      { modelId: 'gpt-99-turbo', displayName: 'GPT-99 Turbo', inputPerMTok: 0.5, outputPerMTok: 5.0 },
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

  it('includes Google Gemini models', () => {
    const extracted: ExtractedModelPricing[] = [
      { modelId: 'gemini-3.1-flash-lite-preview', displayName: 'Flash Lite', inputPerMTok: 0.25, outputPerMTok: 1.5 },
      { modelId: 'gemini-3.1-pro-preview', displayName: 'Pro', inputPerMTok: 2.0, outputPerMTok: 12.0 },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(2);
  });

  it('includes GPT-5 Nano', () => {
    const extracted: ExtractedModelPricing[] = [
      { modelId: 'gpt-5-nano', displayName: 'GPT-5 Nano', inputPerMTok: 0.05, outputPerMTok: 0.4 },
    ];
    const result = filterToKnownModels(extracted);
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('gpt-5-nano');
  });
});

describe('PRICING_URLS', () => {
  it('exports URLs for all 3 providers', async () => {
    const { PRICING_URLS } = await import('@/lib/pricing-fetcher');
    expect(Object.keys(PRICING_URLS)).toEqual(expect.arrayContaining(['openai', 'anthropic', 'google']));
    expect(Object.keys(PRICING_URLS)).toHaveLength(3);
  });

  it('all URLs are valid HTTPS URLs', async () => {
    const { PRICING_URLS } = await import('@/lib/pricing-fetcher');
    for (const url of Object.values(PRICING_URLS)) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});
