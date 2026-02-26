import { prisma } from './prisma';
import { notificationQueue, addJob, JobType } from './queue';
import { logger } from './logger';

const REFERRAL_BONUS_CAP = 5;
const REFERRAL_BONUS_DAYS = 7;

/**
 * How many bonus daily generations a user earns from verified referrals.
 * +1 per verified referral from the last REFERRAL_BONUS_DAYS days, capped at REFERRAL_BONUS_CAP.
 */
export function getReferralBonus(activeReferralCount: number): number {
  return Math.min(activeReferralCount, REFERRAL_BONUS_CAP);
}

/**
 * Count verified referrals for a user within the bonus window (last 7 days).
 * Only referrals where the referred user created their first podcast count.
 */
export async function getActiveReferralCount(referrerId: string): Promise<number> {
  const cutoff = new Date(Date.now() - REFERRAL_BONUS_DAYS * 24 * 60 * 60 * 1000);
  return prisma.user.count({
    where: {
      referredById: referrerId,
      referralVerified: true,
      referralVerifiedAt: { gte: cutoff },
    },
  });
}

/**
 * Attribute a referral: link the new user to their referrer.
 * Does NOT grant bonus or notify — that happens when the referred user
 * creates their first podcast (see verifyReferral).
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
 * Verify a referral: called when a referred user's first podcast reaches READY.
 * Marks the referral as verified and notifies the referrer with their bonus.
 *
 * Returns true if verification succeeded, false if skipped (no referrer,
 * already verified, or not actually their first podcast).
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

  // Confirm this is truly their first READY podcast
  const readyCount = await prisma.podcast.count({
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
    title: 'Referral bonus earned!',
    message: `${referredName} created their first podcast on Sotto! You get +1 daily generation for 7 days.`,
    data: { referredUserId: userId },
  }).catch((err) => {
    logger.warn('Failed to queue referral notification', {
      referrerId: user.referredById!,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return true;
}
