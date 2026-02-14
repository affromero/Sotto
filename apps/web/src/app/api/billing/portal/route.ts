import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPortalSession } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { stripeCustomerId: true },
  });

  if (!subscription?.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No active subscription found. Please subscribe first.' },
      { status: 400 }
    );
  }

  const baseUrl = request.nextUrl.origin;

  try {
    const url = await createPortalSession(
      subscription.stripeCustomerId,
      `${baseUrl}/billing`
    );

    return NextResponse.json({ url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create portal session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
