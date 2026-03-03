import { Job } from 'bullmq';
import type { CollectR2UsagePayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { isR2MonitoringConfigured, fetchR2UsageData } from '@/lib/cloudflare-r2-usage';
import { listPrefixes, listObjectsDetailed } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processR2Usage(job: Job<CollectR2UsagePayload>): Promise<void> {
  if (!isR2MonitoringConfigured()) {
    logger.info('R2 monitoring not configured, skipping collection');
    return;
  }

  const bucket = process.env.R2_BUCKET_NAME || 'sotto-storage';

  logger.info('Collecting R2 usage data', { bucket });
  job.updateProgress(10);

  const { usage, ops, costs } = await fetchR2UsageData(bucket);

  job.updateProgress(60);

  // Compute prefix breakdown (graceful degradation if R2 listing fails)
  let prefixBreakdown: Array<{ prefix: string; fileCount: number; totalBytes: number }> | null = null;
  try {
    const prefixes = await listPrefixes();
    const settled = await Promise.allSettled(
      prefixes.map(async ({ prefix }) => {
        const objects = await listObjectsDetailed(prefix);
        return {
          prefix,
          fileCount: objects.length,
          totalBytes: objects.reduce((sum, o) => sum + o.sizeBytes, 0),
        };
      })
    );
    prefixBreakdown = settled
      .filter((r): r is PromiseFulfilledResult<{ prefix: string; fileCount: number; totalBytes: number }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => b.totalBytes - a.totalBytes);
  } catch (err) {
    logger.warn('Failed to compute prefix breakdown — saving snapshot without it', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  job.updateProgress(80);

  await prisma.r2UsageSnapshot.create({
    data: {
      bucket,
      payloadSizeBytes: usage.payloadSizeBytes,
      metadataSizeBytes: usage.metadataSizeBytes,
      objectCount: usage.objectCount,
      uploadCount: usage.uploadCount,
      classAOps: ops.classAOps,
      classBOps: ops.classBOps,
      freeOps: ops.freeOps,
      storageCostEstimate: costs.storageCostEstimate,
      classACostEstimate: costs.classACostEstimate,
      classBCostEstimate: costs.classBCostEstimate,
      totalCostEstimate: costs.totalCostEstimate,
      prefixBreakdown: prefixBreakdown ?? undefined,
    },
  });

  // Prune snapshots older than 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const r2Pruned = await prisma.r2UsageSnapshot.deleteMany({
    where: { createdAt: { lt: ninetyDaysAgo } },
  });
  if (r2Pruned.count > 0) {
    logger.info('Pruned old R2 usage snapshots', { count: String(r2Pruned.count) });
  }

  const pricingPruned = await prisma.modelPricingSnapshot.deleteMany({
    where: { createdAt: { lt: ninetyDaysAgo } },
  });
  if (pricingPruned.count > 0) {
    logger.info('Pruned old model pricing snapshots', { count: String(pricingPruned.count) });
  }

  job.updateProgress(100);

  logger.info('R2 usage snapshot saved', {
    bucket,
    payloadSizeBytes: String(usage.payloadSizeBytes),
    objectCount: String(usage.objectCount),
    totalCostEstimate: costs.totalCostEstimate.toFixed(4),
    prefixCount: String(prefixBreakdown?.length ?? 0),
  });
}
