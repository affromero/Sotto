import { Job } from 'bullmq';
import type { CollectR2UsagePayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { isR2MonitoringConfigured, fetchR2UsageData } from '@/lib/cloudflare-r2-usage';
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
    },
  });

  job.updateProgress(100);

  logger.info('R2 usage snapshot saved', {
    bucket,
    payloadSizeBytes: String(usage.payloadSizeBytes),
    objectCount: String(usage.objectCount),
    totalCostEstimate: costs.totalCostEstimate.toFixed(4),
  });
}
