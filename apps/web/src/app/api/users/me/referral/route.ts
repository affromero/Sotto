import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { referralSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = referralSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { handle } = parsed.data;

  // Don't let users refer themselves
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { handle: true, referredById: true },
  });

  if (currentUser?.referredById) {
    return NextResponse.json({ message: 'Already referred' }, { status: 200 });
  }

  if (currentUser?.handle === handle) {
    return errorResponse('Cannot refer yourself', 400);
  }

  const referrer = await prisma.user.findFirst({
    where: { handle },
    select: { id: true },
  });

  if (!referrer) {
    return errorResponse('Referrer not found', 404);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { referredById: referrer.id },
  });

  return NextResponse.json({ message: 'Referral attributed' }, { status: 200 });
}
