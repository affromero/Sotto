import { Job } from 'bullmq';
import type { FetchPricingPayload } from '@/lib/queue';
import { logger } from '@/lib/logger';
import {
  seedPricingFromRegistry,
  getAdminOverriddenModels,
  fetchProviderPricingPage,
  extractPricingFromPage,
  filterToKnownModels,
  savePricingSnapshots,
  PRICING_URLS,
} from '@/lib/pricing-fetcher';
import { refreshPricingFromDb } from '@/lib/pricing';

export async function processPricingFetch(job: Job<FetchPricingPayload>): Promise<void> {
  logger.info('Starting pricing fetch');
  job.updateProgress(5);

  // Seed from registry if table is empty (first run)
  await seedPricingFromRegistry();
  job.updateProgress(10);

  // Get admin-overridden models to skip
  const adminOverrides = await getAdminOverriddenModels();
  const providers = Object.keys(PRICING_URLS);
  let totalUpdated = 0;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const progressBase = 10 + (i / providers.length) * 80;

    try {
      logger.info('Fetching pricing page', { provider });
      const pageText = await fetchProviderPricingPage(provider);
      job.updateProgress(Math.round(progressBase + 20));

      const extracted = await extractPricingFromPage(provider, pageText);
      const known = filterToKnownModels(extracted);

      // Filter out admin-overridden models
      const toSave = known
        .filter((m) => !adminOverrides.has(m.modelId))
        .map((m) => ({
          modelId: m.modelId,
          provider,
          inputPerMTok: m.inputPerMTok,
          outputPerMTok: m.outputPerMTok,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          source: 'fetched',
        }));

      if (toSave.length > 0) {
        await savePricingSnapshots(toSave);
        totalUpdated += toSave.length;
      }

      logger.info('Provider pricing fetched', {
        provider,
        extracted: String(extracted.length),
        known: String(known.length),
        saved: String(toSave.length),
        skippedAdmin: String(known.length - toSave.length),
      });
    } catch (error) {
      logger.warn('Failed to fetch pricing for provider', {
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  job.updateProgress(90);

  // Refresh in-memory pricing map
  await refreshPricingFromDb();
  job.updateProgress(100);

  logger.info('Pricing fetch complete', { totalUpdated: String(totalUpdated) });
}
