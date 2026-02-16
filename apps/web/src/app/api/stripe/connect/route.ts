import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';

/**
 * POST: Create Stripe Connect Express account + onboarding link.
 * GET: Check onboarding status and return dashboard URL.
 */

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { stripeAccountId: true, stripeOnboarded: true, email: true },
  });

  let accountId = user.stripeAccountId;

  // Create account if not yet created
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { userId: session.user.id },
    });

    accountId = account.id;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { stripeAccountId: accountId },
    });
  }

  // Create onboarding link
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/settings/voices?stripe=refresh`,
    return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${accountId}`,
    type: 'account_onboarding',
  });

  return NextResponse.json({ url: accountLink.url });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { stripeAccountId: true, stripeOnboarded: true },
  });

  if (!user.stripeAccountId) {
    return NextResponse.json({ onboarded: false, accountId: null, dashboardUrl: null });
  }

  // Check account status from Stripe
  const account = await stripe.accounts.retrieve(user.stripeAccountId);
  const onboarded = account.charges_enabled && account.payouts_enabled;

  // Sync onboarding status if changed
  if (onboarded !== user.stripeOnboarded) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { stripeOnboarded: onboarded },
    });
  }

  let dashboardUrl: string | null = null;
  if (onboarded) {
    const loginLink = await stripe.accounts.createLoginLink(user.stripeAccountId);
    dashboardUrl = loginLink.url;
  }

  return NextResponse.json({ onboarded, accountId: user.stripeAccountId, dashboardUrl });
}
