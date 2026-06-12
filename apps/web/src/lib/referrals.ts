import { prisma } from './prisma';
import { notificationQueue, addJob, JobType } from './queue';
import { logger } from './logger';

/**
 * Attribute a referral: link the new user to their referrer.
 * Does NOT verify or notify — that happens when the referred user
 * creates their first episode (see verifyReferral).
 *
 * Returns true if attribution succeeded, false if skipped.
 */
export async function attributeReferral(
  userId: string,
  referrerHandle: string
): Promise<boolean> {
  const handle = referrerHandle.toLowerCase();

  const [currentUser, referrer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true },
    }),
    prisma.user.findFirst({
      where: { handle },
      select: { id: true },
    }),
  ]);

  if (!currentUser || !referrer) return false;
  if (currentUser.referredById) return false;
  if (referrer.id === userId) return false;

  await prisma.user.update({
    where: { id: userId },
    data: { referredById: referrer.id },
  });

  return true;
}

/**
 * Verify a referral: called when a referred user's first episode reaches READY.
 * Marks the referral as verified and notifies the referrer.
 *
 * Returns true if verification succeeded, false if skipped (no referrer,
 * already verified, or not actually their first episode).
 */
export async function verifyReferral(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      referredById: true,
      referralVerified: true,
      handle: true,
      name: true,
    },
  });

  if (!user?.referredById) return false;
  if (user.referralVerified) return false;

  // Confirm this is truly their first READY episode
  const readyCount = await prisma.episode.count({
    where: { userId, status: 'READY' },
  });
  if (readyCount !== 1) return false;

  await prisma.user.update({
    where: { id: userId },
    data: {
      referralVerified: true,
      referralVerifiedAt: new Date(),
    },
  });

  // Notify the referrer
  const referredName = user.handle || user.name || 'Someone';
  addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
    userId: user.referredById,
    type: 'REFERRAL_SIGNUP',
    title: 'Referral joined Sotto',
    message: `${referredName} created their first lesson on Sotto.`,
    data: { referredUserId: userId },
  }).catch((err) => {
    logger.warn('Failed to queue referral notification', {
      referrerId: user.referredById!,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return true;
}
