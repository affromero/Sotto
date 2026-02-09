/**
 * Generate (user, podcast, label) training triples from PlaybackSession completion + like/save.
 *
 * Output: JSONL file with schema:
 *   { userId, podcastId, completionPercent, liked, saved, forked, engagementLabel, signals }
 *
 * Usage: npx ts-node scripts/ml/prepare-recommendation-training.ts > data/recommendation-training.jsonl
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH_SIZE = 500;

async function main() {
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const sessions = await prisma.playbackSession.findMany({
      where: { userId: { not: null } },
      skip,
      take: BATCH_SIZE,
      orderBy: { startedAt: 'asc' },
      include: {
        podcast: {
          select: {
            id: true,
            tags: { include: { tag: { select: { id: true, name: true } } } },
          },
        },
      },
    });

    for (const session of sessions) {
      if (!session.userId) continue;

      const [liked, saved, forked] = await Promise.all([
        prisma.like.findUnique({
          where: { userId_podcastId: { userId: session.userId, podcastId: session.podcastId } },
        }),
        prisma.save.findUnique({
          where: { userId_podcastId: { userId: session.userId, podcastId: session.podcastId } },
        }),
        prisma.podcast.findFirst({
          where: { userId: session.userId, forkedFromId: session.podcastId },
        }),
      ]);

      // Multi-label engagement
      const label =
        session.completionPercent >= 80
          ? 'strong_positive'
          : session.completionPercent >= 50
            ? 'positive'
            : session.completionPercent >= 20
              ? 'weak'
              : 'negative';

      const record = {
        userId: session.userId,
        podcastId: session.podcastId,
        completionPercent: session.completionPercent,
        totalListenSeconds: session.totalListenSeconds,
        pauseCount: session.pauseCount,
        seekCount: session.seekCount,
        speedChanges: session.speedChanges,
        lastSpeed: session.lastSpeed,
        interruptCount: session.interruptCount,
        liked: !!liked,
        saved: !!saved,
        forked: !!forked,
        engagementLabel: label,
        tags: session.podcast.tags.map((pt: { tag: { name: string } }) => pt.tag.name),
      };

      process.stdout.write(JSON.stringify(record) + '\n');
    }

    skip += BATCH_SIZE;
    hasMore = sessions.length === BATCH_SIZE;
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
