import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitlistSchema } from '@/lib/validations';
import { sendEmail } from '@/lib/email';
import { buildWaitlistWelcomeEmail } from '@/lib/email-templates';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = waitlistSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, source } = parsed.data;

  // Upsert: if email already exists, just return success (no error to user)
  const entry = await prisma.waitlist.upsert({
    where: { email },
    create: { email, source },
    update: {},
  });

  // Send welcome email for new signups (fire-and-forget)
  if (entry.createdAt.getTime() > Date.now() - 5000) {
    const { subject, html } = buildWaitlistWelcomeEmail(email);
    sendEmail({ to: email, subject, html }).catch(() => {});
  }

  return NextResponse.json({ message: "You're on the list!" }, { status: 201 });
}
