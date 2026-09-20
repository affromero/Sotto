import { describe, it, expect, vi } from 'vitest';
import { getAiPricing, getAiCost, getCheapestModel } from '@/lib/pricing';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('getAiPricing', () => {
  it('returns pricing for known Anthropic model', () => {
    const pricing = getAiPricing('claude-haiku-4-5-20251001');
    expect(pricing).toEqual({ inputPerMTok: 1.0, outputPerMTok: 5.0 });
  });

  it('returns pricing for known OpenAI model', () => {
    const pricing = getAiPricing('gpt-5-nano');
    expect(pricing).toEqual({ inputPerMTok: 0.05, outputPerMTok: 0.4 });
  });

  it('returns pricing for known Google model', () => {
    const pricing = getAiPricing('gemini-3.1-flash-lite-preview');
    expect(pricing).toEqual({ inputPerMTok: 0.25, outputPerMTok: 1.5 });
  });

  it('leaves subscription pricing unknown for claude-code models', () => {
    const pricing = getAiPricing('claude-code:haiku');
    expect(pricing).toBeNull();
  });

  it('leaves subscription pricing unknown for Codex effort selectors', () => {
    const pricing = getAiPricing('codex#effort=xhigh');
    expect(pricing).toBeNull();
  });

  it('leaves unrecognized model pricing unknown', () => {
    const pricing = getAiPricing('unknown-model-xyz');
    expect(pricing).toBeNull();
  });
});

describe('getAiCost', () => {
  it('computes cost correctly for 1M input + 1M output tokens', () => {
    // Haiku: $1.00 input + $5.00 output = $6.00
    const cost = getAiCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(6.0, 2);
  });

  it('computes cost for partial token counts', () => {
    // GPT-5 Nano: 500K input * $0.05/M = $0.025, 200K output * $0.40/M = $0.08
    const cost = getAiCost('gpt-5-nano', 500_000, 200_000);
    expect(cost).toBeCloseTo(0.105, 4);
  });

  it('does not invent a token cost for a CLI subscription', () => {
    const cost = getAiCost('claude-code:opus', 1_000_000, 1_000_000);
    expect(cost).toBeNull();
  });

  it.each([null, undefined, -1, NaN, 0.5])(
    'keeps cost unknown for missing or invalid token counts (%s)',
    (count) => {
      expect(getAiCost('gpt-5-nano', count, 10)).toBeNull();
      expect(getAiCost('gpt-5-nano', 10, count)).toBeNull();
    }
  );
});

describe('getCheapestModel', () => {
  it('returns the cheapest registered model by total per-MTok cost', () => {
    // Groq's Llama 3.1 8B Instant ($0.05 + $0.08 = $0.13 total) is the cheapest,
    // below gpt-5-nano ($0.05 + $0.40 = $0.45).
    expect(getCheapestModel()).toBe('llama-3.1-8b-instant');
  });
});
