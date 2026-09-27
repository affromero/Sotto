/**
 * Admin pricing queries — current model pricing with metadata,
 * price history over time, and last fetch timestamp.
 */
import { prisma } from './prisma';
import {
  getAiModelDisplayName,
  getProviderForModel,
  getModelContextWindow,
  getModelMaxOutputTokens,
  getPricetokenModelInfo,
} from './providers/ai-registry';
import { getAllCurrentPricing } from './pricing';

export interface ModelPricingRow {
  modelId: string;
  displayName: string;
  provider: string;
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  source: string;
  lastUpdated: Date | null;
}

/** Get current pricing for all models, enriched with registry metadata. */
export async function getCurrentModelPricing(): Promise<ModelPricingRow[]> {
  const current = await getAllCurrentPricing();

  // Get last update times from DB
  const latestSnapshots = await prisma.$queryRaw<Array<{ modelId: string; lastUpdated: Date }>>`
    SELECT DISTINCT ON ("modelId") "modelId", "createdAt" AS "lastUpdated"
    FROM "ModelPricingSnapshot"
    ORDER BY "modelId", "createdAt" DESC
  `;
  const lastUpdatedMap = new Map(latestSnapshots.map((s) => [s.modelId, s.lastUpdated]));

  const rows: ModelPricingRow[] = current.map((m) => {
    const ptInfo = getPricetokenModelInfo(m.modelId);
    return {
      modelId: m.modelId,
      displayName:
        getAiModelDisplayName(m.modelId) !== m.modelId
          ? getAiModelDisplayName(m.modelId)
          : (ptInfo?.displayName ?? m.modelId),
      provider: getProviderForModel(m.modelId) ?? ptInfo?.provider ?? 'unknown',
      inputPerMTok: m.inputPerMTok,
      outputPerMTok: m.outputPerMTok,
      contextWindow: getModelContextWindow(m.modelId) ?? ptInfo?.contextWindow ?? null,
      maxOutputTokens: getModelMaxOutputTokens(m.modelId) ?? ptInfo?.maxOutputTokens ?? null,
      source: m.source,
      lastUpdated: lastUpdatedMap.get(m.modelId) ?? null,
    };
  });

  // Sort by provider, then model name
  rows.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.displayName.localeCompare(b.displayName)
  );
  return rows;
}
