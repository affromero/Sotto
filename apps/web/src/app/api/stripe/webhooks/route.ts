import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';

/**
 * Stripe webhook handler.
 * Handles account.updated (Connect onboarding) and payment_intent.payment_failed events.
 */
export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
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
  }

  return NextResponse.json({ received: true });
}
