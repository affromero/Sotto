import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitlistSchema } from '@/lib/validations';
import { sendEmail } from '@/lib/email';
import { buildWaitlistWelcomeEmail } from '@/lib/email-templates';

import { errorResponse } from '@/lib/api-response';
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = waitlistSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { email, twitterHandle, source, wishlist } = parsed.data;

  // Upsert: if email already exists, just return success (no error to user)
  const entry = await prisma.waitlist.upsert({
    where: { email },
    create: { email, twitterHandle, source, wishlist },
    update: {
      ...(twitterHandle ? { twitterHandle } : {}),
      ...(wishlist ? { wishlist } : {}),
    },
  });

  // Send welcome email for new signups (fire-and-forget)
  if (entry.createdAt.getTime() > Date.now() - 5000) {
    const { subject, html } = buildWaitlistWelcomeEmail(email);
    sendEmail({ to: email, subject, html }).catch(() => {});
  }

  return NextResponse.json({ message: "You're on the list!" }, { status: 201 });
}
