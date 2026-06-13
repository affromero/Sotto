/**
 * Centralized AI model pricing lookup.
 * All costs are per 1 million tokens.
 *
 * Pricing is derived from the AI registry (single source of truth) at module load,
 * then optionally refreshed from ModelPricingSnapshot DB rows every 5 minutes.
 * The refresh is opt-in via startPricingRefreshInterval() — never fires at build/test time.
 */
import { STATIC_PRICING } from 'pricetoken';
import { logger } from './logger';
import { getAllAiProviderMeta, getAiProviderMeta, getCheapestModelForProvider, isValidModelId } from './providers/ai-registry';

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

function buildPricingMap(): Record<string, ModelPricing> {
  const map: Record<string, ModelPricing> = {};
  // Start with all pricetoken models (36+ models across providers)
  for (const entry of STATIC_PRICING) {
    map[entry.modelId] = { inputPerMTok: entry.inputPerMTok, outputPerMTok: entry.outputPerMTok };
  }
  // Overlay registry models (includes pricetoken-hydrated pricing + manual fallbacks like gemini-3.1-flash-lite-preview)
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
  // Codex — zero-cost local CLI (no per-token cost to us)
  map['codex'] = { inputPerMTok: 0, outputPerMTok: 0 };
  // Embeddings — not in AI registry (not an LLM model)
  map['text-embedding-3-small'] = { inputPerMTok: 0.02, outputPerMTok: 0 };
  return map;
}

const AI_PRICING = buildPricingMap();

/** Mutable in-memory pricing map — starts as registry baseline, updated by DB refresh. */
let activePricing: Record<string, ModelPricing> = { ...AI_PRICING };

// Default fallback: Sonnet 4.6 pricing (matches prior hardcoded behavior)
const FALLBACK_PRICING: ModelPricing = { inputPerMTok: 3.0, outputPerMTok: 15.0 };

export function getAiPricing(model: string): ModelPricing {
  const pricing = activePricing[model];
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

/** Pick the cheapest generative model from the pricing table that Sotto can actually serve (registry models only). */
export function getCheapestModel(): string {
  let cheapest: { model: string; cost: number } | null = null;
  for (const [model, pricing] of Object.entries(activePricing)) {
    if (model.startsWith('text-embedding') || model.startsWith('claude-code:') || model === 'codex') continue;
    if (!isValidModelId(model)) continue;
    const totalCost = pricing.inputPerMTok + pricing.outputPerMTok;
    if (!cheapest || totalCost < cheapest.cost) {
      cheapest = { model, cost: totalCost };
    }
  }
  return cheapest?.model ?? getCheapestModelForProvider('anthropic') ?? 'claude-haiku-4-5-20251001';
}

// ---------------------------------------------------------------------------
// Dynamic refresh from DB (opt-in)
// ---------------------------------------------------------------------------

/** Refresh in-memory pricing from the latest DB snapshots. */
export async function refreshPricingFromDb(): Promise<void> {
  try {
    const { getLatestPricingFromDb } = await import('./pricing-fetcher');
    const dbPricing = await getLatestPricingFromDb();
    if (dbPricing.size === 0) return;

    // Start with registry baseline, overlay DB values
    const merged = { ...AI_PRICING };
    for (const [modelId, data] of dbPricing) {
      merged[modelId] = { inputPerMTok: data.inputPerMTok, outputPerMTok: data.outputPerMTok };
    }
    activePricing = merged;
    logger.debug('Pricing refreshed from DB', { modelCount: dbPricing.size });
  } catch (error) {
    logger.warn('Failed to refresh pricing from DB', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Returns the full pricing map with source info (for admin page). */
export async function getAllCurrentPricing(): Promise<
  Array<{ modelId: string; inputPerMTok: number; outputPerMTok: number; source: string }>
> {
  try {
    const { getLatestPricingFromDb } = await import('./pricing-fetcher');
    const dbPricing = await getLatestPricingFromDb();
    const result: Array<{ modelId: string; inputPerMTok: number; outputPerMTok: number; source: string }> = [];

    // Include all models from the active pricing map
    for (const [modelId, pricing] of Object.entries(activePricing)) {
      const dbEntry = dbPricing.get(modelId);
      result.push({
        modelId,
        inputPerMTok: pricing.inputPerMTok,
        outputPerMTok: pricing.outputPerMTok,
        source: dbEntry?.source ?? 'registry',
      });
    }
    return result;
  } catch {
    return Object.entries(activePricing).map(([modelId, pricing]) => ({
      modelId,
      ...pricing,
      source: 'registry',
    }));
  }
}

/**
 * Load pricing from DB once on startup.
 * The daily pricing-fetch worker handles ongoing updates — no in-process interval needed.
 * Call this from workers/index.ts or Next.js instrumentation — NOT at module scope.
 */
let _startedOnce = false;
export function startPricingRefreshInterval(): void {
  if (_startedOnce) return;
  _startedOnce = true;
  refreshPricingFromDb().catch(() => {});
}
