import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { PlaceEnrichmentPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { PlaceResolver } from '@sotto/maps';
import { logger } from '@/lib/logger';

export async function processPlaceEnrichment(job: Job<PlaceEnrichmentPayload>): Promise<void> {
  const { segmentVisualId, places } = job.data;

  const resolver = new PlaceResolver({ redisUrl: process.env.REDIS_URL });
  await job.updateProgress(10);

  const enriched = await Promise.all(
    places.map((p) => resolver.resolve(p.name, { yearHint: p.yearHint })),
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

  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: {
      metadata: { places: resolved } as unknown as Prisma.InputJsonValue,
    },
  });

  await job.updateProgress(100);
  logger.info('Place enrichment complete', { segmentVisualId, resolved: resolved.length });
}
