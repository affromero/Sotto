import { Job } from 'bullmq';
import type { FetchPricingPayload } from '@/lib/queue';
import { logger } from '@/lib/logger';
import {
  seedPricingFromRegistry,
  getAdminOverriddenModels,
  fetchPricingFromPricetoken,
  savePricingSnapshots,
} from '@/lib/pricing-fetcher';
import { getPricetokenModelInfo } from '@/lib/providers/ai-registry';
import { refreshPricingFromDb } from '@/lib/pricing';

export async function processPricingFetch(job: Job<FetchPricingPayload>): Promise<void> {
  logger.info('Starting pricing fetch via pricetoken API');
  job.updateProgress(5);

  // Seed from pricetoken static data if table is empty (first run)
  await seedPricingFromRegistry();
  job.updateProgress(10);

  // Get admin-overridden models to skip
  const adminOverrides = await getAdminOverriddenModels();
  let totalUpdated = 0;

  try {
    const fetched = await fetchPricingFromPricetoken();
    job.updateProgress(60);

    // Filter out admin-overridden models, resolve provider from pricetoken catalog
    const toSave = fetched
      .filter((m) => !adminOverrides.has(m.modelId))
      .map((m) => {
        const ptInfo = getPricetokenModelInfo(m.modelId);
        return {
          modelId: m.modelId,
          provider: ptInfo?.provider ?? 'unknown',
          inputPerMTok: m.inputPerMTok,
          outputPerMTok: m.outputPerMTok,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          source: 'fetched',
        };
      });

    if (toSave.length > 0) {
      await savePricingSnapshots(toSave);
      totalUpdated = toSave.length;
    }

    logger.info('Pricetoken pricing fetched', {
      total: String(fetched.length),
      saved: String(toSave.length),
      skippedAdmin: String(fetched.length - toSave.length),
    });
  } catch (error) {
    logger.warn('Failed to fetch pricing from pricetoken API', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  job.updateProgress(90);

  // Refresh in-memory pricing map
  await refreshPricingFromDb();
  job.updateProgress(100);

  logger.info('Pricing fetch complete', { totalUpdated: String(totalUpdated) });
}
