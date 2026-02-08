import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCheckoutSession } from '@/lib/stripe';
import { checkoutSchema } from '@/lib/validations';

const PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRO_PRICE_ID || '',
  team: process.env.STRIPE_TEAM_PRICE_ID || '',
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { tier } = parsed.data;
  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    return NextResponse.json(
      { error: `Price not configured for tier: ${tier}` },
      { status: 500 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });

  if (!user?.email) {
    return NextResponse.json({ error: 'User email not found' }, { status: 400 });
  }

  const baseUrl = request.nextUrl.origin;

  try {
    const url = await createCheckoutSession({
      userId: session.user.id,
      userEmail: user.email,
      priceId,
      successUrl: `${baseUrl}/billing?success=true`,
      cancelUrl: `${baseUrl}/pricing?canceled=true`,
    });

    return NextResponse.json({ url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create checkout session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
