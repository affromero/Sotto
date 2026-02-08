import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

import { logger } from '@/lib/logger';

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
  } catch (err) {
    logger.error('Stripe webhook signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
      logger.info('Checkout session completed', { sessionId: event.data.object.id });
      break;
    case 'customer.subscription.updated':
      logger.info('Subscription updated', { subscriptionId: event.data.object.id });
      break;
    case 'customer.subscription.deleted':
      logger.info('Subscription deleted', { subscriptionId: event.data.object.id });
      break;
    default:
      logger.debug('Unhandled Stripe event', { type: event.type });
  }

  return NextResponse.json({ received: true });
}
