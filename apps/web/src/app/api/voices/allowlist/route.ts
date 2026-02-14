import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addToAllowlistSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = addToAllowlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  }

  const { voiceCloneId, handle } = parsed.data;

  // Verify ownership of the voice clone
  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { id: true, userId: true },
  });

  if (!voiceClone || voiceClone.userId !== session.user.id) {
    return NextResponse.json(
      { error: 'Voice clone not found or not owned by you' },
      { status: 404 }
    );
  }

  // Find target user by handle
  const targetUser = await prisma.user.findUnique({
    where: { handle },
    select: { id: true, handle: true, name: true, image: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: `User @${handle} not found` }, { status: 404 });
  }

  // Prevent self-allowlisting
  if (targetUser.id === session.user.id) {
    return NextResponse.json(
      { error: 'You cannot add yourself to the allowlist' },
      { status: 400 }
    );
  }

  // Create allowlist entry (unique constraint prevents duplicates)
  try {
    const entry = await prisma.voiceAllowlist.create({
      data: {
        voiceCloneId,
        allowedUserId: targetUser.id,
      },
      select: {
        id: true,
        createdAt: true,
        allowedUser: { select: { id: true, handle: true, name: true, image: true } },
      },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'User is already on the allowlist for this voice' },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const voiceCloneId = request.nextUrl.searchParams.get('voiceCloneId');
  if (!voiceCloneId) {
    return NextResponse.json({ error: 'voiceCloneId is required' }, { status: 400 });
  }

  // Verify ownership
  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { userId: true },
  });

  if (!voiceClone || voiceClone.userId !== session.user.id) {
    return NextResponse.json(
      { error: 'Voice clone not found or not owned by you' },
      { status: 404 }
    );
  }

  const entries = await prisma.voiceAllowlist.findMany({
    where: { voiceCloneId },
    select: {
      id: true,
      createdAt: true,
      allowedUser: { select: { id: true, handle: true, name: true, image: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(entries);
}
