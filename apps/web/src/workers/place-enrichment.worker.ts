import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  PlaceEnrichmentPayload,
  addJob,
  JobType,
  visualGenerationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { PlaceResolver, findHistoricalMaps } from '@sotto/maps/server';
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

  // Search Rumsey historical maps for places with historical context (yearHint or gazetteer period)
  let historicalMaps: Awaited<ReturnType<typeof findHistoricalMaps>> = [];
  const hasHistoricalContext = places.some((p) => p.yearHint) ||
    resolved.some((p) => p.historicalContext.length > 0);

  if (hasHistoricalContext && resolved.length > 0) {
    const primaryPlace = resolved[0].name;
    try {
      historicalMaps = (await Promise.race([
        findHistoricalMaps(primaryPlace, 3),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Rumsey timeout')), 10_000)),
      ])) ?? [];
      logger.info('Found historical maps', { segmentVisualId, count: String(historicalMaps.length) });
    } catch (err) {
      logger.warn('Rumsey historical map search failed, continuing without', {
        segmentVisualId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await job.updateProgress(60);

  // Merge enriched places into existing metadata (preserving preset and other fields)
  const visual = await prisma.segmentVisual.findUniqueOrThrow({
    where: { id: segmentVisualId },
    select: { visualType: true, prompt: true, metadata: true },
  });

  const existingMetadata = (visual.metadata as Record<string, unknown>) ?? {};
  const mergedMetadata: Record<string, unknown> = { ...existingMetadata, places: resolved };
  if (historicalMaps.length > 0) {
    mergedMetadata.historicalMaps = historicalMaps;
  }

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
