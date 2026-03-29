/**
 * One-time migration: copies User.briefing* fields into UserBriefing rows.
 *
 * Run:  npx tsx apps/web/prisma/migrate-briefings.ts
 *
 * Safe to re-run — skips users who already have a UserBriefing row.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function computeNextRunAt(
  time: string,
  timezone: string,
  days: number,
  after: Date = new Date(),
): Date | null {
  if (days === 0) return null;
  const [hh, mm] = time.split(':').map(Number);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(after.getTime() + offset * 24 * 60 * 60 * 1000);
    const inTz = new Date(candidate.toLocaleString('en-US', { timeZone: timezone }));
    const dayIndex = inTz.getDay(); // 0=Sun
    const bitmask = dayIndex === 0 ? 64 : 1 << (dayIndex - 1);

    if ((days & bitmask) === 0) continue;

    // Build target time in the user's timezone for this candidate date
    const year = inTz.getFullYear();
    const month = String(inTz.getMonth() + 1).padStart(2, '0');
    const day = String(inTz.getDate()).padStart(2, '0');
    const targetStr = `${year}-${month}-${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

    // Create a Date in the user's timezone by parsing the localized string
    const targetInTz = new Date(
      new Date(targetStr).toLocaleString('en-US', { timeZone: timezone }),
    );

    // Convert back to UTC for storage
    const diff = new Date(targetStr).getTime() - targetInTz.getTime();
    const utcTarget = new Date(new Date(targetStr).getTime() + diff);

    if (offset === 0 && utcTarget <= after) continue; // already passed today
    return utcTarget;
  }
  return null;
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      briefingEnabled: true,
      briefingTime: { not: null },
      briefingTimezone: { not: null },
    },
    select: {
      id: true,
      briefingTime: true,
      briefingTimezone: true,
      briefingDays: true,
      briefingVisibility: true,
      lastBriefingAt: true,
      briefingAiModel: true,
      briefingTtsProvider: true,
      briefingTtsModel: true,
      briefingHostVoiceId: true,
      briefingExpertVoiceId: true,
      briefingDepth: true,
      briefingTone: true,
      briefingAudienceLevel: true,
      briefingDuration: true,
      briefingFormat: true,
      briefingPrompt: true,
      briefingUseByokKeys: true,
      userBriefings: { select: { id: true }, take: 1 },
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    // Skip if already migrated
    if (user.userBriefings.length > 0) {
      skipped++;
      continue;
    }

    const nextRunAt = computeNextRunAt(
      user.briefingTime!,
      user.briefingTimezone!,
      user.briefingDays,
    );

    const briefing = await prisma.userBriefing.create({
      data: {
        userId: user.id,
        name: 'Daily Briefing',
        enabled: true,
        time: user.briefingTime!,
        timezone: user.briefingTimezone!,
        days: user.briefingDays,
        nextRunAt,
        prompt: user.briefingPrompt,
        depth: user.briefingDepth,
        tone: user.briefingTone,
        audienceLevel: user.briefingAudienceLevel,
        duration: user.briefingDuration,
        format: user.briefingFormat,
        aiModel: user.briefingAiModel,
        ttsProvider: user.briefingTtsProvider,
        ttsModel: user.briefingTtsModel,
        hostVoiceId: user.briefingHostVoiceId,
        expertVoiceId: user.briefingExpertVoiceId,
        visibility: user.briefingVisibility,
        useByokKeys: user.briefingUseByokKeys,
        lastGeneratedAt: user.lastBriefingAt,
      },
    });

    // Link existing BriefingLog rows to the new UserBriefing
    await prisma.briefingLog.updateMany({
      where: { userId: user.id, userBriefingId: null },
      data: { userBriefingId: briefing.id },
    });

    migrated++;
  }

  console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped (already had UserBriefing)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
