/* eslint-disable no-console */
/**
 * Backfill TTS costs for BYOK-generated podcasts.
 *
 * Prior to the fix, ApiUsageLog rows created with BYOK keys had totalCost: 0.
 * This script recalculates costs using the provider's per-kchar rate and the
 * stored character count (inputTokens).
 *
 * Usage:
 *   npx tsx scripts/backfill-byok-costs.ts           # dry run (default)
 *   npx tsx scripts/backfill-byok-costs.ts --apply    # apply changes
 */

import { PrismaClient } from '@prisma/client';

const PROVIDER_RATES: Record<string, number> = {
  elevenlabs: 0.17,
  openai: 0.015,
  playht: 0.2,
  cartesia: 0.15,
  hume: 0.25,
};

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.apiUsageLog.findMany({
      where: {
        category: 'audio_generation',
        service: { endsWith: '_byok' },
        totalCost: 0,
      },
      select: {
        id: true,
        service: true,
        inputTokens: true,
      },
    });

    console.log(`Found ${rows.length} BYOK rows with totalCost: 0`);

    if (rows.length === 0) {
      console.log('Nothing to backfill.');
      return;
    }

    let updated = 0;
    let skipped = 0;
    let totalCostSum = 0;

    for (const row of rows) {
      // service is like "elevenlabs_byok" → extract provider id
      const providerId = row.service.replace('_byok', '');
      const rate = PROVIDER_RATES[providerId];

      if (!rate) {
        console.warn(`  Unknown provider "${providerId}" for row ${row.id}, skipping`);
        skipped++;
        continue;
      }

      const charCount = row.inputTokens ?? 0;
      if (charCount === 0) {
        skipped++;
        continue;
      }

      const totalCost = (charCount / 1000) * rate;
      totalCostSum += totalCost;

      if (dryRun) {
        console.log(`  [DRY RUN] ${row.id}: ${providerId}, ${charCount} chars → $${totalCost.toFixed(6)}`);
      } else {
        await prisma.apiUsageLog.update({
          where: { id: row.id },
          data: { totalCost },
        });
      }
      updated++;
    }

    console.log(`\n${dryRun ? '[DRY RUN] Would update' : 'Updated'}: ${updated} rows`);
    console.log(`Skipped: ${skipped} rows`);
    console.log(`Total cost backfilled: $${totalCostSum.toFixed(4)}`);

    if (dryRun) {
      console.log('\nRun with --apply to commit changes.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
