import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

/**
 * Create a Stripe Customer Portal session.
 * Returns { url } — redirect user there to manage/cancel their Pro subscription.
 */
export async function POST(request: NextRequest) {
  if (!stripe) {
    return errorResponse('Stripe not configured', 503);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeCustomerId: true },
  });

  if (!subscription?.stripeCustomerId) {
    return errorResponse('No subscription found. Subscribe to Pro first.', 404);
  }

  let body: { returnUrl?: string } = {};
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

  const returnUrl = body.returnUrl && isSameOrigin(body.returnUrl)
    ? body.returnUrl
    : `${appUrl}/billing`;

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });

    logger.info('Stripe portal session created', { userId });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    logger.error('Failed to create portal session', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse('Failed to create portal session', 500);
  }
}
