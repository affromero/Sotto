import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const priceId = process.env.STRIPE_PRICE_ID_VOICE_CREATOR_ADDON;
  if (!priceId) {
    return NextResponse.json({ error: 'Voice Creator add-on not configured' }, { status: 500 });
  }

  // Must be Studio tier and not already have the add-on
  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { tier: true, voiceCreatorAddonActive: true, stripeCustomerId: true },
  });

  if (!subscription || subscription.tier !== 'STUDIO') {
    return NextResponse.json(
      { error: 'Voice Creator add-on requires Studio tier' },
      { status: 403 }
    );
  }

  if (subscription.voiceCreatorAddonActive) {
    return NextResponse.json({ error: 'Voice Creator add-on is already active' }, { status: 409 });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: subscription.stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/settings/voices?addon=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/settings/voices?addon=cancel`,
    metadata: {
      userId: session.user.id,
      type: 'voice_creator_addon',
    },
  });

  logger.info('Voice Creator addon checkout created', { userId: session.user.id });

  return NextResponse.json({ url: checkoutSession.url });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { voiceCreatorAddonActive: true, voiceCreatorAddonStripeSubscriptionId: true },
  });

  if (
    !subscription?.voiceCreatorAddonActive ||
    !subscription.voiceCreatorAddonStripeSubscriptionId
  ) {
    return NextResponse.json(
      { error: 'No active Voice Creator add-on to cancel' },
      { status: 404 }
    );
  }

  await stripe.subscriptions.cancel(subscription.voiceCreatorAddonStripeSubscriptionId);

  logger.info('Voice Creator addon cancelled', { userId: session.user.id });

  return NextResponse.json({ success: true });
}
