import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCheckoutSession } from '@/lib/stripe';
import { checkoutSchema } from '@/lib/validations';

const PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_ID_STARTER || '',
  pro: process.env.STRIPE_PRICE_ID_PRO || '',
  studio: process.env.STRIPE_PRICE_ID_STUDIO || '',
};

const CREDIT_PACK_PRICES: Record<number, { unitAmount: number; name: string }> = {
  3: { unitAmount: 500, name: '3 Credits' },
  10: { unitAmount: 1400, name: '10 Credits' },
  25: { unitAmount: 3000, name: '25 Credits' },
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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });

  if (!user?.email) {
    return NextResponse.json({ error: 'User email not found' }, { status: 400 });
  }

  const baseUrl = request.nextUrl.origin;

  try {
    if (parsed.data.type === 'credit_pack') {
      const pack = CREDIT_PACK_PRICES[parsed.data.credits];
      if (!pack) {
        return NextResponse.json({ error: 'Invalid credit pack' }, { status: 400 });
      }

      const url = await createCheckoutSession({
        userId: session.user.id,
        userEmail: user.email,
        mode: 'payment',
        unitAmount: pack.unitAmount,
        productName: `Sotto ${pack.name}`,
        successUrl: `${baseUrl}/billing?success=true`,
        cancelUrl: `${baseUrl}/billing?canceled=true`,
        metadata: { credits: String(parsed.data.credits) },
      });

      return NextResponse.json({ url });
    }

    // Subscription checkout
    const { tier } = parsed.data;
    const priceId = PRICE_IDS[tier];
    if (!priceId) {
      return NextResponse.json(
        { error: `Price not configured for tier: ${tier}` },
        { status: 500 }
      );
    }

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
