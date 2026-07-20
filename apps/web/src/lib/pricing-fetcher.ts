/**
 * Pricing fetcher — fetches AI model pricing from pricetoken.ai API
 * and persists snapshots to the database.
 *
 * Replaced the old HTML-scraping + LLM-extraction pipeline with a single
 * structured API call to pricetoken.ai.
 */
import { PriceTokenClient, STATIC_PRICING } from 'pricetoken';
import { prisma } from './prisma';
import { logger } from './logger';
import { getPricetokenModelInfo } from './providers/ai-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedModelPricing {
  modelId: string;
  displayName: string;
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

// ---------------------------------------------------------------------------
// Fetch from pricetoken API
// ---------------------------------------------------------------------------

/** Fetch all model pricing from pricetoken.ai API. */
export async function fetchPricingFromPricetoken(): Promise<ExtractedModelPricing[]> {
  const apiKey = process.env.PRICETOKEN_API_KEY;
  const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);

  const models = await client.getPricing();
  return models.map((m) => ({
    modelId: m.modelId,
    displayName: m.displayName,
    inputPerMTok: m.inputPerMTok,
    outputPerMTok: m.outputPerMTok,
    contextWindow: m.contextWindow ?? undefined,
    maxOutputTokens: m.maxOutputTokens ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/** Save pricing snapshots to the database. */
export async function savePricingSnapshots(
  snapshots: Array<{
    modelId: string;
    provider: string;
    inputPerMTok: number;
    outputPerMTok: number;
    contextWindow?: number;
    maxOutputTokens?: number;
    source: string;
  }>
): Promise<void> {
  if (snapshots.length === 0) return;
  await prisma.modelPricingSnapshot.createMany({ data: snapshots });
}

/** Get the latest pricing snapshot per model. */
export async function getLatestPricingFromDb(): Promise<
  Map<string, { inputPerMTok: number; outputPerMTok: number; source: string }>
> {
  const snapshots = await prisma.$queryRaw<
    Array<{ modelId: string; inputPerMTok: number; outputPerMTok: number; source: string }>
  >`
    SELECT DISTINCT ON ("modelId") "modelId", "inputPerMTok", "outputPerMTok", "source"
    FROM "ModelPricingSnapshot"
    ORDER BY "modelId", "createdAt" DESC
  `;

  const map = new Map<string, { inputPerMTok: number; outputPerMTok: number; source: string }>();
  for (const s of snapshots) {
    map.set(s.modelId, {
      inputPerMTok: s.inputPerMTok,
      outputPerMTok: s.outputPerMTok,
      source: s.source,
    });
  }
  return map;
}

/** Get model IDs where the latest snapshot has source='admin'. */
export async function getAdminOverriddenModels(): Promise<Set<string>> {
  const map = await getLatestPricingFromDb();
  const adminSet = new Set<string>();
  for (const [modelId, data] of map) {
    if (data.source === 'admin') adminSet.add(modelId);
  }
  return adminSet;
}

/** Seed the pricing table from pricetoken static data + registry if no snapshots exist. */
export async function seedPricingFromRegistry(): Promise<void> {
  const count = await prisma.modelPricingSnapshot.count();
  if (count > 0) return;

  const snapshots: Array<{
    modelId: string;
    provider: string;
    inputPerMTok: number;
    outputPerMTok: number;
    contextWindow?: number;
    maxOutputTokens?: number;
    source: string;
  }> = [];

  for (const entry of STATIC_PRICING) {
    snapshots.push({
      modelId: entry.modelId,
      provider: entry.provider,
      inputPerMTok: entry.inputPerMTok,
      outputPerMTok: entry.outputPerMTok,
      contextWindow: entry.contextWindow ?? undefined,
      maxOutputTokens: entry.maxOutputTokens ?? undefined,
      source: 'seed',
    });
  }

  if (snapshots.length > 0) {
    await prisma.modelPricingSnapshot.createMany({ data: snapshots });
    logger.info('Seeded pricing table from pricetoken', { count: snapshots.length });
  }
}

/** Filter pricing to models known by the registry or pricetoken catalog. */
export function filterToKnownModels(extracted: ExtractedModelPricing[]): ExtractedModelPricing[] {
  return extracted.filter((m) => getPricetokenModelInfo(m.modelId) !== null);
}
