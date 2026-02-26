import { prisma } from './prisma';
import { notificationQueue, addJob, JobType } from './queue';
import { logger } from './logger';

const REFERRAL_BONUS_CAP = 5;

/**
 * How many bonus daily generations a user earns from referrals.
 * +1 per referral, capped at REFERRAL_BONUS_CAP.
 */
export function getReferralBonus(referralCount: number): number {
  return Math.min(referralCount, REFERRAL_BONUS_CAP);
}

/**
 * Attribute a referral: link the new user to their referrer, increment
 * the referrer's denormalized referralCount, and notify the referrer.
 *
 * Returns true if attribution succeeded, false if skipped (already referred,
 * self-referral, or referrer not found).
 */
export async function attributeReferral(
  userId: string,
  referrerHandle: string
): Promise<boolean> {
  const handle = referrerHandle.toLowerCase();

  const [currentUser, referrer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true, handle: true },
    }),
    prisma.user.findFirst({
      where: { handle },
      select: { id: true, name: true },
    }),
  ]);

  if (!currentUser || !referrer) return false;
  if (currentUser.referredById) return false;
  if (referrer.id === userId) return false;

  // Attribute + increment referrer count in a transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { referredById: referrer.id },
    }),
    prisma.user.update({
      where: { id: referrer.id },
      data: { referralCount: { increment: 1 } },
    }),
  ]);

  // Notify the referrer (fire-and-forget via queue)
  const referredName = currentUser.handle || 'Someone';
  addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
    userId: referrer.id,
    type: 'REFERRAL_SIGNUP',
    title: 'New referral!',
    message: `${referredName} joined Sotto through your referral link. You earned +1 daily podcast generation!`,
    data: { referredUserId: userId },
  }).catch((err) => {
    logger.warn('Failed to queue referral notification', {
      referrerId: referrer.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return true;
}
