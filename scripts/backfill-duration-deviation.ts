/* eslint-disable no-console */
/**
 * Backfill durationDeviation for existing READY episodes.
 *
 * Computes deviation = episode.duration - discovery.durationTarget * 60
 * for every READY episode that has a duration but no durationDeviation yet.
 *
 * Usage:
 *   npx tsx scripts/backfill-duration-deviation.ts           # dry run (default)
 *   npx tsx scripts/backfill-duration-deviation.ts --apply    # apply changes
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    if (dryRun) {
      console.log('DRY RUN — no changes will be written. Pass --apply to write.\n');
    }

    const episodes = await prisma.episode.findMany({
      where: {
        status: 'READY',
        duration: { not: null },
        durationDeviation: null,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        duration: true,
        discovery: { select: { durationTarget: true } },
      },
    });

    console.log(`Found ${episodes.length} READY episodes without durationDeviation.\n`);

    let updated = 0;
    let skippedNoTarget = 0;

    for (const episode of episodes) {
      const target = episode.discovery?.durationTarget;
      if (!target) {
        skippedNoTarget++;
        continue;
      }

      const deviation = episode.duration! - target * 60;
      console.log(
        `${episode.title || episode.id}: ${episode.duration}s actual, ${target * 60}s target → ${deviation > 0 ? '+' : ''}${deviation}s deviation`
      );

      if (!dryRun) {
        await prisma.episode.update({
          where: { id: episode.id },
          data: { durationDeviation: deviation },
        });
      }

      updated++;
    }

    console.log(
      `\n${dryRun ? 'Would update' : 'Updated'} ${updated} episodes. Skipped ${skippedNoTarget} (no duration target).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
