/**
 * Admin pricing queries — current model pricing with metadata,
 * price history over time, and last fetch timestamp.
 */
import { prisma } from './prisma';
import { getAiModelDisplayName, getProviderForModel, getModelContextWindow, getModelMaxOutputTokens } from './providers/ai-registry';
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
  const latestSnapshots = await prisma.$queryRaw<
    Array<{ modelId: string; lastUpdated: Date }>
  >`
    SELECT DISTINCT ON ("modelId") "modelId", "createdAt" AS "lastUpdated"
    FROM "ModelPricingSnapshot"
    ORDER BY "modelId", "createdAt" DESC
  `;
  const lastUpdatedMap = new Map(latestSnapshots.map((s) => [s.modelId, s.lastUpdated]));

  const rows: ModelPricingRow[] = current.map((m) => ({
    modelId: m.modelId,
    displayName: getAiModelDisplayName(m.modelId),
    provider: getProviderForModel(m.modelId) ?? 'unknown',
    inputPerMTok: m.inputPerMTok,
    outputPerMTok: m.outputPerMTok,
    contextWindow: getModelContextWindow(m.modelId),
    maxOutputTokens: getModelMaxOutputTokens(m.modelId),
    source: m.source,
    lastUpdated: lastUpdatedMap.get(m.modelId) ?? null,
  }));

  // Sort by provider, then model name
  rows.sort((a, b) => a.provider.localeCompare(b.provider) || a.displayName.localeCompare(b.displayName));
  return rows;
}

export interface PriceHistoryPoint {
  date: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Get price history for all models over a given number of days. */
export async function getModelPriceHistory(
  days: number = 30
): Promise<Map<string, PriceHistoryPoint[]>> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const snapshots = await prisma.modelPricingSnapshot.findMany({
    where: { createdAt: { gte: since } },
    select: { modelId: true, inputPerMTok: true, outputPerMTok: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const map = new Map<string, PriceHistoryPoint[]>();
  for (const s of snapshots) {
    const dateKey = s.createdAt.toISOString().split('T')[0];
    if (!map.has(s.modelId)) map.set(s.modelId, []);
    map.get(s.modelId)!.push({
      date: dateKey,
      inputPerMTok: s.inputPerMTok,
      outputPerMTok: s.outputPerMTok,
    });
  }
  return map;
}

/** Get the most recent fetch timestamp (source='fetched'). */
export async function getLastFetchTime(): Promise<Date | null> {
  const latest = await prisma.modelPricingSnapshot.findFirst({
    where: { source: 'fetched' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return latest?.createdAt ?? null;
}
