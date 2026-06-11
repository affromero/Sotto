import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitlistSchema } from '@/lib/validations';
import { assertEmailDeliveryConfigured, sendEmail } from '@/lib/email';
import { buildWaitlistWelcomeEmail } from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/redis';

import { errorResponse } from '@/lib/api-response';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed } = await checkRateLimit(`waitlist:${ip}`, 5, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await request.json();
  const parsed = waitlistSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { email, twitterHandle, source, wishlist, referralCode } = parsed.data;

  // Check if this is a genuinely new signup before upserting
  const existing = await prisma.waitlist.findUnique({ where: { email } });
  const isNewSignup = !existing;
  const welcomeEmail = isNewSignup ? buildWaitlistWelcomeEmail(email) : null;

  if (welcomeEmail) {
    try {
      assertEmailDeliveryConfigured();
    } catch (error) {
      logger.error('Waitlist welcome email is not configured', {
        email,
        error: getErrorMessage(error),
      });
      return errorResponse('Email delivery is not configured', 503);
    }
  }

  // Upsert: if email already exists, just return success (no error to user)
  await prisma.waitlist.upsert({
    where: { email },
    create: { email, twitterHandle, source, wishlist, referralCode },
    update: {
      ...(twitterHandle ? { twitterHandle } : {}),
      ...(wishlist ? { wishlist } : {}),
      ...(referralCode ? { referralCode } : {}),
    },
  });

  // Send welcome email for new signups
  if (welcomeEmail) {
    try {
      await sendEmail({ to: email, subject: welcomeEmail.subject, html: welcomeEmail.html });
    } catch (error) {
      logger.error('Waitlist welcome email failed', {
        email,
        error: getErrorMessage(error),
      });
      return errorResponse('Waitlist welcome email failed', 502);
    }
  }

  return NextResponse.json({ message: "You're on the list!" }, { status: 201 });
}
