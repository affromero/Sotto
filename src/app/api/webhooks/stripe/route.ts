import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { resetMonthlyUsage } from '@/lib/subscription';
import { logger } from '@/lib/logger';
import type { SubscriptionTier } from '@prisma/client';

const PRICE_TO_TIER: Record<string, SubscriptionTier> = {
  [process.env.STRIPE_PRICE_ID_PRO || '']: 'PRO',
  [process.env.STRIPE_PRICE_ID_CREATOR || '']: 'CREATOR',
};

function tierFromPriceId(priceId: string): SubscriptionTier {
  return PRICE_TO_TIER[priceId] || 'FREE';
}

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    logger.error('Stripe webhook signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (userId && session.subscription) {
        const subResponse = await stripe.subscriptions.retrieve(session.subscription as string);
        const sub = subResponse as unknown as {
          id: string;
          items: { data: Array<{ price: { id: string } }> };
          current_period_start: number;
          current_period_end: number;
        };
        const priceId = sub.items.data[0]?.price.id || '';
        const tier = tierFromPriceId(priceId);

        await prisma.subscription.upsert({
          where: { userId },
          create: {
            userId,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            status: 'ACTIVE',
            tier,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
          update: {
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            status: 'ACTIVE',
            tier,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        });

        await prisma.subscriptionEvent.create({
          data: { userId, type: event.type, stripeEventId: event.id, data: session as object },
        });

        logger.info('Subscription created via checkout', { userId, tier });
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as unknown as {
        id: string;
        items: { data: Array<{ price: { id: string } }> };
        current_period_start: number;
        current_period_end: number;
        status: string;
        cancel_at_period_end: boolean;
      };
      const priceId = sub.items.data[0]?.price.id || '';
      const tier = tierFromPriceId(priceId);

      const existing = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });

      if (existing) {
        const isRenewal =
          existing.currentPeriodEnd &&
          new Date(sub.current_period_start * 1000) > existing.currentPeriodEnd;

        await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            stripePriceId: priceId,
            tier,
            status: sub.status === 'active' ? 'ACTIVE' : sub.status === 'past_due' ? 'PAST_DUE' : 'CANCELED',
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
        });

        if (isRenewal) {
          await resetMonthlyUsage(existing.userId);
          logger.info('Monthly usage reset on period renewal', { userId: existing.userId });
        }

        logger.info('Subscription updated', { subscriptionId: sub.id, tier });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: 'CANCELED', tier: 'FREE' },
      });
      logger.info('Subscription deleted', { subscriptionId: sub.id });
      break;
    }
    default:
      logger.debug('Unhandled Stripe event', { type: event.type });
  }

  return NextResponse.json({ received: true });
}
