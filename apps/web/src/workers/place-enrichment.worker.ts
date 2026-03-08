import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  PlaceEnrichmentPayload,
  addJob,
  JobType,
  visualGenerationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { PlaceResolver } from '@sotto/maps/server';
import { logger } from '@/lib/logger';

export async function processPlaceEnrichment(job: Job<PlaceEnrichmentPayload>): Promise<void> {
  const { segmentVisualId, podcastId, videoGenerationId, places } = job.data;

  logger.info('Starting place enrichment', { segmentVisualId, placeCount: String(places.length) });

  const resolver = new PlaceResolver({ redisUrl: process.env.REDIS_URL });
  await job.updateProgress(10);

  // Resolve all places — use resolveHistorical when yearHint is present for better gazetteer ordering
  const enriched = await Promise.all(
    places.map((p) =>
      p.yearHint
        ? resolver.resolveHistorical(p.name, p.yearHint)
        : resolver.resolve(p.name),
    ),
  );

  const resolved = enriched.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => ({
    name: p.name,
    aliases: p.aliases,
    coordinates: p.coordinates,
    modernRegion: p.modernRegion,
    historicalContext: p.historicalContext ?? [],
    source: p.source,
    sourceId: p.sourceId ?? null,
    confidence: p.confidence,
  }));

  await job.updateProgress(50);

  if (resolved.length === 0) {
    logger.warn('No places resolved, visual-generation will fall back to AI illustration', { segmentVisualId });
  }

  // Merge enriched places into existing metadata (preserving preset and other fields)
  const visual = await prisma.segmentVisual.findUniqueOrThrow({
    where: { id: segmentVisualId },
    select: { visualType: true, prompt: true, metadata: true },
  });

  const existingMetadata = (visual.metadata as Record<string, unknown>) ?? {};
  const mergedMetadata = { ...existingMetadata, places: resolved };

  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: {
      metadata: mergedMetadata as unknown as Prisma.InputJsonValue,
    },
  });

  await job.updateProgress(80);

  // Queue visual-generation to produce the map image (or AI illustration fallback)
  await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
    podcastId,
    videoGenerationId,
    segmentVisualId,
    visualType: visual.visualType,
    prompt: visual.prompt ?? '',
    metadata: mergedMetadata,
  });

  await job.updateProgress(100);
  logger.info('Place enrichment complete', { segmentVisualId, resolved: String(resolved.length) });
}
