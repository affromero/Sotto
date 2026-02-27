import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitlistSchema } from '@/lib/validations';
import { sendEmail } from '@/lib/email';
import { buildWaitlistWelcomeEmail } from '@/lib/email-templates';
import { sendMessage, isTelegramBotConfigured } from '@/lib/telegram';
import { logger } from '@/lib/logger';

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

  // Send welcome email + admin Telegram notification for new signups
  if (entry.createdAt.getTime() > Date.now() - 5000) {
    const { subject, html } = buildWaitlistWelcomeEmail(email);
    const sent = await sendEmail({ to: email, subject, html });
    if (!sent) {
      logger.warn('Waitlist welcome email failed', { email });
    }

    if (isTelegramBotConfigured()) {
      notifyAdminsViaTelegram({ email, twitterHandle, source, wishlist }).catch(() => {});
    }
  }

  return NextResponse.json({ message: "You're on the list!" }, { status: 201 });
}

async function notifyAdminsViaTelegram(signup: {
  email: string;
  twitterHandle?: string;
  source?: string;
  wishlist?: string;
}) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', telegramEnabled: true, telegramChatId: { not: null } },
    select: { telegramChatId: true },
  });

  if (admins.length === 0) return;

  const totalCount = await prisma.waitlist.count();

  const lines = [
    `📋 *New waitlist signup* (#${totalCount})`,
    '',
    `*Email:* ${signup.email}`,
  ];
  if (signup.twitterHandle) lines.push(`*Twitter:* @${signup.twitterHandle}`);
  if (signup.source) lines.push(`*Source:* ${signup.source}`);
  if (signup.wishlist) lines.push(`*Wishlist:* ${signup.wishlist}`);

  const text = lines.join('\n');

  await Promise.allSettled(
    admins.map((admin) =>
      sendMessage(admin.telegramChatId!, text, { parse_mode: 'Markdown' })
    )
  ).catch((err) => logger.error('Failed to send waitlist Telegram notification', { error: err }));
}
