/**
 * Centralized AI model pricing lookup.
 * All costs are per 1 million tokens.
 *
 * Pricing is derived from the AI registry (single source of truth).
 * Only embeddings are hardcoded here — they're not LLM models.
 */
import { logger } from './logger';
import { getAllAiProviderMeta, getAiProviderMeta, getCheapestModelForProvider } from './providers/ai-registry';

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

function buildPricingMap(): Record<string, ModelPricing> {
  const map: Record<string, ModelPricing> = {};
  for (const provider of getAllAiProviderMeta()) {
    for (const model of provider.models) {
      if (model.pricing) map[model.id] = model.pricing;
    }
  }
  // Claude Code — zero-cost local CLI (derived from registry, no pricing field)
  const ccMeta = getAiProviderMeta('claude-code');
  for (const m of ccMeta.models) {
    map[`claude-code:${m.id}`] = { inputPerMTok: 0, outputPerMTok: 0 };
  }
  // Embeddings — not in AI registry (not an LLM model)
  map['text-embedding-3-small'] = { inputPerMTok: 0.02, outputPerMTok: 0 };
  return map;
}

const AI_PRICING = buildPricingMap();

// Default fallback: Sonnet 4.6 pricing (matches prior hardcoded behavior)
const FALLBACK_PRICING: ModelPricing = { inputPerMTok: 3.0, outputPerMTok: 15.0 };

export function getAiPricing(model: string): ModelPricing {
  const pricing = AI_PRICING[model];
  if (!pricing) {
    logger.warn('Unknown model for pricing lookup, using Sonnet 4.6 fallback', { model });
    return FALLBACK_PRICING;
  }
  return pricing;
}

export function getAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getAiPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return inputCost + outputCost;
}

/** Pick the cheapest generative model from the pricing table (excludes embeddings + local CLI). */
export function getCheapestModel(): string {
  let cheapest: { model: string; cost: number } | null = null;
  for (const [model, pricing] of Object.entries(AI_PRICING)) {
    if (model.startsWith('text-embedding') || model.startsWith('claude-code:')) continue;
    const totalCost = pricing.inputPerMTok + pricing.outputPerMTok;
    if (!cheapest || totalCost < cheapest.cost) {
      cheapest = { model, cost: totalCost };
    }
  }
  return cheapest?.model ?? getCheapestModelForProvider('anthropic') ?? 'claude-haiku-4-5-20251001';
}
