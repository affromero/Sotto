import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

/**
 * Stripe webhook handler.
 * Handles:
 * - account.updated (Connect onboarding)
 * - payment_intent.payment_failed (voice purchases)
 * - customer.subscription.created / updated / deleted (Pro tier)
 */
export async function POST(request: NextRequest) {
  if (!stripe) {
    return errorResponse('Stripe not configured', 503);
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return errorResponse('Missing signature', 400);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return errorResponse('Webhook secret not configured', 503);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse('Invalid signature', 400);
  }

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object;
      const onboarded = account.charges_enabled && account.payouts_enabled;

      await prisma.user.updateMany({
        where: { stripeAccountId: account.id },
        data: { stripeOnboarded: onboarded },
      });

      logger.info('Stripe account updated', {
        accountId: account.id,
        onboarded: String(onboarded),
      });
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      const purchase = await prisma.voicePurchase.findUnique({
        where: { stripePaymentIntent: paymentIntent.id },
      });

      if (purchase && purchase.status === 'authorized') {
        await prisma.voicePurchase.update({
          where: { id: purchase.id },
          data: { status: 'cancelled' },
        });
        logger.info('Voice payment failed', { paymentIntentId: paymentIntent.id });
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;

      if (!userId) {
        logger.warn('Subscription event missing userId metadata', { subscriptionId: sub.id });
        break;
      }

      const isActive = sub.status === 'active' || sub.status === 'trialing';
      const plan = isActive ? ('PRO' as const) : ('FREE' as const);

      const customerId =
        typeof sub.customer === 'string' ? sub.customer : (sub.customer as { id: string }).id;

      const itemPeriodEnd = sub.items.data[0]?.current_period_end;
      const currentPeriodEnd = itemPeriodEnd
        ? new Date(itemPeriodEnd * 1000)
        : new Date();
      const cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { plan },
        }),
        prisma.subscription.upsert({
          where: { userId },
          create: {
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: sub.items.data[0]?.price?.id ?? '',
            status: sub.status,
            currentPeriodEnd,
            cancelAtPeriodEnd,
          },
          update: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: sub.items.data[0]?.price?.id ?? '',
            status: sub.status,
            currentPeriodEnd,
            cancelAtPeriodEnd,
          },
        }),
      ]);

      logger.info('Subscription synced', { userId, subscriptionId: sub.id, plan });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;

      if (!userId) {
        logger.warn('Subscription deleted event missing userId metadata', {
          subscriptionId: sub.id,
        });
        break;
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { plan: 'FREE' },
        }),
        prisma.subscription.update({
          where: { userId },
          data: { status: 'canceled' },
        }),
      ]);

      logger.info('Subscription cancelled', { userId, subscriptionId: sub.id });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
