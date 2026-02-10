/**
 * Migration script: Move User.elevenLabsApiKey → UserTtsKey rows.
 *
 * Reads all users with a non-null elevenLabsApiKey, creates a
 * corresponding UserTtsKey record with provider='elevenlabs', and
 * leaves the old column intact for backward compatibility.
 *
 * Usage: npx tsx prisma/migrate-byok-keys.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { elevenLabsApiKey: { not: null } },
    select: { id: true, elevenLabsApiKey: true },
  });

  console.warn(`Found ${users.length} user(s) with existing BYOK keys`);

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.elevenLabsApiKey) continue;

    const existing = await prisma.userTtsKey.findUnique({
      where: { userId_provider: { userId: user.id, provider: 'elevenlabs' } },
    });

    if (existing) {
      console.warn(`  Skipping user ${user.id} — already has UserTtsKey for elevenlabs`);
      skipped++;
      continue;
    }

    await prisma.userTtsKey.create({
      data: {
        userId: user.id,
        provider: 'elevenlabs',
        encryptedKey: user.elevenLabsApiKey,
        isValid: true,
        label: 'ElevenLabs (migrated)',
      },
    });

    migrated++;
    console.warn(`  Migrated user ${user.id}`);
  }

  console.warn(`\nDone: ${migrated} migrated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
