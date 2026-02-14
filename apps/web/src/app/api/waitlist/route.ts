import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitlistSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = waitlistSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, source } = parsed.data;

  // Upsert: if email already exists, just return success (no error to user)
  await prisma.waitlist.upsert({
    where: { email },
    create: { email, source },
    update: {},
  });

  return NextResponse.json({ message: "You're on the list!" }, { status: 201 });
}
