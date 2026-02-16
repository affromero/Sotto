import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';

/**
 * Stripe Connect return URL handler.
 * After completing onboarding, Stripe redirects here.
 * Verifies account and sets stripeOnboarded = true.
 */
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get('account_id');
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

  if (!accountId || !stripe) {
    return NextResponse.redirect(`${baseUrl}/settings/voices?stripe=error`);
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const onboarded = account.charges_enabled && account.payouts_enabled;

    if (onboarded) {
      await prisma.user.updateMany({
        where: { stripeAccountId: accountId },
        data: { stripeOnboarded: true },
      });
    }

    const status = onboarded ? 'success' : 'pending';
    return NextResponse.redirect(`${baseUrl}/settings/voices?stripe=${status}`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/settings/voices?stripe=error`);
  }
}
