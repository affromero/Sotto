import { prisma } from './prisma';
import { stripe, PLATFORM_FEE_PERCENT } from './stripe';
import { logger } from './logger';

export interface VoicePricing {
  voiceCloneId: string;
  name: string;
  priceInCents: number | null;
  ownerName: string | null;
  ownerStripeAccountId: string | null;
  ownerStripeOnboarded: boolean;
}

export interface VoiceCharge {
  voiceCloneId: string;
  name: string;
  priceInCents: number;
  ownerName: string | null;
  platformFeeCents: number;
}

/**
 * Fetch pricing info for a voice clone.
 */
export async function getVoicePricing(voiceCloneId: string): Promise<VoicePricing | null> {
  const voice = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: {
      id: true,
      name: true,
      priceInCents: true,
      user: {
        select: {
          name: true,
          stripeAccountId: true,
          stripeOnboarded: true,
        },
      },
    },
  });

  if (!voice) return null;

  return {
    voiceCloneId: voice.id,
    name: voice.name,
    priceInCents: voice.priceInCents,
    ownerName: voice.user.name,
    ownerStripeAccountId: voice.user.stripeAccountId,
    ownerStripeOnboarded: voice.user.stripeOnboarded,
  };
}

/**
 * Look up a VoiceClone by its external voice ID.
 */
export async function findVoiceCloneByExternalId(externalVoiceId: string) {
  const clone = await prisma.voiceClone.findFirst({
    where: { externalVoiceId },
    select: {
      id: true,
      name: true,
      userId: true,
      priceInCents: true,
      verificationStatus: true,
      user: {
        select: {
          name: true,
          stripeAccountId: true,
          stripeOnboarded: true,
        },
      },
    },
  });

  if (clone && clone.verificationStatus !== 'VERIFIED' && clone.verificationStatus !== 'ADMIN_VERIFIED') {
    throw new Error('Voice clone is not verified');
  }

  return clone;
}

/**
 * Check if a user has free access to a voice (owner, allowlisted, or approved request).
 */
export async function checkFreeAccess(userId: string, voiceCloneId: string): Promise<boolean> {
  const voice = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { userId: true },
  });

  // Owner always has free access
  if (voice?.userId === userId) return true;

  // Check allowlist
  const allowlisted = await prisma.voiceAllowlist.findUnique({
    where: { voiceCloneId_allowedUserId: { voiceCloneId, allowedUserId: userId } },
  });
  if (allowlisted) return true;

  // Check approved request
  const approvedRequest = await prisma.voiceRequest.findUnique({
    where: { requesterId_voiceCloneId: { requesterId: userId, voiceCloneId } },
    select: { status: true },
  });
  if (approvedRequest?.status === 'APPROVED') return true;

  // Check if user already purchased for any podcast (lifetime access)
  const existingPurchase = await prisma.voicePurchase.findFirst({
    where: { buyerId: userId, voiceCloneId, status: { in: ['authorized', 'captured'] } },
  });
  if (existingPurchase) return true;

  return false;
}

/**
 * Create a Stripe PaymentIntent with manual capture for a voice purchase.
 * Uses Stripe Connect's destination charges so voice owner receives funds minus platform fee.
 */
export async function createVoicePayment(
  buyerId: string,
  voiceCloneId: string,
  podcastId: string
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  if (!stripe) throw new Error('Stripe is not configured');

  const voice = await prisma.voiceClone.findUniqueOrThrow({
    where: { id: voiceCloneId },
    select: {
      priceInCents: true,
      name: true,
      user: { select: { stripeAccountId: true, stripeOnboarded: true } },
    },
  });

  if (!voice.priceInCents || voice.priceInCents <= 0) {
    throw new Error('Voice is free — no payment needed');
  }

  if (!voice.user.stripeAccountId || !voice.user.stripeOnboarded) {
    throw new Error('Voice owner has not connected Stripe');
  }

  const platformFeeCents = Math.round(voice.priceInCents * (PLATFORM_FEE_PERCENT / 100));

  const paymentIntent = await stripe.paymentIntents.create({
    amount: voice.priceInCents,
    currency: 'usd',
    capture_method: 'manual',
    application_fee_amount: platformFeeCents,
    transfer_data: {
      destination: voice.user.stripeAccountId,
    },
    metadata: {
      buyerId,
      voiceCloneId,
      podcastId,
      voiceName: voice.name,
    },
  });

  // Track the purchase
  await prisma.voicePurchase.create({
    data: {
      buyerId,
      voiceCloneId,
      podcastId,
      amountCents: voice.priceInCents,
      platformFeeCents,
      stripePaymentIntent: paymentIntent.id,
      status: 'authorized',
    },
  });

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  };
}

/**
 * Capture an authorized PaymentIntent on successful generation.
 */
export async function captureVoicePayment(paymentIntentId: string): Promise<void> {
  if (!stripe) return;

  try {
    await stripe.paymentIntents.capture(paymentIntentId);
    await prisma.voicePurchase.update({
      where: { stripePaymentIntent: paymentIntentId },
      data: { status: 'captured' },
    });
    logger.info('Voice payment captured', { paymentIntentId });
  } catch (err) {
    logger.error('Failed to capture voice payment', {
      paymentIntentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Cancel an authorized PaymentIntent on failed generation.
 */
export async function cancelVoicePayment(paymentIntentId: string): Promise<void> {
  if (!stripe) return;

  try {
    await stripe.paymentIntents.cancel(paymentIntentId);
    await prisma.voicePurchase.update({
      where: { stripePaymentIntent: paymentIntentId },
      data: { status: 'cancelled' },
    });
    logger.info('Voice payment cancelled', { paymentIntentId });
  } catch (err) {
    logger.error('Failed to cancel voice payment', {
      paymentIntentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Cancel all authorized (uncaptured) payments for a podcast.
 * Called when a podcast generation fails.
 */
export async function cancelPodcastPayments(podcastId: string): Promise<void> {
  const purchases = await prisma.voicePurchase.findMany({
    where: { podcastId, status: 'authorized' },
    select: { stripePaymentIntent: true },
  });

  await Promise.all(purchases.map((p) => cancelVoicePayment(p.stripePaymentIntent)));
}

/**
 * Capture all authorized payments for a podcast.
 * Called when a podcast reaches READY status.
 */
export async function capturePodcastPayments(podcastId: string): Promise<void> {
  const purchases = await prisma.voicePurchase.findMany({
    where: { podcastId, status: 'authorized' },
    select: { stripePaymentIntent: true },
  });

  await Promise.all(purchases.map((p) => captureVoicePayment(p.stripePaymentIntent)));
}

/**
 * Compute the list of voice charges needed for a podcast's voice selection.
 * Returns empty array if all voices are free or user has access.
 */
export async function computeVoiceCharges(
  userId: string,
  hostVoiceId?: string,
  expertVoiceId?: string
): Promise<VoiceCharge[]> {
  const charges: VoiceCharge[] = [];
  const voiceIds = [hostVoiceId, expertVoiceId].filter(Boolean) as string[];

  for (const externalVoiceId of voiceIds) {
    const voice = await findVoiceCloneByExternalId(externalVoiceId);
    if (!voice || !voice.priceInCents || voice.priceInCents <= 0) continue;

    const hasFreeAccess = await checkFreeAccess(userId, voice.id);
    if (hasFreeAccess) continue;

    const platformFeeCents = Math.round(voice.priceInCents * (PLATFORM_FEE_PERCENT / 100));
    charges.push({
      voiceCloneId: voice.id,
      name: voice.name,
      priceInCents: voice.priceInCents,
      ownerName: voice.user.name,
      platformFeeCents,
    });
  }

  return charges;
}
