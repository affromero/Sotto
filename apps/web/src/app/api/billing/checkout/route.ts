import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Create a Stripe Checkout session for the Pro subscription.
 * Returns { url } — redirect the user there to complete payment.
 */
export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: 'Pro price not configured' }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, subscription: { select: { stripeCustomerId: true } } },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (user.plan === 'PRO') {
    return NextResponse.json({ error: 'Already subscribed to Pro' }, { status: 400 });
  }

  let body: { successUrl?: string; cancelUrl?: string } = {};
  try {
    body = await request.json();
  } catch {
    // allow empty body
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sotto.fm';

  function isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(appUrl).origin;
    } catch {
      return false;
    }
  }

  const successUrl = body.successUrl && isSameOrigin(body.successUrl)
    ? body.successUrl
    : `${appUrl}/billing?upgrade=success`;
  const cancelUrl = body.cancelUrl && isSameOrigin(body.cancelUrl)
    ? body.cancelUrl
    : `${appUrl}/pricing`;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: user.subscription?.stripeCustomerId ?? undefined,
      customer_email: user.subscription?.stripeCustomerId ? undefined : (user.email ?? undefined),
      client_reference_id: userId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { userId },
      },
      metadata: { userId },
    });

    logger.info('Stripe checkout session created', { userId, sessionId: checkoutSession.id });
    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    logger.error('Failed to create checkout session', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
