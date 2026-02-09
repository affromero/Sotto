/**
 * Generate (text, label) pairs for domain-specific embedding fine-tuning.
 *
 * Creates pairs of podcast descriptions that should be close (similar topics/engagement)
 * or far apart (different topics) in embedding space.
 *
 * Output: JSONL file with schema:
 *   { anchor, positive, negative }
 *
 * Usage: npx ts-node scripts/ml/prepare-embedding-training.ts > data/embedding-training.jsonl
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const podcasts = await prisma.podcast.findMany({
    where: { status: 'READY', visibility: 'PUBLIC' },
    select: {
      id: true,
      title: true,
      topic: true,
      tags: { include: { tag: { select: { id: true, name: true } } } },
    },
  });

  if (podcasts.length < 3) {
    console.error('Need at least 3 podcasts to generate training triplets');
    process.exit(1);
  }

  // Group podcasts by primary tag
  const byTag = new Map<string, typeof podcasts>();
  for (const p of podcasts) {
    const primaryTag = p.tags[0]?.tag.id || 'none';
    if (!byTag.has(primaryTag)) byTag.set(primaryTag, []);
    byTag.get(primaryTag)!.push(p);
  }

  const tagGroups = Array.from(byTag.entries()).filter(([, group]) => group.length >= 2);

  for (const [tagId, group] of tagGroups) {
    // For each pair in the same tag group, create a triplet
    for (let i = 0; i < group.length - 1; i++) {
      const anchor = group[i];
      const positive = group[i + 1];

      // Find a negative from a different tag group
      const otherGroups = tagGroups.filter(([id]) => id !== tagId);
      if (otherGroups.length === 0) continue;

      const randomGroup = otherGroups[Math.floor(Math.random() * otherGroups.length)][1];
      const negative = randomGroup[Math.floor(Math.random() * randomGroup.length)];

      const record = {
        anchor: `${anchor.title}. ${anchor.topic}`,
        positive: `${positive.title}. ${positive.topic}`,
        negative: `${negative.title}. ${negative.topic}`,
        anchorTags: anchor.tags.map((t) => t.tag.name),
        positiveTags: positive.tags.map((t) => t.tag.name),
        negativeTags: negative.tags.map((t) => t.tag.name),
      };

      process.stdout.write(JSON.stringify(record) + '\n');
    }
  }

  // Also generate pairs based on co-listening (users who completed both)
  const coListenPairs = await prisma.$queryRaw<
    Array<{ podcast_a: string; podcast_b: string; shared_listeners: bigint }>
  >`
    SELECT a."podcastId" as podcast_a, b."podcastId" as podcast_b, COUNT(DISTINCT a."userId") as shared_listeners
    FROM "PlaybackSession" a
    JOIN "PlaybackSession" b ON a."userId" = b."userId" AND a."podcastId" != b."podcastId"
    WHERE a."completionPercent" >= 50 AND b."completionPercent" >= 50
    AND a."userId" IS NOT NULL
    GROUP BY a."podcastId", b."podcastId"
    HAVING COUNT(DISTINCT a."userId") >= 3
    ORDER BY shared_listeners DESC
    LIMIT 1000
  `;

  const podcastMap = new Map(podcasts.map((p) => [p.id, p]));

  for (const pair of coListenPairs) {
    const a = podcastMap.get(pair.podcast_a);
    const b = podcastMap.get(pair.podcast_b);
    if (!a || !b) continue;

    // Find a negative that no shared listener completed
    const randomPodcast = podcasts[Math.floor(Math.random() * podcasts.length)];
    if (randomPodcast.id === a.id || randomPodcast.id === b.id) continue;

    const record = {
      anchor: `${a.title}. ${a.topic}`,
      positive: `${b.title}. ${b.topic}`,
      negative: `${randomPodcast.title}. ${randomPodcast.topic}`,
      source: 'co-listen',
      sharedListeners: Number(pair.shared_listeners),
    };

    process.stdout.write(JSON.stringify(record) + '\n');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
