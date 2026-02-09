/**
 * Generate (podcast_features, quality_label) pairs from aggregate engagement.
 *
 * Output: JSONL file with schema:
 *   { podcastId, features: {...}, qualityLabel }
 *
 * Quality labels:
 *   - excellent: avgCompletionRate >= 80%, likeToListenRatio >= 0.3
 *   - good: avgCompletionRate >= 60%
 *   - average: avgCompletionRate >= 40%
 *   - poor: avgCompletionRate < 40%
 *
 * Usage: npx ts-node scripts/ml/prepare-quality-training.ts > data/quality-training.jsonl
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const features = await prisma.podcastFeature.findMany({
    where: { totalUniqueListeners: { gte: 5 } }, // Only podcasts with enough data
    include: {
      podcast: {
        select: {
          id: true,
          title: true,
          duration: true,
          tags: { include: { tag: { select: { name: true } } } },
        },
      },
    },
  });

  for (const f of features) {
    const label =
      f.avgCompletionRate >= 80 && f.likeToListenRatio >= 0.3
        ? 'excellent'
        : f.avgCompletionRate >= 60
          ? 'good'
          : f.avgCompletionRate >= 40
            ? 'average'
            : 'poor';

    const record = {
      podcastId: f.podcastId,
      features: {
        avgCompletionRate: f.avgCompletionRate,
        medianCompletionRate: f.medianCompletionRate,
        totalUniqueListeners: f.totalUniqueListeners,
        totalListenMinutes: f.totalListenMinutes,
        likeToListenRatio: f.likeToListenRatio,
        saveToListenRatio: f.saveToListenRatio,
        forkToListenRatio: f.forkToListenRatio,
        interactionRate: f.interactionRate,
        relistenRate: f.relistenRate,
        avgListenSpeed: f.avgListenSpeed,
        segmentCount: f.segmentCount,
        durationSeconds: f.durationSeconds,
        referenceCount: f.referenceCount,
        verifiedReferenceRate: f.verifiedReferenceRate,
        questionThenAbandonRate: f.questionThenAbandonRate,
      },
      tags: f.podcast.tags.map((pt: { tag: { name: string } }) => pt.tag.name),
      durationMinutes: (f.podcast.duration || 0) / 60,
      qualityLabel: label,
    };

    process.stdout.write(JSON.stringify(record) + '\n');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
