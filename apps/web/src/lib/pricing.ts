/**
 * Centralized AI model pricing lookup.
 * All costs are per 1 million tokens.
 */
import { logger } from './logger';

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const AI_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  'claude-opus-4-6': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  // OpenAI
  'gpt-5-mini': { inputPerMTok: 0.3, outputPerMTok: 1.0 },
  'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  'gpt-5.2': { inputPerMTok: 1.75, outputPerMTok: 14.0 },
  // Embeddings
  'text-embedding-3-small': { inputPerMTok: 0.02, outputPerMTok: 0 },
  // Claude Code (local CLI — no API cost)
  'claude-code:haiku': { inputPerMTok: 0, outputPerMTok: 0 },
  'claude-code:sonnet': { inputPerMTok: 0, outputPerMTok: 0 },
  'claude-code:opus': { inputPerMTok: 0, outputPerMTok: 0 },
};

// Default fallback: Sonnet 4.6 pricing (matches prior hardcoded behavior)
const FALLBACK_PRICING: ModelPricing = { inputPerMTok: 3.0, outputPerMTok: 15.0 };

export function getAiPricing(model: string): ModelPricing {
  const pricing = AI_PRICING[model];
  if (!pricing) {
    logger.warn('Unknown model for pricing lookup, using Sonnet 4.5 fallback', { model });
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
