/* eslint-disable no-console */
/**
 * Backfill slugs for all existing episodes that don't have one.
 *
 * Usage:
 *   npx tsx scripts/backfill-slugs.ts           # dry run (default)
 *   npx tsx scripts/backfill-slugs.ts --apply    # apply changes
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[&/]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

async function main() {
  const episodes = await prisma.episode.findMany({
    where: { slug: null },
    select: { id: true, title: true, userId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${episodes.length} episodes without slugs (${apply ? 'APPLY' : 'DRY RUN'})`);

  let updated = 0;
  let skipped = 0;

  for (const episode of episodes) {
    const base = slugify(episode.title);
    let slug = base;

    // Check for uniqueness per user
    const existing = await prisma.episode.findUnique({
      where: { userId_slug: { userId: episode.userId, slug } },
      select: { id: true },
    });

    if (existing) {
      // Find next available suffix
      let found = false;
      for (let i = 2; i < 100; i++) {
        const candidate = `${base}-${i}`;
        const taken = await prisma.episode.findUnique({
          where: { userId_slug: { userId: episode.userId, slug: candidate } },
          select: { id: true },
        });
        if (!taken) {
          slug = candidate;
          found = true;
          break;
        }
      }
      if (!found) {
        slug = `${base}-${Date.now()}`;
      }
    }

    console.log(`  ${episode.id} → "${slug}" (from "${episode.title}")`);

    if (apply) {
      await prisma.episode.update({
        where: { id: episode.id },
        data: { slug },
      });
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
  if (!apply && skipped > 0) {
    console.log('Run with --apply to persist changes');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
